// Ingest spine (ADR-0001, ADR-0002). `refresh()` discovers top-level session
// files + their sub-agent transcripts, parses them, and writes ALL seven tables.
// The read seams (`listConversations()`, `getConversation()`) live in `read.ts`.
//
// INCREMENTAL REFRESH (Slice 5): `refresh()` skips conversations whose source
// has not changed, re-parses changed/new ones, and drops conversations whose
// source file disappeared. The change key is a COMPOSITE of the main session
// file PLUS its sub-agent transcripts (max mtime, summed size) — a sub-agent
// file changing alone (the main file untouched) still triggers a re-parse,
// because sub-agents have no independent conversation/mtime row of their own.
//
// ROLLUP DESIGN (ADR-0001): conversation totals/cost are SUM queries over ALL
// messages of ALL agents in the conversation — so sub-agent tokens roll up
// automatically, counted ONCE (the parent Agent aggregate is never summed in).

import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  createPrismaClient,
  DEFAULT_DB_PATH,
} from "@/core/db";
import {
  decodeFolderName,
  DEFAULT_LOGS_ROOT,
  type DiscoveredSession,
  discoverSessions,
  discoverSubAgents,
} from "@/core/discovery";
import { parseSessionLines, type ParsedSession } from "@/core/parse";
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

export type RefreshSummary = {
  conversationsParsed: number;
  conversationsSkipped: number;
  conversationsDeleted: number;
  malformedLinesSkipped: number;
  durationMs: number;
};

type RefreshOptions = { logsRoot?: string; dbPath?: string };

/** One main session + its sub-agent transcripts, all parsed, ready to write. */
type ParsedConversation = {
  session: DiscoveredSession;
  parsed: ParsedSession;
  subAgents: { agentId: string; parsed: ParsedSession }[];
  /** Existing conversation row id to delete before re-write (null = new). */
  priorId: number | null;
};

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
 * `conversation.sourceMtime`/`sourceSize`. Unchanged conversations are skipped
 * (not re-parsed). Changed conversations are deleted (cascading to all child
 * tables) and re-written, so a re-parse never duplicates rows. New conversations
 * are written. Conversations whose source file no longer exists are deleted.
 *
 * Then two passes over the (re)parsed set only: (1) write each conversation with
 * its agents/messages/tool_calls/pr_links/turn_durations (each in a transaction,
 * finding #11), persisting each message's `uuid`; (2) resolve `continued_from` by
 * looking up each child's first-message `parentUuid` against the persisted
 * `message` rows of ALL conversations — so a skipped (unchanged) parent still
 * resolves. The sub-agent transcript is the single source of truth for its tokens
 * (GOTCHA 3) — the parent aggregate is a cross-check only.
 */
export async function refresh(opts: RefreshOptions = {}): Promise<RefreshSummary> {
  // Monotonic clock for the elapsed measure: `Date.now()` can jump BACKWARD on a
  // wall-clock adjustment (NTP, or WSL2 resuming from sleep), which produced a
  // nonsensical NEGATIVE durationMs in the refresh digest. `performance.now()`
  // never goes back.
  const start = performance.now();
  const logsRoot = opts.logsRoot ?? DEFAULT_LOGS_ROOT;
  const dbPath = opts.dbPath ?? DEFAULT_DB_PATH;
  const prisma = createPrismaClient(dbPath);

  let conversationsParsed = 0;
  let conversationsSkipped = 0;
  let conversationsDeleted = 0;
  let malformedLinesSkipped = 0;

  try {
    const discovered = discoverWithKeys(logsRoot);

    // Existing rows, keyed by sessionId, for the skip/changed/delete decision.
    const existing = new Map<string, { id: number; mtime: bigint; size: bigint }>();
    for (const row of await prisma.conversation.findMany({
      select: { id: true, sessionId: true, sourceMtime: true, sourceSize: true },
    })) {
      existing.set(row.sessionId, {
        id: row.id,
        mtime: row.sourceMtime,
        size: row.sourceSize,
      });
    }

    // Delete conversations whose source file is gone (single delete cascades).
    const onDisk = new Set(discovered.map((d) => d.session.sessionId));
    for (const [sessionId, row] of existing) {
      if (onDisk.has(sessionId)) continue;
      await prisma.conversation.delete({ where: { id: row.id } });
      conversationsDeleted += 1;
    }

    // Pass 1a — parse only NEW or CHANGED sessions.
    const conversations: ParsedConversation[] = [];

    for (const d of discovered) {
      const prior = existing.get(d.session.sessionId);
      const unchanged =
        prior !== undefined &&
        prior.mtime === BigInt(d.compositeMtime) &&
        prior.size === BigInt(d.compositeSize);
      if (unchanged) {
        conversationsSkipped += 1;
        continue;
      }

      // Store the COMPOSITE key on the conversation row so a later run can detect
      // a sub-agent-only change (the main file's own mtime/size alone would not).
      const session: DiscoveredSession = {
        ...d.session,
        sourceMtime: d.compositeMtime,
        sourceSize: d.compositeSize,
      };

      const parsed = parseSession(session.sourcePath);
      malformedLinesSkipped += parsed.malformedLines;

      const subAgents: { agentId: string; parsed: ParsedSession }[] = [];
      for (const sub of d.subAgentPaths) {
        const subParsed = parseSession(sub.sourcePath);
        malformedLinesSkipped += subParsed.malformedLines;
        subAgents.push({ agentId: sub.agentId, parsed: subParsed });
      }

      conversations.push({ session, parsed, subAgents, priorId: prior?.id ?? null });
    }

    // Pass 1b — (re)write each parsed conversation. A CHANGED conversation's old
    // rows are deleted first (cascade) so the re-parse never duplicates rows.
    for (const convo of conversations) {
      if (convo.priorId !== null) {
        await prisma.conversation.delete({ where: { id: convo.priorId } });
      }
      await writeConversation(prisma, convo);
      conversationsParsed += 1;
    }

    // Pass 2 — resolve continued-from over the (re)parsed conversations,
    // authoritatively against the persisted message uuids of ALL conversations.
    await resolveContinuedFrom(prisma, conversations);
  } finally {
    await prisma.$disconnect();
  }

  return {
    conversationsParsed,
    conversationsSkipped,
    conversationsDeleted,
    malformedLinesSkipped,
    durationMs: Math.round(performance.now() - start),
  };
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
    const subAgentPaths = discoverSubAgents(projectDir, session.sessionId).map(
      (s) => ({ agentId: s.agentId, sourcePath: s.sourcePath }),
    );

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

/** Resolve (find-or-create) the project row for an on-disk folder. */
async function upsertProject(
  prisma: PrismaClient,
  folder: string,
  parsed: ParsedSession,
): Promise<number> {
  const projectPath = parsed.cwd ?? decodeFolderName(folder);
  const existing = await prisma.project.findUnique({
    where: { path: projectPath },
  });
  if (existing) return existing.id;
  const created = await prisma.project.create({
    data: { path: projectPath, folderName: folder },
  });
  return created.id;
}

/** The message-row shape written by `createMany` (FK columns + accounting). */
function messageData(
  m: ParsedSession["messages"][number],
  conversationId: number,
  agentId: number,
) {
  return {
    conversationId,
    agentId,
    messageId: m.messageId,
    uuid: m.uuid,
    role: m.role,
    text: m.text,
    inputTokens: m.inputTokens,
    outputTokens: m.outputTokens,
    cacheCreation5mTokens: m.cacheCreation5mTokens,
    cacheCreation1hTokens: m.cacheCreation1hTokens,
    cacheReadTokens: m.cacheReadTokens,
    model: m.model,
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
      const result =
        tu.toolUseId === null ? undefined : parsed.toolResults.get(tu.toolUseId);
      const fullResult = result?.resultText ?? null;
      const truncated =
        fullResult !== null && fullResult.length > RESULT_TRUNCATE_CHARS;
      rows.push({
        messageId: messageRowId,
        agentId,
        toolUseId: tu.toolUseId,
        name: tu.name,
        inputJson: tu.inputJson,
        resultText:
          fullResult === null ? null : fullResult.slice(0, RESULT_TRUNCATE_CHARS),
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
 * Write one conversation + root agent + messages + tool_calls, then each
 * sub-agent (its own agent row + messages + tool_calls), then pr_links and
 * turn_durations — all in one transaction. Sub-agent `spawnedByMessageId` is
 * linked via the parent `Agent` tool_use that produced the matching `agentId`
 * (log-format §4); `agentType`/`resolvedModel` come from that spawn ledger.
 */
async function writeConversation(
  prisma: PrismaClient,
  convo: ParsedConversation,
): Promise<void> {
  const { session, parsed, subAgents } = convo;
  const projectId = await upsertProject(prisma, session.folder, parsed);

  await prisma.$transaction(async (tx) => {
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
        continuedFromConversationId: null,
      },
    });

    const rootAgent = await tx.agent.create({
      data: {
        conversationId: conversation.id,
        parentAgentId: null,
        agentType: null, // root/main thread
        resolvedModel: parsed.dominantModel,
      },
    });

    const rootByMsgId = await writeAgentMessages(
      tx,
      parsed,
      conversation.id,
      rootAgent.id,
    );
    await writeToolCalls(tx, parsed, rootAgent.id, rootByMsgId);

    // Sub-agents: each transcript is its own agent row (single source of truth
    // for its tokens — the parent aggregate is NOT summed). Linked back to the
    // spawning Agent tool_use via the spawn ledger's agentId → tool_use_id.
    for (const sub of subAgents) {
      const spawn = parsed.agentSpawns.get(sub.agentId);
      const spawnedByMessageId =
        spawn?.toolUseId == null
          ? null
          : (toolUseToMessageRow(parsed, spawn.toolUseId, rootByMsgId) ?? null);

      const subAgent = await tx.agent.create({
        data: {
          conversationId: conversation.id,
          parentAgentId: rootAgent.id,
          externalAgentId: sub.agentId,
          spawnedByMessageId,
          agentType: spawn?.agentType ?? null,
          resolvedModel: spawn?.resolvedModel ?? sub.parsed.dominantModel,
        },
      });

      const subByMsgId = await writeAgentMessages(
        tx,
        sub.parsed,
        conversation.id,
        subAgent.id,
      );
      await writeToolCalls(tx, sub.parsed, subAgent.id, subByMsgId);
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
  });
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
async function resolveContinuedFrom(
  prisma: PrismaClient,
  conversations: ParsedConversation[],
): Promise<void> {
  for (const convo of conversations) {
    const first = convo.parsed.messages[0];
    if (first?.parentUuid == null) continue;

    // Find the conversation that OWNS a persisted message with this uuid.
    const owner = await prisma.message.findFirst({
      where: { uuid: first.parentUuid },
      select: { conversation: { select: { id: true, sessionId: true } } },
    });
    const from = owner?.conversation;
    if (from === undefined || from.sessionId === convo.session.sessionId) {
      continue; // unresolved, or points within the same session.
    }

    const toId = (
      await prisma.conversation.findUnique({
        where: { sessionId: convo.session.sessionId },
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

