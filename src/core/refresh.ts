// Ingest spine (ADR-0001, ADR-0002). `refresh()` discovers top-level session
// files + their sub-agent transcripts, parses them, and writes ALL seven tables.
// The read seams (`listConversations()`, `getConversation()`) live in `read.ts`.
//
// ONE CONVERSATION AT A TIME: a conversation is parsed, written in a single
// transaction (delete of its prior row + every insert), reported through
// `onProgress`, then dropped — no run holds more than one parsed conversation,
// and readers on other connections (WAL, see `db.ts`) never find a re-parsed
// conversation missing.
//
// INCREMENTAL REFRESH (Slice 5): `refresh()` skips conversations whose source
// has not changed, re-parses changed/new ones, and drops conversations whose
// source file disappeared. The change key is a COMPOSITE of the main session
// file PLUS its sub-agent transcripts (max mtime, summed size) — a sub-agent
// file changing alone (the main file untouched) still triggers a re-parse,
// because sub-agents have no independent conversation/mtime row of their own.
// The stored `parserVersion` is part of that decision too: rows produced by an
// older parser are re-parsed once even when their source files are untouched
// (see `PARSER_VERSION`). It doubles as the COMMIT MARK of a refresh: a
// conversation is stamped only after its continuation link has been resolved,
// so an INTERRUPTED run leaves its conversations re-parseable rather than
// looking up-to-date with a missing link (see `UNSTAMPED_PARSER_VERSION`).
//
// DUPLICATE SESSION IDS: the session id is a FILE STEM, so a transcript copied
// into a second project folder presents as two sessions with one id — which the
// unique `conversation.sessionId` rejected, aborting the whole run. Discovery
// now keeps ONE file per session id (smallest source path wins) and reports the
// losers in `RefreshSummary.duplicateSessionsSkipped` (see `dedupeBySessionId`).
//
// ROLLUP DESIGN (ADR-0001): conversation totals/cost are SUM queries over ALL
// messages of ALL agents in the conversation — so sub-agent tokens roll up
// automatically, counted ONCE (the parent Agent aggregate is never summed in).

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createPrismaClient, defaultDbPath } from "@/core/db";
import {
  decodeFolderName,
  defaultLogsRoot,
  type DiscoveredSession,
  discoverSessions,
  discoverSubAgents,
} from "@/core/discovery";
import { type ParsedAgentSpawn, parseSessionLines, type ParsedSession } from "@/core/parse";
import type { PrismaClient } from "@/core/prisma/generated/client";

/** The interactive-transaction client handle (a subset of PrismaClient). */
type PrismaTx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** One `tool_call` insert row. */
type ToolCallData = {
  messageId: number;
  agentId: number;
  toolUseId: string | null;
  name: string;
  inputJson: string;
  resultText: string | null;
  resultTruncated: boolean;
  resultCharSize: number | null;
  isError: boolean;
};

/**
 * One `.jsonl` file dropped because another file already claimed its session id
 * (see `dedupeBySessionId`). Carries both paths so the report can tell the user
 * exactly which stray file to delete.
 */
export type DuplicateSessionSkip = {
  sessionId: string;
  /** The file that was ingested (smallest source path). */
  keptPath: string;
  /** The file that was NOT ingested. */
  skippedPath: string;
};

export type RefreshSummary = {
  conversationsParsed: number;
  conversationsSkipped: number;
  conversationsDeleted: number;
  malformedLinesSkipped: number;
  /** Files dropped for sharing a session id with an already-claimed file. */
  duplicateSessionsSkipped: DuplicateSessionSkip[];
  durationMs: number;
  /** Where `durationMs` went, in fractional milliseconds per phase (see `RefreshPhase`). */
  durationMsByPhase: Record<RefreshPhase, number>;
};

/**
 * A stretch of a Refresh, timed on its own: `discovery` (find the files, read
 * the stored rows, delete vanished Conversations, pick what to re-parse),
 * `parse` and `write` (summed over every Conversation), `links` (continued-from)
 * and `stamp` (the parser-version commit mark).
 */
export type RefreshPhase = "discovery" | "parse" | "write" | "links" | "stamp";

type RefreshOptions = {
  logsRoot?: string;
  dbPath?: string;
  /**
   * Called with `{ done: 0, total }` once the run knows what to re-parse, then
   * after each conversation's write has committed. A throw aborts the run.
   */
  onProgress?: (progress: RefreshProgress) => void;
};

/**
 * Version of the parse/write logic behind the rows in the database.
 *
 * BUMP THIS whenever a parser or writer change makes previously ingested rows
 * wrong or incomplete: a conversation whose stored `parserVersion` differs is
 * treated as CHANGED even when its source files did not move, so it re-parses
 * exactly once and is stamped with the new version. This replaces the old
 * `UPDATE conversation SET source_mtime = -1` migration hack.
 *
 * 1 — sub-agents nest under the agent that actually spawned them (before, every
 *     sub-agent was flattened onto the main thread).
 * 2 — assistant turns carry their reasoning `effort` (previously ignored), so
 *     already-ingested conversations must re-parse to fill the new column.
 * 3 — user Messages are classified by `origin.kind` (Inter-agent messages and
 *     Task notifications, with their `origin` extras) and `queued_command`
 *     attachments become mid-turn Messages.
 */
const PARSER_VERSION = 3;

/**
 * The version a conversation carries while it is written but NOT YET COMPLETE:
 * its rows exist, its `continued_from` link has not been resolved. Never equal
 * to `PARSER_VERSION`, so such a row always re-parses.
 *
 * This is what makes an INTERRUPTED refresh recoverable. Stamping the current
 * version at write time left a window — crash after the conversation writes,
 * before `resolveContinuedFrom` — in which rows looked up-to-date to every
 * later run and were skipped forever, their `continuedFromConversationId`
 * permanently null. Conversations are now stamped only once linking has run
 * for the whole refresh (`stampParserVersion`), so an aborted run leaves them
 * re-parseable and the next run completes them.
 *
 * It shares the column's DEFAULT (0), which already means "not produced by any
 * current parser run" for rows predating the column — both cases want the same
 * treatment: re-parse.
 */
const UNSTAMPED_PARSER_VERSION = 0;

/** Upper bound on one conversation's write transaction (see `writeConversation`). */
const WRITE_TRANSACTION_TIMEOUT_MS = 10 * 60_000;

/** A discovered session whose stored conversation is missing or stale. */
type SessionToReparse = {
  /** The session, its `sourceMtime`/`sourceSize` set to the COMPOSITE change key. */
  session: DiscoveredSession;
  subAgentPaths: { agentId: string; sourcePath: string }[];
  /** Row id of the stored conversation the re-parse replaces (null = new). */
  priorConversationId: number | null;
};

/** One main session + its sub-agent transcripts, all parsed, ready to write. */
type ParsedConversation = {
  session: DiscoveredSession;
  parsed: ParsedSession;
  subAgents: { agentId: string; parsed: ParsedSession }[];
  /** Row id of the stored conversation the write replaces (null = new). */
  priorConversationId: number | null;
};

/** What linking and stamping need of a conversation this run has written. */
type WrittenConversation = {
  sessionId: string;
  /** `parentUuid` of its first message: where a resumed session continues from. */
  firstMessageParentUuid: string | null;
};

/** How far a Refresh has got: conversations written out of those it re-parses. */
export type RefreshProgress = { done: number; total: number };

/** A discovered session paired with its computed composite change key. */
type DiscoveredWithKey = {
  session: DiscoveredSession;
  /** Sub-agent transcript paths (folded into the change key + parsed if dirty). */
  subAgentPaths: { agentId: string; sourcePath: string }[];
  /** Composite mtime: max over the session file + every sub-agent transcript. */
  compositeMtime: number;
  /** Composite size: sum over the session file + every sub-agent transcript. */
  compositeSize: number;
};

/**
 * Incremental scan → parse → write of the logs root into a fresh-or-existing DB.
 *
 * For every discovered session we compute a COMPOSITE change key — the max mtime
 * and total size across the main `<sessionId>.jsonl` AND its
 * `subagents/agent-*.jsonl` transcripts — and compare it against the stored
 * `conversation.sourceMtime`/`sourceSize`, without parsing anything. Unchanged
 * conversations are skipped; conversations whose source file no longer exists
 * are deleted. The rest — new or changed — are the run's `total`, reported
 * through `onProgress` as `{ done: 0, total }`.
 *
 * Then three passes over that set only: (1) parse each conversation and write it
 * with its agents/messages/tool_calls/pr_links/turn_durations in ONE transaction
 * that also deletes its prior row (cascading), so a reader on another connection
 * sees the old version or the new one, never neither; report `{ done, total }`
 * once it has committed, and drop the parsed content — memory stays flat however
 * large the logs grow; (2) resolve `continued_from` by looking up each child's
 * first-message `parentUuid` against the persisted `message` rows of ALL
 * conversations — so a skipped (unchanged) parent still resolves; (3) stamp the
 * current `parserVersion` on that set — the commit mark that lets a later run
 * skip them. The sub-agent transcript is the single source of truth for its
 * tokens (GOTCHA 3) — the parent aggregate is a cross-check only.
 *
 * @example
 * const summary = await refresh({ onProgress: ({ done, total }) => console.log(`${done}/${total}`) });
 */
export async function refresh(opts: RefreshOptions = {}): Promise<RefreshSummary> {
  // Monotonic clock for the elapsed measure: `Date.now()` can jump BACKWARD on a
  // wall-clock adjustment (NTP, or WSL2 resuming from sleep), which produced a
  // nonsensical NEGATIVE durationMs in the refresh digest. `performance.now()`
  // never goes back.
  const start = performance.now();
  const logsRoot = opts.logsRoot ?? defaultLogsRoot();
  const dbPath = opts.dbPath ?? defaultDbPath();
  const prisma = createPrismaClient(dbPath);

  let conversationsParsed = 0;
  let conversationsSkipped = 0;
  let conversationsDeleted = 0;
  let malformedLinesSkipped = 0;

  // Assigned by the dedupe below, before anything else looks at the file set.
  let duplicateSessionsSkipped: DuplicateSessionSkip[] = [];

  const durationMsByPhase: Record<RefreshPhase, number> = { discovery: 0, parse: 0, write: 0, links: 0, stamp: 0 };
  let phaseStart = start;
  /** Add the time since the previous call (or the run's start) to `phase`. */
  const endPhase = (phase: RefreshPhase) => {
    const now = performance.now();
    durationMsByPhase[phase] += now - phaseStart;
    phaseStart = now;
  };

  try {
    // A per-connection setting, so it goes on this writer: commits skip their
    // fsync, and a power cut may lose the last ones — acceptable, since the
    // database is a cache rebuildable from the logs.
    await prisma.$executeRawUnsafe("PRAGMA synchronous = NORMAL");

    // Two files may carry the same session id (a copied transcript). Resolve
    // that HERE, before the incremental compare, so every pass below sees one
    // file per session id (see `dedupeBySessionId`).
    const { unique: discovered, duplicatesSkipped } = dedupeBySessionId(discoverWithKeys(logsRoot));
    duplicateSessionsSkipped = duplicatesSkipped;

    // Existing rows, keyed by sessionId, for the skip/changed/delete decision.
    const existing = new Map<
      string,
      {
        id: number;
        sourcePath: string;
        mtime: bigint;
        size: bigint;
        parserVersion: number;
      }
    >();
    for (const row of await prisma.conversation.findMany({
      select: {
        id: true,
        sessionId: true,
        sourcePath: true,
        sourceMtime: true,
        sourceSize: true,
        parserVersion: true,
      },
    })) {
      existing.set(row.sessionId, {
        id: row.id,
        sourcePath: row.sourcePath,
        mtime: row.sourceMtime,
        size: row.sourceSize,
        parserVersion: row.parserVersion,
      });
    }

    // Delete conversations whose source file is gone (single delete cascades).
    const onDisk = new Set(discovered.map((d) => d.session.sessionId));
    for (const [sessionId, row] of existing) {
      if (onDisk.has(sessionId)) continue;
      await prisma.conversation.delete({ where: { id: row.id } });
      conversationsDeleted += 1;
    }

    // Compare — pick the NEW or CHANGED sessions, without parsing anything, so
    // the run knows its total before its first write.
    const sessionsToReparse: SessionToReparse[] = [];

    for (const d of discovered) {
      const prior = existing.get(d.session.sessionId);
      // Rows written by another parser version are stale by definition, however
      // untouched their source files are — re-parse them (exactly once: the
      // rewrite stamps the current version).
      //
      // The source PATH is part of the comparison, not just (mtime, size): when
      // a duplicate at a smaller path takes over a session id (see
      // `dedupeBySessionId`), a metadata-preserving copy presents the very same
      // composite key. Without the path check the conversation would look
      // unchanged and keep the LOSER's rows while the summary reports the winner
      // as the file that was kept.
      const unchanged =
        prior !== undefined &&
        prior.parserVersion === PARSER_VERSION &&
        prior.sourcePath === d.session.sourcePath &&
        prior.mtime === BigInt(d.compositeMtime) &&
        prior.size === BigInt(d.compositeSize);
      if (unchanged) {
        conversationsSkipped += 1;
        continue;
      }

      // Store the COMPOSITE key on the conversation row so a later run can detect
      // a sub-agent-only change (the main file's own mtime/size alone would not).
      sessionsToReparse.push({
        session: { ...d.session, sourceMtime: d.compositeMtime, sourceSize: d.compositeSize },
        subAgentPaths: d.subAgentPaths,
        priorConversationId: prior?.id ?? null,
      });
    }

    const total = sessionsToReparse.length;
    endPhase("discovery");
    opts.onProgress?.({ done: 0, total });

    // Pass 1 — parse, write, report, one conversation at a time: its parsed
    // content is dropped once written, so memory stays flat however large the
    // logs grow. Each write replaces any prior row atomically.
    const writtenConversations: WrittenConversation[] = [];
    for (const sessionToReparse of sessionsToReparse) {
      phaseStart = performance.now();
      const parsedConversation = parseConversation(sessionToReparse);
      malformedLinesSkipped += parsedConversation.parsed.malformedLines;
      for (const sub of parsedConversation.subAgents) malformedLinesSkipped += sub.parsed.malformedLines;
      endPhase("parse");

      await writeConversation(prisma, parsedConversation);
      endPhase("write");
      writtenConversations.push({
        sessionId: parsedConversation.session.sessionId,
        firstMessageParentUuid: parsedConversation.parsed.messages[0]?.parentUuid ?? null,
      });
      conversationsParsed += 1;
      opts.onProgress?.({ done: conversationsParsed, total });
    }

    // Pass 2 — resolve continued-from over the (re)written conversations,
    // authoritatively against the persisted message uuids of ALL conversations.
    phaseStart = performance.now();
    await resolveContinuedFrom(prisma, writtenConversations);
    endPhase("links");

    // Pass 3 — only NOW are these conversations complete: stamp them, so the
    // next run may skip them. An abort before this point leaves them unstamped
    // and therefore re-parseable (see `UNSTAMPED_PARSER_VERSION`).
    await stampParserVersion(prisma, writtenConversations);
    endPhase("stamp");
  } finally {
    await prisma.$disconnect();
  }

  return {
    conversationsParsed,
    conversationsSkipped,
    conversationsDeleted,
    malformedLinesSkipped,
    duplicateSessionsSkipped,
    durationMs: Math.round(performance.now() - start),
    durationMsByPhase,
  };
}

/**
 * Drop every file that shares a session id with one already claimed, so the rest
 * of `refresh()` only ever sees ONE file per session id.
 *
 * WHY: the session id is a file STEM, so two copies of a transcript in two
 * project folders (a user copying a `.jsonl` around) present as two sessions
 * with one id — and `conversation.sessionId` is UNIQUE, so writing the second
 * threw and aborted the ENTIRE refresh (issue #37).
 *
 * THE RULE — the smallest `sourcePath` by plain lexicographic order wins.
 * Directory listing order is filesystem-dependent and must never decide this;
 * sorting makes the winner identical on every machine and on every run, so a
 * conversation does not flip between copies from one refresh to the next.
 *
 * This runs at DISCOVERY, before the incremental compare, so the winner is
 * well-defined even when a new, smaller-path duplicate appears next to a
 * conversation that is already in the database.
 */
function dedupeBySessionId(discovered: DiscoveredWithKey[]): {
  unique: DiscoveredWithKey[];
  duplicatesSkipped: DuplicateSessionSkip[];
} {
  const bySmallestPath = [...discovered].sort((a, b) => (a.session.sourcePath < b.session.sourcePath ? -1 : 1));

  const unique: DiscoveredWithKey[] = [];
  const duplicatesSkipped: DuplicateSessionSkip[] = [];
  const keptPathBySessionId = new Map<string, string>();
  for (const d of bySmallestPath) {
    const { sessionId, sourcePath } = d.session;
    const keptPath = keptPathBySessionId.get(sessionId);
    if (keptPath !== undefined) {
      duplicatesSkipped.push({ sessionId, keptPath, skippedPath: sourcePath });
      continue;
    }
    keptPathBySessionId.set(sessionId, sourcePath);
    unique.push(d);
  }
  return { unique, duplicatesSkipped };
}

/**
 * Discover every session and fold its sub-agent transcripts into a composite
 * change key. A sub-agent file changing without the main file changing still
 * shifts the composite (max mtime / summed size), so the parent re-parses.
 */
function discoverWithKeys(logsRoot: string): DiscoveredWithKey[] {
  const out: DiscoveredWithKey[] = [];
  for (const session of discoverSessions(logsRoot)) {
    const projectDir = path.dirname(session.sourcePath);
    const subAgentPaths = discoverSubAgents(projectDir, session.sessionId).map((s) => ({
      agentId: s.agentId,
      sourcePath: s.sourcePath,
    }));

    let compositeMtime = session.sourceMtime;
    let compositeSize = session.sourceSize;
    for (const sub of subAgentPaths) {
      const stat = statSync(sub.sourcePath);
      compositeMtime = Math.max(compositeMtime, Math.floor(stat.mtimeMs));
      compositeSize += stat.size;
    }

    out.push({ session, subAgentPaths, compositeMtime, compositeSize });
  }
  return out;
}

/** Read + parse one transcript file (main or sub-agent — same per-turn shape). */
function parseSession(sourcePath: string): ParsedSession {
  return parseSessionLines(readFileSync(sourcePath, "utf8").split("\n"));
}

/** Parse a session's main transcript and every sub-agent transcript beside it. */
function parseConversation({ session, subAgentPaths, priorConversationId }: SessionToReparse): ParsedConversation {
  return {
    session,
    parsed: parseSession(session.sourcePath),
    subAgents: subAgentPaths.map((sub) => ({ agentId: sub.agentId, parsed: parseSession(sub.sourcePath) })),
    priorConversationId,
  };
}

/** Resolve (find-or-create) the project row for an on-disk folder. */
async function upsertProject(tx: PrismaTx, folder: string, parsed: ParsedSession): Promise<number> {
  const projectPath = parsed.cwd ?? decodeFolderName(folder);
  const existing = await tx.project.findUnique({
    where: { path: projectPath },
  });
  if (existing) return existing.id;
  const created = await tx.project.create({
    data: { path: projectPath, folderName: folder },
  });
  return created.id;
}

/** The message-row shape written by `createMany` (FK columns + accounting). */
function messageData(m: ParsedSession["messages"][number], conversationId: number, agentId: number) {
  return {
    conversationId,
    agentId,
    messageId: m.messageId,
    uuid: m.uuid,
    role: m.role,
    kind: m.kind,
    text: m.text,
    origin: m.origin === null ? null : JSON.stringify(m.origin),
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cacheCreation5mTokens: m.cacheCreation5mTokens,
    cacheCreation1hTokens: m.cacheCreation1hTokens,
    cacheReadTokens: m.cacheReadTokens,
    model: m.model,
    effort: m.effort,
    attributionSkill: m.attributionSkill,
    attributionAgent: m.attributionAgent,
    attributionPlugin: m.attributionPlugin,
    attributionMcpServer: m.attributionMcpServer,
    permissionMode: m.permissionMode,
    isApiError: m.isApiError,
    apiErrorMessage: m.apiErrorMessage,
    timestamp: m.timestamp === null ? null : BigInt(m.timestamp),
  };
}

const RESULT_TRUNCATE_CHARS = 10_000;

/**
 * Write the `tool_call` rows for one agent's messages, pairing each `tool_use`
 * with its result (matched by `tool_use_id`, finding #6). The result is
 * truncated to ~10k chars for storage; `resultCharSize` keeps the FULL length as
 * a token-cost proxy (ADR-0001). `messageRowByMsgId` maps an assistant
 * `message.id` to its written row id (tool_uses only live on assistant turns).
 */
async function writeToolCalls(
  tx: PrismaTx,
  parsed: ParsedSession,
  agentId: number,
  messageRowByMsgId: Map<string, number>,
): Promise<void> {
  const rows: ToolCallData[] = [];
  for (const msg of parsed.messages) {
    if (msg.toolUses.length === 0 || msg.messageId === null) continue;
    const messageRowId = messageRowByMsgId.get(msg.messageId);
    if (messageRowId === undefined) continue;

    for (const tu of msg.toolUses) {
      const result = tu.toolUseId === null ? undefined : parsed.toolResults.get(tu.toolUseId);
      const fullResult = result?.resultText ?? null;
      const truncated = fullResult !== null && fullResult.length > RESULT_TRUNCATE_CHARS;
      rows.push({
        messageId: messageRowId,
        agentId,
        toolUseId: tu.toolUseId,
        name: tu.name,
        inputJson: tu.inputJson,
        resultText: fullResult === null ? null : fullResult.slice(0, RESULT_TRUNCATE_CHARS),
        resultTruncated: truncated,
        resultCharSize: fullResult === null ? null : fullResult.length,
        isError: result?.isError ?? false,
      });
    }
  }
  if (rows.length > 0) await tx.toolCall.createMany({ data: rows });
}

/** Insert `parsed.messages` for one agent and return a `message.id → row id` map. */
async function writeAgentMessages(
  tx: PrismaTx,
  parsed: ParsedSession,
  conversationId: number,
  agentId: number,
): Promise<Map<string, number>> {
  if (parsed.messages.length > 0) {
    await tx.message.createMany({
      data: parsed.messages.map((m) => messageData(m, conversationId, agentId)),
    });
  }
  // Map assistant message ids → row ids (for tool_call + spawnedBy linkage).
  const rows = await tx.message.findMany({
    where: { agentId, messageId: { not: null } },
    select: { id: true, messageId: true },
  });
  const byMsgId = new Map<string, number>();
  for (const r of rows) {
    if (r.messageId !== null) byMsgId.set(r.messageId, r.id);
  }
  return byMsgId;
}

/**
 * Replace one conversation: delete its prior row (if any), then write it + root
 * agent + messages + tool_calls, then each sub-agent (its own agent row +
 * messages + tool_calls), then pr_links and
 * turn_durations — all in one transaction. The conversations that continued
 * from the prior row are re-pointed at the new one in that same transaction. Sub-agent `spawnedByMessageId` is
 * linked via the spawning `Agent` tool_use that produced the matching `agentId`
 * (log-format §4) — in whichever transcript that ledger lives, main thread or
 * another sub-agent (see `planSubAgents`); `agentType`/`resolvedModel` come from
 * that spawn ledger.
 */
async function writeConversation(prisma: PrismaClient, parsedConversation: ParsedConversation): Promise<void> {
  const { session, parsed, subAgents, priorConversationId } = parsedConversation;

  await prisma.$transaction(
    async (tx) => {
      // The prior row goes in the SAME transaction as its replacement (cascading
      // to every child table), so a reader on another connection sees the old
      // version or the new one — never the conversation missing. The delete nulls
      // the continued-from link of every child (`onDelete: SetNull`), so their ids
      // are read first and re-pointed at the new row below — a skipped child is
      // not re-linked by `resolveContinuedFrom`.
      let continuingChildIds: number[] = [];
      if (priorConversationId !== null) {
        const continuingChildren = await tx.conversation.findMany({
          where: { continuedFromConversationId: priorConversationId },
          select: { id: true },
        });
        continuingChildIds = continuingChildren.map((c) => c.id);
        await tx.conversation.delete({ where: { id: priorConversationId } });
      }
      const projectId = await upsertProject(tx, session.folder, parsed);

      const conversation = await tx.conversation.create({
        data: {
          sessionId: session.sessionId,
          projectId,
          title: parsed.title,
          gitBranch: parsed.gitBranch,
          ccVersion: parsed.ccVersion,
          sourcePath: session.sourcePath,
          sourceMtime: BigInt(session.sourceMtime),
          sourceSize: BigInt(session.sourceSize),
          // Not stamped yet — `stampParserVersion` does that once this refresh's
          // continuation linking has run (see `UNSTAMPED_PARSER_VERSION`).
          parserVersion: UNSTAMPED_PARSER_VERSION,
          continuedFromConversationId: null,
        },
      });
      if (continuingChildIds.length > 0) {
        await tx.conversation.updateMany({
          where: { id: { in: continuingChildIds } },
          data: { continuedFromConversationId: conversation.id },
        });
      }

      const rootAgent = await tx.agent.create({
        data: {
          conversationId: conversation.id,
          parentAgentId: null,
          agentType: null, // root/main thread
          resolvedModel: parsed.dominantModel,
        },
      });

      const rootByMsgId = await writeAgentMessages(tx, parsed, conversation.id, rootAgent.id);
      await writeToolCalls(tx, parsed, rootAgent.id, rootByMsgId);

      // Sub-agents: each transcript is its own agent row (single source of truth
      // for its tokens — the parent aggregate is NOT summed). Linked back to the
      // spawning Agent tool_use via the spawn ledger's agentId → tool_use_id —
      // that ledger may live in ANOTHER sub-agent's transcript (a sub-agent can
      // itself spawn sub-agents), so parentage is resolved across every transcript
      // and the rows are written parents-first.
      const written = new Map<string, AgentWriteTarget>();
      const rootTarget: AgentWriteTarget = {
        agentRowId: rootAgent.id,
        parsed,
        messageRowByMsgId: rootByMsgId,
      };

      for (const plan of planSubAgents(parsed, subAgents)) {
        const parent = plan.parentExternalId === null ? rootTarget : (written.get(plan.parentExternalId) ?? rootTarget);
        const spawnedByMessageId =
          plan.spawn?.toolUseId == null
            ? null
            : (toolUseToMessageRow(parent.parsed, plan.spawn.toolUseId, parent.messageRowByMsgId) ?? null);

        const subAgent = await tx.agent.create({
          data: {
            conversationId: conversation.id,
            parentAgentId: parent.agentRowId,
            externalAgentId: plan.agentId,
            spawnedByMessageId,
            agentType: plan.spawn?.agentType ?? null,
            resolvedModel: plan.spawn?.resolvedModel ?? plan.parsed.dominantModel,
          },
        });

        const subByMsgId = await writeAgentMessages(tx, plan.parsed, conversation.id, subAgent.id);
        await writeToolCalls(tx, plan.parsed, subAgent.id, subByMsgId);
        written.set(plan.agentId, {
          agentRowId: subAgent.id,
          parsed: plan.parsed,
          messageRowByMsgId: subByMsgId,
        });
      }

      if (parsed.prLinks.length > 0) {
        await tx.prLink.createMany({
          data: parsed.prLinks.map((p) => ({
            conversationId: conversation.id,
            prNumber: p.prNumber,
            prUrl: p.prUrl,
            prRepository: p.prRepository,
          })),
        });
      }

      if (parsed.turnDurations.length > 0) {
        await tx.turnDuration.createMany({
          data: parsed.turnDurations.map((t) => ({
            conversationId: conversation.id,
            durationMs: BigInt(t.durationMs),
            messageCount: t.messageCount,
          })),
        });
      }
    },
    // A huge conversation's delete + inserts can outlast Prisma's 5 s default,
    // and aborting a local, user-triggered run on a timer is pure downside.
    { timeout: WRITE_TRANSACTION_TIMEOUT_MS },
  );
}

/** An already-written agent: what a child needs to resolve its spawn linkage. */
type AgentWriteTarget = {
  agentRowId: number;
  /** That agent's own parsed transcript (where its Agent tool_uses live). */
  parsed: ParsedSession;
  /** Its `message.id → row id` map (spawn linkage points at ITS messages). */
  messageRowByMsgId: Map<string, number>;
};

/** One sub-agent resolved to its true parent, ready to write. */
type SubAgentPlan = {
  agentId: string;
  parsed: ParsedSession;
  /** External id of the spawning SUB-agent; null ⇒ spawned by the main thread. */
  parentExternalId: string | null;
  spawn: ParsedAgentSpawn | undefined;
};

/**
 * Resolve each sub-agent's true parent and order the set PARENTS-FIRST.
 *
 * A sub-agent may itself spawn sub-agents, so a grandchild's spawn ledger lives
 * in its parent sub-agent's transcript, not the root's. We index every ledger
 * (root + every sub-agent) by spawned agentId, then emit sub-agents in
 * dependency order so a child is always written after its parent's row and
 * message rows exist.
 *
 * Unresolvable parentage — no ledger anywhere, a ledger naming a transcript that
 * is not on disk, or a ledger CYCLE — falls back to the main thread, matching the
 * defensive nesting in `buildAgentTree` (read.ts). The leftover pass is what
 * makes a cycle terminate instead of looping forever.
 */
function planSubAgents(root: ParsedSession, subAgents: { agentId: string; parsed: ParsedSession }[]): SubAgentPlan[] {
  // agentId → who spawned it (null = main thread) + its ledger entry. The root's
  // ledgers win over a sub-agent's on a (malformed) duplicate claim.
  const ledger = new Map<string, { parentExternalId: string | null; spawn: ParsedAgentSpawn }>();
  for (const [agentId, spawn] of root.agentSpawns) {
    ledger.set(agentId, { parentExternalId: null, spawn });
  }
  for (const sub of subAgents) {
    for (const [agentId, spawn] of sub.parsed.agentSpawns) {
      if (agentId === sub.agentId || ledger.has(agentId)) continue;
      ledger.set(agentId, { parentExternalId: sub.agentId, spawn });
    }
  }

  const ordered: SubAgentPlan[] = [];
  const emitted = new Set<string>();
  const pending = [...subAgents];

  // Repeatedly emit every sub-agent whose parent is the main thread or has
  // already been emitted, until a full sweep makes no progress.
  for (let progress = true; progress;) {
    progress = false;
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      const sub = pending[i];
      if (sub === undefined) continue;
      const entry = ledger.get(sub.agentId);
      const parentExternalId = entry?.parentExternalId ?? null;
      if (parentExternalId !== null && !emitted.has(parentExternalId)) continue;
      ordered.push({ ...sub, parentExternalId, spawn: entry?.spawn });
      emitted.add(sub.agentId);
      pending.splice(i, 1);
      progress = true;
    }
  }

  // Leftovers: dangling parent or cycle → attach under the main thread.
  for (const sub of pending) {
    ordered.push({
      ...sub,
      parentExternalId: null,
      spawn: ledger.get(sub.agentId)?.spawn,
    });
  }
  return ordered;
}

/** Map a spawning `tool_use_id` back to the assistant message row that holds it. */
function toolUseToMessageRow(
  parsed: ParsedSession,
  toolUseId: string,
  messageRowByMsgId: Map<string, number>,
): number | undefined {
  for (const m of parsed.messages) {
    if (m.messageId === null) continue;
    if (m.toolUses.some((tu) => tu.toolUseId === toolUseId)) {
      return messageRowByMsgId.get(m.messageId);
    }
  }
  return undefined;
}

/**
 * Pass 2: set `continuedFromConversationId` when a conversation's FIRST message's
 * `parentUuid` resolves into a DIFFERENT session (a `--resume`/fork). Resumed
 * sessions stay DISTINCT rows (ADR-0001) — the link only records lineage; tokens
 * are never merged.
 *
 * Resolution is authoritative against the DATABASE, not just the conversations
 * parsed in this run: on an incremental refresh the parent session may be
 * UNCHANGED (and thus skipped, never re-parsed), so its message uuids are absent
 * from any in-memory index — but its rows (with their `uuid`) persist. We look up
 * the owning conversation of each child's `parentUuid` via the `message` table by
 * uuid (a targeted, indexed query — never loading every message into memory), so
 * a skipped parent still resolves. An unresolved/own-session parentUuid leaves
 * the link null.
 */
async function resolveContinuedFrom(prisma: PrismaClient, writtenConversations: WrittenConversation[]): Promise<void> {
  for (const { sessionId, firstMessageParentUuid } of writtenConversations) {
    if (firstMessageParentUuid === null) continue;

    // Find the conversation that OWNS a persisted message with this uuid.
    const owner = await prisma.message.findFirst({
      where: { uuid: firstMessageParentUuid },
      select: { conversation: { select: { id: true, sessionId: true } } },
    });
    const from = owner?.conversation;
    if (from === undefined || from.sessionId === sessionId) {
      continue; // unresolved, or points within the same session.
    }

    const toId = (
      await prisma.conversation.findUnique({
        where: { sessionId },
        select: { id: true },
      })
    )?.id;
    if (toId === undefined) continue;

    await prisma.conversation.update({
      where: { id: toId },
      data: { continuedFromConversationId: from.id },
    });
  }
}

/**
 * Pass 3: mark this run's conversations as produced by the current parser — the
 * commit point that lets a later run SKIP them.
 *
 * One statement scoped to the conversations this run (re)wrote: nothing else in
 * the table is touched, so the incremental cost stays proportional to the work
 * actually done, not to the size of the database.
 */
async function stampParserVersion(prisma: PrismaClient, writtenConversations: WrittenConversation[]): Promise<void> {
  if (writtenConversations.length === 0) return;
  await prisma.conversation.updateMany({
    where: { sessionId: { in: writtenConversations.map((c) => c.sessionId) } },
    data: { parserVersion: PARSER_VERSION },
  });
}
