// Ingest spine (ADR-0001, ADR-0002). `refresh()` discovers top-level session
// files + their sub-agent transcripts, parses them, and writes ALL seven tables.
// The read seams (`listConversations()`, `getConversation()`) live in `read.ts`.
// It writes through a bare better-sqlite3 connection, not Prisma (ADR-0005);
// every statement it runs lives in `prisma/refresh-statements.ts`.
//
// ONE CONVERSATION AT A TIME, COMMITTED IN BATCHES: a conversation is parsed,
// written (delete of its prior row + every insert), then dropped — no run holds
// more than one parsed conversation. Writes share a transaction until a batch
// is full (`MAX_CONVERSATIONS_PER_BATCH`, `MAX_BATCH_DURATION_MS`); each commit
// is reported through `onProgress`. Readers on other connections (WAL, see
// `db.ts`) never find a re-parsed conversation missing.
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
import { defaultDbPath, openRefreshConnection } from "@/core/db";
import {
  decodeLogFolderName,
  defaultLogsRoot,
  type DiscoveredSession,
  discoverSessions,
  discoverSubAgents,
} from "@/core/discovery";
import { type ParsedAgentSpawn, parseSessionLines, type ParsedSession } from "@/core/parse";
import { type MessageRow, prepareRefreshStatements, type RefreshStatements } from "@/core/prisma/refresh-statements";

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
   * after each batch of conversation writes has committed. A throw aborts the run.
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
 * 4 — a Project is identified by its path: a Conversation that switches into a
 *     git worktree belongs to the worktree, and a cwd-less one borrows the
 *     Project of a sibling in its log folder.
 */
const PARSER_VERSION = 4;

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

/**
 * A write batch commits once it holds this many conversations, or once
 * {@link MAX_BATCH_DURATION_MS} has passed since it opened, whichever is first.
 * Each commit costs a WAL frame flush; batching amortizes it (sized with
 * `pnpm bench:refresh`, see ADR-0005).
 */
const MAX_CONVERSATIONS_PER_BATCH = 50;

/** A write batch commits once this long has passed since it opened (see above). */
const MAX_BATCH_DURATION_MS = 1000;

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
  /** Row id of the conversation as this run wrote it. */
  conversationId: number;
  sessionId: string;
  /** `parentUuid` of its first message: where a resumed session continues from. */
  firstMessageParentUuid: string | null;
};

/** How far a Refresh has got: conversations committed out of those it re-parses. */
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
 * with its agents/messages/tool_calls/pr_links/turn_durations, deleting its prior
 * row (cascading) in the SAME transaction, so a reader on another connection
 * sees the old version or the new one, never neither; drop the parsed content —
 * memory stays flat however large the logs grow. A transaction holds a batch of
 * conversations; once it commits, report `{ done, total }`, `done` counting the
 * conversations committed so far. Conversations whose records state no `cwd`
 * are written last, in discovery order, as they borrow their Project from the
 * siblings in their log folder (see `resolveProjectPath`); (2) resolve
 * `continued_from` by looking up each
 * child's first-message `parentUuid` against the persisted `message` rows of ALL
 * conversations — so a skipped (unchanged) parent still resolves; (3) stamp the
 * current `parserVersion` on that set — the commit mark that lets a later run
 * skip them — and delete every Project left without a Conversation. Passes 2
 * and 3 share one final transaction. The sub-agent
 * transcript is the single source of truth for its tokens (GOTCHA 3) — the
 * parent aggregate is a cross-check only.
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
  const db = openRefreshConnection(dbPath);

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
    const statements = prepareRefreshStatements(db);

    // Two files may carry the same session id (a copied transcript). Resolve
    // that HERE, before the incremental compare, so every pass below sees one
    // file per session id (see `dedupeBySessionId`).
    const { unique: discovered, duplicatesSkipped } = dedupeBySessionId(discoverWithKeys(logsRoot));
    duplicateSessionsSkipped = duplicatesSkipped;

    // Stored rows, for the skip/changed/delete decision.
    const storedConversationBySessionId = new Map(
      statements.selectStoredConversations().map((row) => [row.sessionId, row]),
    );

    // Delete conversations whose source file is gone (single delete cascades).
    const onDisk = new Set(discovered.map((d) => d.session.sessionId));
    statements.beginTransaction();
    for (const [sessionId, row] of storedConversationBySessionId) {
      if (onDisk.has(sessionId)) continue;
      statements.deleteConversation(row.id);
      conversationsDeleted += 1;
    }
    statements.commitTransaction();

    // Compare — pick the NEW or CHANGED sessions, without parsing anything, so
    // the run knows its total before its first write.
    const sessionsToReparse: SessionToReparse[] = [];

    for (const d of discovered) {
      const prior = storedConversationBySessionId.get(d.session.sessionId);
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
        prior.sourceMtime === d.compositeMtime &&
        prior.sourceSize === d.compositeSize;
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

    // Pass 1 — parse and write one conversation at a time, its parsed content
    // dropped once written, so memory stays flat however large the logs grow.
    // Writes go in batches: one transaction holds several conversations, each
    // replacing its prior row, and every commit is reported.
    const writtenConversations: WrittenConversation[] = [];
    let batchOpenedAt: number | null = null;
    const commitBatch = () => {
      statements.commitTransaction();
      batchOpenedAt = null;
      conversationsParsed = writtenConversations.length;
      endPhase("write");
      opts.onProgress?.({ done: conversationsParsed, total });
    };
    // A cwd-less Conversation borrows its Project from the siblings already
    // written (see `resolveProjectPath`), so it is set aside and parsed again
    // after every other one: re-parsing these near-empty files beats holding them.
    const cwdLessSessions: SessionToReparse[] = [];
    const parseAndWrite = (sessionToReparse: SessionToReparse, isCwdLessPass: boolean) => {
      phaseStart = performance.now();
      const parsedConversation = parseConversation(sessionToReparse);
      if (!isCwdLessPass && parsedConversation.parsed.projectPath === null) {
        cwdLessSessions.push(sessionToReparse);
        endPhase("parse");
        return;
      }
      malformedLinesSkipped += parsedConversation.parsed.malformedLines;
      for (const sub of parsedConversation.subAgents) malformedLinesSkipped += sub.parsed.malformedLines;
      endPhase("parse");

      if (batchOpenedAt === null) {
        statements.beginTransaction();
        batchOpenedAt = performance.now();
      }
      writtenConversations.push({
        conversationId: writeConversation(statements, parsedConversation),
        sessionId: parsedConversation.session.sessionId,
        firstMessageParentUuid: parsedConversation.parsed.messages[0]?.parentUuid ?? null,
      });
      const conversationsInBatch = writtenConversations.length - conversationsParsed;
      const isBatchFull =
        conversationsInBatch >= MAX_CONVERSATIONS_PER_BATCH ||
        performance.now() - batchOpenedAt >= MAX_BATCH_DURATION_MS;
      if (isBatchFull) commitBatch();
      else endPhase("write");
    };
    for (const sessionToReparse of sessionsToReparse) parseAndWrite(sessionToReparse, false);
    for (const sessionToReparse of cwdLessSessions) parseAndWrite(sessionToReparse, true);
    if (batchOpenedAt !== null) commitBatch();

    // Passes 2 and 3 share one transaction.
    phaseStart = performance.now();
    statements.beginTransaction();
    // Pass 2 — resolve continued-from over the (re)written conversations,
    // authoritatively against the persisted message uuids of ALL conversations.
    resolveContinuedFrom(statements, writtenConversations);
    endPhase("links");

    // Pass 3 — only NOW are these conversations complete: stamp them, so the
    // next run may skip them. An abort before this point leaves them unstamped
    // and therefore re-parseable (see `UNSTAMPED_PARSER_VERSION`).
    stampParserVersion(statements, writtenConversations);
    // A re-parse or a vanished file can leave a Project with no Conversation.
    statements.deleteProjectsWithoutConversations();
    statements.commitTransaction();
    endPhase("stamp");
  } finally {
    // Closing rolls back a transaction left open by a throw — that batch only:
    // what earlier batches committed stays, unstamped, for the next run.
    db.close();
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

/**
 * The path of the Project a parsed Conversation belongs to: the one its records
 * state (`ParsedSession.projectPath`); else — for a cwd-less Conversation — the
 * one most Conversations filed in the same log folder state through their own
 * records, ties to the smallest path, read from the database so siblings this
 * run skipped count; else the log folder name, decoded.
 *
 * `refresh()` writes cwd-less Conversations after every other one, so the
 * siblings of this run are already in. A cwd-less Conversation resolved while
 * its log folder had no cwd-bearing sibling keeps the decoded path until it
 * itself changes: a later sibling does not re-assign it.
 */
function resolveProjectPath(statements: RefreshStatements, session: DiscoveredSession, parsed: ParsedSession): string {
  return (
    parsed.projectPath ??
    statements.selectBorrowableProjectPath(path.dirname(session.sourcePath)) ??
    decodeLogFolderName(session.logFolderName)
  );
}

/** Find or create the row of the Project at `projectPath`. */
function upsertProject(statements: RefreshStatements, projectPath: string): number {
  return statements.selectProjectId(projectPath) ?? statements.insertProject({ path: projectPath });
}

/** The `message` row of one parsed message (FK columns + accounting). */
function messageRow(m: ParsedSession["messages"][number], conversationId: number, agentId: number): MessageRow {
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
    timestamp: m.timestamp,
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
function writeToolCalls(
  statements: RefreshStatements,
  parsed: ParsedSession,
  agentId: number,
  messageRowByMsgId: Map<string, number>,
): void {
  for (const msg of parsed.messages) {
    if (msg.toolUses.length === 0 || msg.messageId === null) continue;
    const messageRowId = messageRowByMsgId.get(msg.messageId);
    if (messageRowId === undefined) continue;

    for (const tu of msg.toolUses) {
      const result = tu.toolUseId === null ? undefined : parsed.toolResults.get(tu.toolUseId);
      const fullResult = result?.resultText ?? null;
      const truncated = fullResult !== null && fullResult.length > RESULT_TRUNCATE_CHARS;
      statements.insertToolCall({
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
}

/**
 * Insert `parsed.messages` for one agent, in order, and return a
 * `message.id → row id` map (for tool_call + spawnedBy linkage). When two rows
 * share a `message.id`, the later row wins.
 */
function writeAgentMessages(
  statements: RefreshStatements,
  parsed: ParsedSession,
  conversationId: number,
  agentId: number,
): Map<string, number> {
  const messageRowByMsgId = new Map<string, number>();
  for (const message of parsed.messages) {
    const messageRowId = statements.insertMessage(messageRow(message, conversationId, agentId));
    if (message.messageId !== null) messageRowByMsgId.set(message.messageId, messageRowId);
  }
  return messageRowByMsgId;
}

/**
 * Replace one conversation, inside the caller's transaction: delete its prior
 * row (if any), then write it + root agent + messages + tool_calls, then each
 * sub-agent (its own agent row + messages + tool_calls), then pr_links and
 * turn_durations, and return the new conversation's row id. The conversations
 * that continued from the prior row are re-pointed at the new one. Sub-agent
 * `spawnedByMessageId` is linked via the spawning `Agent` tool_use that produced
 * the matching `agentId` (log-format §4) — in whichever transcript that ledger
 * lives, main thread or another sub-agent (see `planSubAgents`);
 * `agentType`/`resolvedModel` come from that spawn ledger.
 *
 * Rows go in this exact order, so a fresh database gets the same row ids on
 * every run (`stored-data-equivalence.test.ts` pins them).
 */
function writeConversation(statements: RefreshStatements, parsedConversation: ParsedConversation): number {
  const { session, parsed, subAgents, priorConversationId } = parsedConversation;

  // The prior row goes in the SAME transaction as its replacement (cascading
  // to every child table), so a reader on another connection sees the old
  // version or the new one — never the conversation missing. The delete nulls
  // the continued-from link of every child (`onDelete: SetNull`), so their ids
  // are read first and re-pointed at the new row below — a skipped child is
  // not re-linked by `resolveContinuedFrom`.
  let continuingConversationIds: number[] = [];
  if (priorConversationId !== null) {
    continuingConversationIds = statements.selectContinuingConversationIds(priorConversationId);
    statements.deleteConversation(priorConversationId);
  }
  const projectId = upsertProject(statements, resolveProjectPath(statements, session, parsed));

  const conversationId = statements.insertConversation({
    sessionId: session.sessionId,
    projectId,
    projectPathFromRecords: parsed.projectPath !== null,
    title: parsed.title,
    gitBranch: parsed.gitBranch,
    ccVersion: parsed.ccVersion,
    sourcePath: session.sourcePath,
    sourceMtime: session.sourceMtime,
    sourceSize: session.sourceSize,
    // Not stamped yet — pass 3 does that once this refresh's continuation
    // linking has run (see `UNSTAMPED_PARSER_VERSION`).
    parserVersion: UNSTAMPED_PARSER_VERSION,
    continuedFromConversationId: null,
  });
  if (continuingConversationIds.length > 0) {
    statements.updateContinuedFrom(continuingConversationIds, conversationId);
  }

  const rootAgentId = statements.insertAgent({
    conversationId,
    parentAgentId: null,
    externalAgentId: null,
    spawnedByMessageId: null,
    agentType: null, // root/main thread
    resolvedModel: parsed.dominantModel,
  });

  const rootByMsgId = writeAgentMessages(statements, parsed, conversationId, rootAgentId);
  writeToolCalls(statements, parsed, rootAgentId, rootByMsgId);

  // Sub-agents: each transcript is its own agent row (single source of truth
  // for its tokens — the parent aggregate is NOT summed). Linked back to the
  // spawning Agent tool_use via the spawn ledger's agentId → tool_use_id —
  // that ledger may live in ANOTHER sub-agent's transcript (a sub-agent can
  // itself spawn sub-agents), so parentage is resolved across every transcript
  // and the rows are written parents-first.
  const written = new Map<string, AgentWriteTarget>();
  const rootTarget: AgentWriteTarget = {
    agentRowId: rootAgentId,
    parsed,
    messageRowByMsgId: rootByMsgId,
  };

  for (const plan of planSubAgents(parsed, subAgents)) {
    const parent = plan.parentExternalId === null ? rootTarget : (written.get(plan.parentExternalId) ?? rootTarget);
    const spawnedByMessageId =
      plan.spawn?.toolUseId == null
        ? null
        : (toolUseToMessageRow(parent.parsed, plan.spawn.toolUseId, parent.messageRowByMsgId) ?? null);

    const subAgentId = statements.insertAgent({
      conversationId,
      parentAgentId: parent.agentRowId,
      externalAgentId: plan.agentId,
      spawnedByMessageId,
      agentType: plan.spawn?.agentType ?? null,
      resolvedModel: plan.spawn?.resolvedModel ?? plan.parsed.dominantModel,
    });

    const subByMsgId = writeAgentMessages(statements, plan.parsed, conversationId, subAgentId);
    writeToolCalls(statements, plan.parsed, subAgentId, subByMsgId);
    written.set(plan.agentId, {
      agentRowId: subAgentId,
      parsed: plan.parsed,
      messageRowByMsgId: subByMsgId,
    });
  }

  for (const prLink of parsed.prLinks) {
    statements.insertPrLink({
      conversationId,
      prNumber: prLink.prNumber,
      prUrl: prLink.prUrl,
      prRepository: prLink.prRepository,
    });
  }

  for (const turnDuration of parsed.turnDurations) {
    statements.insertTurnDuration({
      conversationId,
      durationMs: turnDuration.durationMs,
      messageCount: turnDuration.messageCount,
    });
  }

  return conversationId;
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
function resolveContinuedFrom(statements: RefreshStatements, writtenConversations: WrittenConversation[]): void {
  for (const { conversationId, sessionId, firstMessageParentUuid } of writtenConversations) {
    if (firstMessageParentUuid === null) continue;

    // Find the conversation that OWNS a persisted message with this uuid.
    const from = statements.selectMessageOwner(firstMessageParentUuid);
    if (from === undefined || from.sessionId === sessionId) {
      continue; // unresolved, or points within the same session.
    }

    statements.updateContinuedFrom([conversationId], from.id);
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
function stampParserVersion(statements: RefreshStatements, writtenConversations: WrittenConversation[]): void {
  statements.updateParserVersion(
    writtenConversations.map((c) => c.conversationId),
    PARSER_VERSION,
  );
}
