// Read API (ADR-0001, ADR-0002). `listConversations()` and `getConversation()`
// are the stable read seams over the thirteen tables written by `refresh()`
// (the ingest spine, in `refresh.ts`). This module is read-only — it issues SUM
// queries and prices/assembles summaries, and never writes.
//
// ROLLUP DESIGN (ADR-0001, ADR-0011): every usage figure — Cost, token totals,
// every breakdown — is a SUM over `turn`, one row per API response, owned by
// one Agent of one Conversation: sub-agent tokens roll up automatically,
// counted ONCE (the parent Agent aggregate is never summed in), and a
// Conversation counts only what it spent itself, never the history it copied.
// Error counts and time spans stay on `message`.

import { type CostByType, priceSplitByType, resolveModel, type TokenSplit, type Tokens } from "@/core/cost";
import { readClient } from "@/core/db";
import { conversationInFolderScope } from "@/core/folder-scope";
import type { FolderScope } from "@/lib/project-path";
import { addLocalDays, localDayKey, startOfLocalDay } from "@/core/local-day";
import { type MessageOrigin, messageOriginSchema } from "@/core/parse";
import type { Prisma, PrismaClient } from "@/core/prisma/generated/client";
import { PARSER_VERSION } from "@/core/refresh";
import { toolCallBodyParts, type ToolCallBodyParts } from "@/core/tool-call-views";
import { orderedBefore, REVERSE_TRANSCRIPT_ORDER, TRANSCRIPT_ORDER } from "@/core/transcript-order";
import { failedAttemptsByMessage } from "@/core/what-was-sent";

export type ConversationSummary = {
  id: string;
  title: string | null;
  project: { path: string };
  startedAt: string;
  endedAt: string;
  models: { dominant: string; distinctCount: number };
  tokens: Tokens;
  costUsd: number;
  /**
   * Per-bucket dollar split of `costUsd` (ADR-0003), accumulated across every
   * model at its own per-tier rate. The four buckets sum exactly to `costUsd`;
   * unpriced models contribute `$0` to their buckets.
   */
  costByType: CostByType;
  unpriced: boolean;
  subAgentCount: number;
  continuedFromId: string | null;
  /**
   * Number of turns the API failed on, across EVERY agent of the conversation
   * (ADR-0001 rollup): a sub-agent's failed turn counts here just like its
   * tokens do, so the list row shows the conversation's real error weight.
   * `0` for a conversation that never failed.
   */
  errorCount: number;
  /** When its log or a sub-agent transcript last changed (ISO), as of the last Refresh. */
  sourceChangedAt: string;
};

/**
 * The detail view of one conversation. Extends the SAME `ConversationSummary`
 * (the base fields match `listConversations` exactly) with three breakdowns, all
 * computed by SUM queries over the Turns its agents own (ADR-0001, ADR-0011):
 *  - `perModel`: every model group across root + sub-agents, exact per-tier cost.
 *  - `subAgents`: one entry per sub-agent transcript (the source of truth).
 *  - `perSkill`: exact per-skill cost via per-turn attribution.
 */
export type ConversationDetail = ConversationSummary & {
  perModel: { model: string; tokens: Tokens; costUsd: number; unpriced: boolean }[];
  subAgents: {
    agentId: string;
    agentType: string;
    model: string;
    tokens: Tokens;
    costUsd: number;
  }[];
  perSkill: { skill: string; tokens: Tokens; costUsd: number }[];
};

/**
 * One `tool_use` block on an assistant turn, as its summary needs it (raw
 * fields; the app classifies kind). The result text is left to
 * {@link getToolCallBody}, read when the call is opened.
 */
export type TranscriptToolCall = {
  /** Row id — the key {@link getToolCallBody} reads this call's body by. */
  id: number;
  /** `tool_use` block id — correlates to a spawned agent's `spawnedByToolUseId`. */
  toolUseId: string | null;
  /** Tool name (`Bash`, `Skill`, `Agent`, …). */
  name: string;
  /** Full tool input, serialized JSON (the app extracts snippets). */
  inputJson: string;
  resultTruncated: boolean;
  /** Full (untruncated) result length — a token-cost proxy; NULL until paired. */
  resultCharSize: number | null;
  isError: boolean;
};

/**
 * A user Message's extras ({@link MessageOrigin}) plus the agents they point
 * at, resolved to `?agent=` keys of this conversation's tree.
 */
export type TranscriptMessageOrigin = MessageOrigin & {
  /** Sender's tree key: the Sub-agent named by `senderTaskId`, or the parent agent for a coordinator message. */
  senderAgentId: string | null;
  /** Tree key of the Sub-agent a Task notification is about (its `taskId`); null for other tasks. */
  taskAgentId: string | null;
};

/** The occurrence that owns a Copied Message (ADR-0011): where its Transcript shows that Message. */
export type CopiedMessageOwner = {
  /** The owning Conversation's session id. */
  sessionId: string;
  /** The owning Conversation's title; null when it has none. */
  title: string | null;
  /** Tree key of the owning Agent (its `?agent=`); null when it is that Conversation's Main thread. */
  agentId: string | null;
  /** The owning occurrence's record `uuid`, its deep-link anchor; on a re-written spawn record, not the copy's. */
  messageUuid: string | null;
};

/** One rendered message of a single agent's transcript. */
export type TranscriptMessage = {
  /** `message` row id — stable per message; a spawn's `spawnedByMessageId` points here. */
  id: number;
  /**
   * Record `uuid` from the log — the DEEP-LINK anchor (`?msg=`/`#msg-<uuid>`).
   * The row id above cannot serve: it is re-assigned on every re-parse, so a
   * shared or bookmarked link would rot. Null when the record carried no uuid;
   * such a message is simply not anchorable.
   */
  uuid: string | null;
  /** `user` | `assistant`. */
  role: string;
  /**
   * On user rows `prompt`, `inter-agent` or `task-notification` (tool-result
   * and meta are filtered out); null on assistant.
   */
  kind: string | null;
  /** The display body (an Inter-agent message without its wrapper, a Task notification's result). */
  text: string | null;
  /** The user row's extras with their agent links resolved; null when none (or unreadable). */
  origin: TranscriptMessageOrigin | null;
  model: string | null;
  /**
   * Reasoning effort of this assistant turn, verbatim (`high`, `xhigh`, …).
   * Null on user prompts and on turns whose log predates the field. The pane
   * derives uniform-vs-mixed and the change markers from these values.
   */
  effort: string | null;
  /** The summary the model's thinking left on this Turn, when not empty; null on user rows (log-format §3, "Thinking"). */
  thinkingText: string | null;
  /** How long this Turn spent thinking; null when its log did not record it, and on user rows. */
  thinkingDurationMs: number | null;
  /**
   * Its Turn's merged token split, on the occurrence that owns the Turn; null
   * on user prompts (they have no usage) and on a copy another occurrence owns.
   */
  tokens: Tokens | null;
  /** Exact per-tier cost of its Turn, on the owning occurrence ($0 on user prompts, copies and unpriced models). */
  costUsd: number;
  unpriced: boolean;
  isApiError: boolean;
  apiErrorMessage: string | null;
  /** A Copied Message (GLOSSARY.md): history this Agent holds and another one owns, not its own work. */
  isCopied: boolean;
  /** On a Copied Message, the occurrence that owns it; null on a Message this Agent owns. */
  copiedFrom: CopiedMessageOwner | null;
  /** Record timestamp as an ISO string (null when absent). */
  timestamp: string | null;
  /** `tool_use` blocks on this (assistant) turn, in stored order. */
  toolCalls: TranscriptToolCall[];
  /**
   * The `api_request` row id this Turn's What was sent is read by: its
   * API request in its own file, else in another Conversation's file (a
   * resumed or forked session's copied history). Null when no file holds it,
   * and on user Messages.
   */
  apiRequestId: number | null;
  /** How many Failed attempts preceded this Turn's API request; 0 without any, and on user Messages. */
  failedAttemptCount: number;
  /**
   * The time its Failed attempts lost in all: those whose lost time the logs
   * know, summed. Null without any, or without a known lost time.
   */
  failedAttemptsLostMs: number | null;
};

/** One node of the agent tree — an agent plus its own-transcript cost and lineage. */
export type TranscriptAgentNode = {
  /** Stable `?agent=` URL key: `externalAgentId ?? String(id)` (matches the cost panel). */
  id: string;
  /** Raw `agent_type` — null/empty on the main thread (the app maps empty → "main"). */
  agentType: string | null;
  /** Concrete model the agent ran on (label source; may be null). */
  resolvedModel: string | null;
  /** Own-transcript cost — the Turns THIS agent owns only, priced per-tier (not rolled up). */
  costUsd: number;
  /** Own-transcript tokens (the Turns this agent owns only). */
  tokens: Tokens;
  unpriced: boolean;
  /** True when any of this agent's turns recorded an API error (the error dot). */
  hasError: boolean;
  /** Count of this agent's hidden `meta` user records (for the "N meta hidden" marker). */
  metaCount: number;
  /** Parent-transcript `TranscriptMessage.id` whose Agent tool call spawned this node; null for main. */
  spawnedByMessageId: number | null;
  /** The spawning Agent tool_use id (matches a parent `TranscriptToolCall.toolUseId`); null when unavailable. */
  spawnedByToolUseId: string | null;
  /** Sub-agents, nested by lineage and ordered by spawn time. */
  children: TranscriptAgentNode[];
};

/**
 * The whole Transcript view for one session: the agent tree (both panes' left
 * side) plus ONE selected agent's rendered transcript (the right pane). All
 * fields are plain/serializable (ISO strings, numbers).
 */
export type TranscriptView = {
  sessionId: string;
  title: string | null;
  /** When its log or a sub-agent transcript last changed (ISO), as {@link ConversationSummary} has it. */
  sourceChangedAt: string;
  /** The root/main agent, with sub-agents nested under it by lineage. */
  tree: TranscriptAgentNode;
  /** Conversation grand total — every agent's own cost (counted once). */
  totalCostUsd: number;
  totalTokens: Tokens;
  /** True when some usage of the grand total is on a model without a known price. */
  hasUnpriced: boolean;
  /** The resolved selected-agent key actually rendered in `messages`. */
  selectedAgentId: string;
  /** One Transcript page of the selected agent's transcript, in timestamp/id order. */
  messages: TranscriptMessage[];
  /** The 1-based Transcript page `messages` is, clamped to the pages that exist. */
  page: number;
  /** How many Transcript pages the selected agent's transcript spans; 1 when empty. */
  pageCount: number;
  /** How many rendered messages a full Transcript page holds. */
  pageSize: number;
  /** Rendered messages in the selected agent's WHOLE transcript, across every page. */
  messageCount: number;
  /** Assistant turns in the selected agent's whole transcript. */
  turnCount: number;
  /** Tool calls in the selected agent's whole transcript. */
  toolCallCount: number;
  /** The distinct reasoning-effort levels of the selected agent's whole transcript, sorted. */
  effortLevels: string[];
  /**
   * Effort of the last effort-carrying message on an EARLIER page — the
   * baseline this page's first effort change is measured against. Null on
   * page 1, or when no earlier message carries effort.
   */
  effortBefore: string | null;
  /** Meta user records hidden from the selected agent's whole transcript. */
  metaHiddenCount: number;
};

/** How many rendered messages one Transcript page holds. */
export const TRANSCRIPT_PAGE_SIZE = 200;

type ListOptions = {
  sortBy?: keyof ConversationSummary;
  dir?: "asc" | "desc";
  /** Additional (non-seam) opt for isolated DBs in refresh + tests. */
  dbPath?: string;
};

/**
 * Read all conversations as `ConversationSummary[]`. Totals and cost are computed
 * as SUM queries over the Turns every agent of the conversation owns (ADR-0011),
 * so sub-agents added in Slice 4 roll up automatically.
 */
export async function listConversations(opts: ListOptions = {}): Promise<ConversationSummary[]> {
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    // O(1) queries regardless of conversation count (no per-conversation loop):
    // one findMany + four batched groupBys + one continued-from resolve. Usage
    // buckets on the owning `turn.conversationId`, the rest on
    // `message.conversationId` (both denormalized, sub-agents included), then
    // per-conversation summaries are assembled in JS.
    const conversations = await prisma.conversation.findMany({
      include: { project: true },
    });

    const modelSums = await prisma.turn.groupBy({
      by: ["conversationId", "model"],
      _sum: TOKEN_SUM,
    });
    const timeSpans = await prisma.message.groupBy({
      by: ["conversationId"],
      _min: { timestamp: true },
      _max: { timestamp: true },
    });
    const subAgentCounts = await prisma.agent.groupBy({
      by: ["conversationId"],
      where: { parentAgentId: { not: null } },
      _count: { _all: true },
    });
    // Failed turns per conversation, one batched groupBy like the rollups above
    // (never a per-conversation query). Scoped on the denormalized
    // `message.conversationId`, so sub-agent failures are counted too.
    const errorCounts = await prisma.message.groupBy({
      by: ["conversationId"],
      where: { isApiError: true },
      _count: { _all: true },
    });

    // Bucket the batched rows by conversationId.
    const modelRowsById = new Map<number, ModelSumRow[]>();
    for (const g of modelSums) {
      let rows = modelRowsById.get(g.conversationId);
      if (rows === undefined) {
        rows = [];
        modelRowsById.set(g.conversationId, rows);
      }
      rows.push(toModelSumRow(g));
    }
    const boundsById = new Map<number, { startedAt: string; endedAt: string }>();
    for (const t of timeSpans) {
      boundsById.set(t.conversationId, isoBounds(t._min.timestamp, t._max.timestamp));
    }
    const subCountById = new Map<number, number>();
    for (const c of subAgentCounts) {
      subCountById.set(c.conversationId, c._count._all);
    }
    const errorCountById = new Map<number, number>();
    for (const c of errorCounts) {
      errorCountById.set(c.conversationId, c._count._all);
    }
    const continuedFromById = await resolveContinuedFromIds(prisma, conversations);

    const summaries = conversations.map((convo) =>
      assembleSummary(convo, {
        groups: pricedRollup(modelRowsById.get(convo.id) ?? []),
        bounds: boundsById.get(convo.id) ?? { startedAt: "", endedAt: "" },
        subAgentCount: subCountById.get(convo.id) ?? 0,
        errorCount: errorCountById.get(convo.id) ?? 0,
        continuedFromId:
          convo.continuedFromConversationId === null
            ? null
            : (continuedFromById.get(convo.continuedFromConversationId) ?? null),
      }),
    );

    if (opts.sortBy) {
      sortSummaries(summaries, opts.sortBy, opts.dir ?? "asc");
    }
    return summaries;
  } finally {
    // Only a caller-owned (non-default) client is disconnected; the shared
    // default singleton stays open for the next request.
    if (owned) await prisma.$disconnect();
  }
}

/**
 * Resolve every referenced `continuedFromConversationId` → its sessionId in ONE
 * query (was a per-conversation lookup inside the summarizer). Returns a map
 * keyed by the referenced conversation's numeric id.
 */
async function resolveContinuedFromIds(
  prisma: PrismaClient,
  conversations: { continuedFromConversationId: number | null }[],
): Promise<Map<number, string>> {
  const referenced = [
    ...new Set(conversations.map((c) => c.continuedFromConversationId).filter((id): id is number => id !== null)),
  ];
  const out = new Map<number, string>();
  if (referenced.length === 0) return out;
  const rows = await prisma.conversation.findMany({
    where: { id: { in: referenced } },
    select: { id: true, sessionId: true },
  });
  for (const r of rows) out.set(r.id, r.sessionId);
  return out;
}

type DetailOptions = { dbPath?: string };

/**
 * Detail read API: the full `ConversationDetail` for one session id, or `null`
 * if unknown. The base fields reuse the SAME summarizer as `listConversations`
 * (so they match exactly); the three breakdowns are independent SUM queries over
 * the Turns every agent owns (sub-agent tokens roll up automatically, counted once).
 */
export async function getConversation(id: string, opts: DetailOptions = {}): Promise<ConversationDetail | null> {
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    const convo = await prisma.conversation.findUnique({
      where: { sessionId: id },
      include: { project: true },
    });
    if (convo === null) return null;

    // One rollup feeds BOTH the base summary and perModel (was priced twice).
    const { summary, groups } = await summarizeConversation(prisma, convo);
    const perModel = groups.map((g) => ({
      model: g.model,
      tokens: g.tokens,
      costUsd: g.costUsd,
      unpriced: g.unpriced,
    }));
    const perSkill = await pricedGroupsBySkill(prisma, convo.id);
    const subAgents = await subAgentBreakdown(prisma, convo.id);

    return { ...summary, perModel, subAgents, perSkill };
  } finally {
    // Only a caller-owned (non-default) client is disconnected; the shared
    // default singleton stays open for the next request.
    if (owned) await prisma.$disconnect();
  }
}

/**
 * Per-skill rollup — exact cost via per-turn attribution (ADR-0001): the
 * Conversation's own Turns, each under its owning occurrence's skill.
 */
async function pricedGroupsBySkill(
  prisma: PrismaClient,
  conversationId: number,
): Promise<{ skill: string; tokens: Tokens; costUsd: number }[]> {
  // Each Turn row priced at its own model's rate through `pricedRollup`
  // (which prices+merges by model), then merged per skill (a skill may drive
  // >1 model's turns). Attribution is the owning occurrence's: one join hop.
  const turns = await prisma.turn.findMany({
    where: {
      conversationId,
      model: { not: null },
      message: { attributionSkill: { not: null } },
    },
    orderBy: { id: "asc" },
    select: { ...TOKEN_SUM, model: true, message: { select: { attributionSkill: true } } },
  });

  const bySkill = new Map<string, ModelSumRow[]>();
  const order: string[] = [];
  for (const turn of turns) {
    const skill = turn.message.attributionSkill as string;
    let rows = bySkill.get(skill);
    if (rows === undefined) {
      rows = [];
      bySkill.set(skill, rows);
      order.push(skill);
    }
    rows.push(turn);
  }

  return order.map((skill) => {
    const groups = pricedRollup(bySkill.get(skill) as ModelSumRow[]);
    const tokens: Tokens = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 };
    let costUsd = 0;
    for (const g of groups) {
      addTokens(tokens, g.tokens);
      costUsd += g.costUsd;
    }
    return { skill, tokens, costUsd };
  });
}

/** One entry per sub-agent row — its summed tokens + exact per-model cost. */
async function subAgentBreakdown(
  prisma: PrismaClient,
  conversationId: number,
): Promise<ConversationDetail["subAgents"]> {
  const subs = await prisma.agent.findMany({
    where: { conversationId, parentAgentId: { not: null } },
    select: { id: true, externalAgentId: true, agentType: true, resolvedModel: true },
  });

  const costs = await ownCostByAgent(
    prisma,
    subs.map((s) => s.id),
  );
  return subs.map((sub) => {
    const c = costs.get(sub.id) ?? { tokens: emptyTokens(), costUsd: 0 };
    return {
      agentId: sub.externalAgentId ?? String(sub.id),
      agentType: sub.agentType ?? "",
      model: sub.resolvedModel ?? "",
      tokens: c.tokens,
      costUsd: c.costUsd,
    };
  });
}

/** A zeroed `Tokens` accumulator. */
function emptyTokens(): Tokens {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 };
}

/** One agent's own-transcript cost — the Turns it owns only, priced per-tier. */
type OwnCost = { tokens: Tokens; costUsd: number; unpriced: boolean };

/**
 * Own-transcript cost for each agent in `agentIds` (the Turns it OWNS only, NOT
 * rolled up with children). One batched per-(agent, model) groupBy for ALL
 * agents (never N+1), folded through the shared `pricedRollup`. This is the
 * single source of the per-agent own-cost used by both the sub-agent breakdown
 * (detail panel) and the Transcript agent tree, so their numbers match exactly.
 */
async function ownCostByAgent(prisma: PrismaClient, agentIds: number[]): Promise<Map<number, OwnCost>> {
  const out = new Map<number, OwnCost>();
  if (agentIds.length === 0) return out;

  const grouped = await prisma.turn.groupBy({
    by: ["agentId", "model"],
    where: { agentId: { in: agentIds }, model: { not: null } },
    _sum: TOKEN_SUM,
  });

  const rowsByAgent = new Map<number, ModelSumRow[]>();
  for (const g of grouped) {
    let rows = rowsByAgent.get(g.agentId);
    if (rows === undefined) {
      rows = [];
      rowsByAgent.set(g.agentId, rows);
    }
    rows.push(toModelSumRow(g));
  }

  for (const id of agentIds) {
    const groups = pricedRollup(rowsByAgent.get(id) ?? []);
    const tokens = emptyTokens();
    let costUsd = 0;
    let unpriced = false;
    for (const g of groups) {
      addTokens(tokens, g.tokens);
      costUsd += g.costUsd;
      if (g.unpriced) unpriced = true;
    }
    out.set(id, { tokens, costUsd, unpriced });
  }
  return out;
}

type TranscriptOptions = {
  dbPath?: string;
  /** Selected agent (the `?agent=` key: `externalAgentId ?? String(id)`); defaults to main. */
  agentId?: string;
  /**
   * The 1-based Transcript page asked for (`?page=`), clamped to the pages that exist; wins over the anchors.
   * `"all"` reads the whole transcript as its one page: `page` and `pageCount` are 1 and `pageSize`
   * equals `messageCount`, so the view never claims a page it did not window.
   */
  page?: number | "all";
  /** A message `uuid` (`?msg=`): with no `page`, the view opens the page holding it. */
  anchoredMessage?: string;
  /** A `tool_use` id (`?call=`): with no `page`, the view opens the page holding its turn. */
  anchoredCall?: string;
  /** Test-only (non-seam) opt, like `dbPath`: overrides {@link TRANSCRIPT_PAGE_SIZE} so a tiny fixture spans pages. */
  pageSize?: number;
};

/** An agent row as read for the tree. */
type AgentRow = {
  id: number;
  parentAgentId: number | null;
  externalAgentId: string | null;
  spawnedByMessageId: number | null;
  agentType: string | null;
  resolvedModel: string | null;
};

/** The `?agent=` key for an agent row — matches `subAgentBreakdown`'s `agentId`. */
function agentKey(a: { externalAgentId: string | null; id: number }): string {
  return a.externalAgentId ?? String(a.id);
}

/**
 * Transcript read API (ADR-0001, ADR-0002): the full {@link TranscriptView} for
 * one session id, or `null` for an unknown id. Feeds BOTH panes of the Transcript
 * view — the whole-conversation agent tree (lineage-nested, own-cost per node,
 * API-error dot) and ONE selected agent's rendered transcript (prompts +
 * assistant turns with per-turn cost + nested tool calls). All queries are
 * batched (groupBy/findMany), never per-agent N+1. Serializable plain shape only.
 */
export async function getTranscript(id: string, opts: TranscriptOptions = {}): Promise<TranscriptView | null> {
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    const convo = await prisma.conversation.findUnique({
      where: { sessionId: id },
      select: { id: true, sessionId: true, title: true, sourceMtime: true },
    });
    if (convo === null) return null;

    const agents: AgentRow[] = await prisma.agent.findMany({
      where: { conversationId: convo.id },
      select: {
        id: true,
        parentAgentId: true,
        externalAgentId: true,
        spawnedByMessageId: true,
        agentType: true,
        resolvedModel: true,
      },
    });
    const agentIds = agents.map((a) => a.id);

    // Batched per-agent aggregates (no N+1): own cost, error dot, meta count,
    // and first-message timestamp for stable spawn-time sibling ordering.
    const [ownCost, errorAgentIds, metaByAgent, firstTsByAgent] = await Promise.all([
      ownCostByAgent(prisma, agentIds),
      errorAgentIdSet(prisma, convo.id),
      metaCountByAgent(prisma, convo.id),
      firstMessageTsByAgent(prisma, convo.id),
    ]);

    const spawnToolUseByAgent = await resolveSpawnToolUseIds(prisma, agents, firstTsByAgent);

    const tree = buildAgentTree(agents, {
      ownCost,
      errorAgentIds,
      metaByAgent,
      firstTsByAgent,
      spawnToolUseByAgent,
    });

    // Grand total = sum of every agent's OWN cost (each counted once).
    const totalTokens = emptyTokens();
    let totalCostUsd = 0;
    let hasUnpriced = false;
    for (const a of agents) {
      const oc = ownCost.get(a.id);
      if (oc === undefined) continue;
      addTokens(totalTokens, oc.tokens);
      totalCostUsd += oc.costUsd;
      if (oc.unpriced) hasUnpriced = true;
    }

    // Resolve the selected agent (the `?agent=` key), defaulting to main.
    const mainAgent = agents.find((a) => a.parentAgentId === null) ?? agents[0];
    const selected =
      (opts.agentId === undefined ? undefined : agents.find((a) => agentKey(a) === opts.agentId)) ?? mainAgent;

    const pageSize = opts.pageSize ?? TRANSCRIPT_PAGE_SIZE;
    const transcriptPage =
      selected === undefined ? emptyTranscriptPage(pageSize) : await readTranscriptPage(prisma, selected, agents, opts);

    return {
      sessionId: convo.sessionId,
      title: convo.title,
      sourceChangedAt: sourceChangedAtOf(convo.sourceMtime),
      tree,
      totalCostUsd,
      totalTokens,
      hasUnpriced,
      selectedAgentId: selected === undefined ? "" : agentKey(selected),
      ...transcriptPage,
      metaHiddenCount: selected === undefined ? 0 : (metaByAgent.get(selected.id) ?? 0),
    };
  } finally {
    // Only a caller-owned (non-default) client is disconnected; the shared
    // default singleton stays open for the next request.
    if (owned) await prisma.$disconnect();
  }
}

/** A Tool call's body: what its row shows once opened, read on demand by {@link getToolCallBody}. */
export type ToolCallBody = {
  /** Full tool input, serialized JSON. */
  inputJson: string;
  /** Stored tool result: whole for an Agent call, else truncated to ≤10k chars (NULL until paired). */
  resultText: string | null;
  resultTruncated: boolean;
  /** Full (untruncated) result length; NULL until paired. */
  resultCharSize: number | null;
  isError: boolean;
} & ToolCallBodyParts;

/**
 * Tool-call body read API: the input and stored result of the `tool_call` row
 * `id` (a {@link TranscriptToolCall}'s `id`), each with its display parts from
 * the tool's view, or `null` for an unknown id — a row id lives only until the
 * next re-parse of its Conversation.
 *
 * @example const body = await getToolCallBody(call.id);
 */
export async function getToolCallBody(id: number, opts: DetailOptions = {}): Promise<ToolCallBody | null> {
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    const row = await prisma.toolCall.findUnique({ where: { id }, select: TOOL_CALL_BODY_COLUMNS });
    if (row === null) return null;
    return toolCallBodyOf(row);
  } finally {
    // Only a caller-owned (non-default) client is disconnected; the shared
    // default singleton stays open for the next request.
    if (owned) await prisma.$disconnect();
  }
}

/** The stored columns of a `tool_call` row that its {@link ToolCallBody} is shaped from. */
const TOOL_CALL_BODY_COLUMNS = {
  name: true,
  inputJson: true,
  resultText: true,
  resultTruncated: true,
  resultCharSize: true,
  isError: true,
} as const;

/** A Tool call's body, from its stored columns and its tool's view. */
function toolCallBodyOf(row: Prisma.ToolCallGetPayload<{ select: typeof TOOL_CALL_BODY_COLUMNS }>): ToolCallBody {
  const { name, ...stored } = row;
  return { ...stored, ...toolCallBodyParts({ name, ...stored }) };
}

/**
 * Every Tool call body of one Conversation — every Agent's, the main thread and
 * its Sub-agents at any depth — keyed by row id, read in one query, for a view
 * that inlines them all. Empty for an unknown session.
 *
 * @example const bodyByCallId = await getToolCallBodies(view.sessionId);
 */
export async function getToolCallBodies(
  sessionId: string,
  opts: DetailOptions = {},
): Promise<Map<number, ToolCallBody>> {
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    const rows = await prisma.toolCall.findMany({
      where: { agent: { conversation: { sessionId } } },
      select: { id: true, ...TOOL_CALL_BODY_COLUMNS },
    });
    return new Map(rows.map(({ id, ...row }) => [id, toolCallBodyOf(row)]));
  } finally {
    if (owned) await prisma.$disconnect();
  }
}

/**
 * How many stored Conversations carry a parser version other than the current
 * {@link PARSER_VERSION} — produced by an older parser, or left unstamped by an
 * interrupted Refresh. Not "Conversations needing a Refresh": one whose source
 * files changed needs one too, and is not counted here.
 *
 * @example const outdatedCount = await countConversationsWithOutdatedParserVersion();
 */
export async function countConversationsWithOutdatedParserVersion(opts: DetailOptions = {}): Promise<number> {
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    return await prisma.conversation.count({ where: { parserVersion: { not: PARSER_VERSION } } });
  } finally {
    if (owned) await prisma.$disconnect();
  }
}

/**
 * Whether the stored data calls for a Refresh at startup: no Conversation is
 * stored, or one carries a parser version other than {@link PARSER_VERSION}.
 *
 * @example const isRefreshDueAtStartup = await isStoredDataMissingOrOutdated();
 */
export async function isStoredDataMissingOrOutdated(opts: DetailOptions = {}): Promise<boolean> {
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    const [storedCount, outdatedCount] = await Promise.all([
      prisma.conversation.count(),
      prisma.conversation.count({ where: { parserVersion: { not: PARSER_VERSION } } }),
    ]);
    return storedCount === 0 || outdatedCount > 0;
  } finally {
    if (owned) await prisma.$disconnect();
  }
}

/** One priced model's share of a day (a band of the stack) or of the range. */
export type DailySpendModel = {
  /** The model string as logged — the band/legend key (never an unpriced one). */
  model: string;
  costUsd: number;
  tokens: Tokens;
};

/** One local calendar day of the range — always present, even with no activity. */
export type DailySpendDay = {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  /** The day's total cost — the sum of {@link perModel} (unpriced usage adds $0). */
  costUsd: number;
  /** The day's token split across ALL models, unpriced usage included. */
  tokens: Tokens;
  /** The day's priced models, cost descending. Empty on a day with no priced usage. */
  perModel: { model: string; costUsd: number }[];
};

/** Daily spend over a range, ready to stack: one band per priced model. */
export type DailySpend = {
  /** Every local day of the range, ascending and contiguous (gaps zero-filled). */
  days: DailySpendDay[];
  /** Range totals per priced model, cost descending — the stack + legend order. */
  models: DailySpendModel[];
  /** Range total cost; a lower bound when {@link hasUnpriced} is true. */
  totalCostUsd: number;
  /** Range total tokens across ALL models, unpriced usage included. */
  totalTokens: Tokens;
  /** True when the range contains usage on an unknown/`<synthetic>` model. */
  hasUnpriced: boolean;
  /** True when the range contains bare-alias usage, priced at the family rate. */
  hasApproximate: boolean;
};

type DailySpendOptions = FolderScope & {
  /** Range length in days, ending today (inclusive). All time when omitted. */
  days?: number;
  /** Clock injection point — the instant "today" is derived from. Defaults to now. */
  now?: number;
  /** Additional (non-seam) opt for isolated DBs in refresh + tests. */
  dbPath?: string;
};

/**
 * Daily spend read API (ADR-0001, ADR-0002): per-day, per-model cost for the
 * Trends view. Turns are bucketed by the LOCAL calendar day of their owning
 * occurrence's timestamp (`turn.timestamp`), so a Turn's cost lands on the day it ran, once,
 * however many files copy it (ADR-0011); sub-agent Turns are ordinary Turns and
 * are therefore included (`conversationId` is denormalized onto every row).
 * Every day of the range is emitted, zero-filled where nothing ran, so the axis
 * is continuous.
 *
 * The range always ENDS on today's local day: `days` counts back from today
 * (inclusive), and omitting it spans from the earliest in-scope message day.
 * Usage timestamped after today is excluded.
 *
 * Pricing is exact per tier (`priceSplitByType`, 5m and 1h cache writes priced
 * separately). Three row policies, all deliberate:
 *  - a Turn whose owning occurrence has a NULL timestamp is EXCLUDED — it cannot be bucketed;
 *  - a Turn with a NULL model is SKIPPED, as in every other rollup here;
 *  - an unpriced model (`<synthetic>`/unknown) contributes `$0` and NO band,
 *    but its tokens still count in the day/range totals and raise `hasUnpriced`
 *    so the UI can mark the cost as a lower bound.
 */
export async function getDailySpend(opts: DailySpendOptions = {}): Promise<DailySpend> {
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    const today = startOfLocalDay(opts.now ?? Date.now());
    // `days` counts back from today inclusive: 7 days = today and the 6 before.
    const from = opts.days === undefined ? null : addLocalDays(today, 1 - opts.days);

    const to = addLocalDays(today, 1);
    const turns = await prisma.turn.findMany({
      where: {
        model: { not: null },
        // A NULL timestamp never satisfies a comparison, so this filter also
        // enforces the "no timestamp → excluded" policy.
        timestamp: {
          lt: BigInt(to.getTime()),
          ...(from === null ? {} : { gte: BigInt(from.getTime()) }),
        },
        ...(await conversationInFolderScope(prisma, opts)),
      },
      select: { timestamp: true, model: true, ...TOKEN_SUM },
    });

    const byDay = foldByLocalDay(turns);
    return assembleDailySpend(byDay, {
      from: from ?? earliestDay(byDay, today),
      to: today,
      empty: from === null && byDay.size === 0,
    });
  } finally {
    // Only a caller-owned (non-default) client is disconnected; the shared
    // default singleton stays open for the next request.
    if (owned) await prisma.$disconnect();
  }
}

/** A zeroed per-tier accumulator (cache-write tiers kept separate for pricing). */
function emptySplit(): TokenSplit {
  return { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
}

/** Accumulate usage rows into per-local-day, per-model per-tier token splits. */
function foldByLocalDay(rows: DailyUsageRow[]): Map<string, Map<string, TokenSplit>> {
  const byDay = new Map<string, Map<string, TokenSplit>>();
  for (const r of rows) {
    if (r.timestamp === null || r.model === null) continue;
    const key = localDayKey(startOfLocalDay(Number(r.timestamp)));
    let models = byDay.get(key);
    if (models === undefined) {
      models = new Map<string, TokenSplit>();
      byDay.set(key, models);
    }
    let split = models.get(r.model);
    if (split === undefined) {
      split = emptySplit();
      models.set(r.model, split);
    }
    split.input += r.inputTokens ?? 0;
    split.output += r.outputTokens ?? 0;
    split.cacheWrite5m += r.cacheCreation5mTokens ?? 0;
    split.cacheWrite1h += r.cacheCreation1hTokens ?? 0;
    split.cacheRead += r.cacheReadTokens ?? 0;
  }
  return byDay;
}

/** The earliest bucketed day (all-time range start), or `fallback` when empty. */
function earliestDay(byDay: Map<string, Map<string, TokenSplit>>, fallback: Date): Date {
  let earliest: string | undefined;
  for (const key of byDay.keys()) {
    if (earliest === undefined || key < earliest) earliest = key;
  }
  if (earliest === undefined) return fallback;
  const [year, month, date] = earliest.split("-").map(Number);
  return new Date(year, month - 1, date);
}

/** Add a per-tier split's tokens into a merged `Tokens` accumulator. */
function addSplitTokens(into: Tokens, split: TokenSplit): void {
  addTokens(into, {
    input: split.input,
    output: split.output,
    cacheWrite: split.cacheWrite5m + split.cacheWrite1h,
    cacheRead: split.cacheRead,
    total: 0,
  });
}

/** Walk the range day by day, pricing each day's models and rolling up the range. */
function assembleDailySpend(
  byDay: Map<string, Map<string, TokenSplit>>,
  range: { from: Date; to: Date; empty: boolean },
): DailySpend {
  const days: DailySpendDay[] = [];
  const modelTotals = new Map<string, DailySpendModel>();
  const totalTokens = emptyTokens();
  let totalCostUsd = 0;
  let hasUnpriced = false;
  let hasApproximate = false;

  for (
    let cursor = range.from;
    !range.empty && cursor.getTime() <= range.to.getTime();
    cursor = addLocalDays(cursor, 1)
  ) {
    const date = localDayKey(cursor);
    const tokens = emptyTokens();
    const perModel: { model: string; costUsd: number }[] = [];
    let costUsd = 0;

    for (const [model, split] of byDay.get(date) ?? []) {
      addSplitTokens(tokens, split);
      const cost = priceSplitByType(split, model);
      if (cost.unpriced) {
        // $0 and NO band — but the tokens above still count, and the flag lets
        // the UI mark the total as a lower bound.
        hasUnpriced = true;
        continue;
      }
      if (cost.approximate) hasApproximate = true;
      costUsd += cost.usd;
      perModel.push({ model, costUsd: cost.usd });
      accumulateModelTotal(modelTotals, model, split, cost.usd);
    }

    perModel.sort(byCostDesc);
    addTokens(totalTokens, tokens);
    totalCostUsd += costUsd;
    days.push({ date, costUsd, tokens, perModel });
  }

  return {
    days,
    models: [...modelTotals.values()].sort(byCostDesc),
    totalCostUsd,
    totalTokens,
    hasUnpriced,
    hasApproximate,
  };
}

/** Roll one day's model slice into that model's range total. */
function accumulateModelTotal(
  totals: Map<string, DailySpendModel>,
  model: string,
  split: TokenSplit,
  costUsd: number,
): void {
  let entry = totals.get(model);
  if (entry === undefined) {
    entry = { model, costUsd: 0, tokens: emptyTokens() };
    totals.set(model, entry);
  }
  entry.costUsd += costUsd;
  addSplitTokens(entry.tokens, split);
}

/** Cost descending, ties broken by model name so the order is deterministic. */
function byCostDesc(a: { model: string; costUsd: number }, b: { model: string; costUsd: number }): number {
  return b.costUsd - a.costUsd || a.model.localeCompare(b.model);
}

/** Agent ids that recorded at least one API-error turn (the error dot). */
async function errorAgentIdSet(prisma: PrismaClient, conversationId: number): Promise<Set<number>> {
  const rows = await prisma.message.groupBy({
    by: ["agentId"],
    where: { conversationId, isApiError: true },
    _count: { _all: true },
  });
  return new Set(rows.map((r) => r.agentId));
}

/** Per-agent count of hidden `meta` user records (for the "N meta hidden" marker). */
async function metaCountByAgent(prisma: PrismaClient, conversationId: number): Promise<Map<number, number>> {
  const rows = await prisma.message.groupBy({
    by: ["agentId"],
    where: { conversationId, role: "user", kind: "meta" },
    _count: { _all: true },
  });
  const out = new Map<number, number>();
  for (const r of rows) out.set(r.agentId, r._count._all);
  return out;
}

/** Per-agent first-message timestamp (epoch ms) — the spawn-time sort key. */
async function firstMessageTsByAgent(prisma: PrismaClient, conversationId: number): Promise<Map<number, number>> {
  const rows = await prisma.message.groupBy({
    by: ["agentId"],
    where: { conversationId },
    _min: { timestamp: true },
  });
  const out = new Map<number, number>();
  for (const r of rows) {
    const ts = r._min.timestamp;
    if (ts !== null) out.set(r.agentId, Number(ts));
  }
  return out;
}

/**
 * Correlate each spawned sub-agent to the exact `Agent` tool_use that launched
 * it. The `agent` row stores `spawnedByMessageId` (the parent turn) but NOT the
 * tool_use id, so we read the parent turns' `Agent` tool calls and zip them to
 * the children sharing that message — ordered by spawn time — recovering each
 * child's `spawnedByToolUseId` (exact for the common one-spawn-per-turn case).
 */
async function resolveSpawnToolUseIds(
  prisma: PrismaClient,
  agents: AgentRow[],
  firstTsByAgent: Map<number, number>,
): Promise<Map<number, string | null>> {
  const out = new Map<number, string | null>();
  const spawnMsgIds = [...new Set(agents.map((a) => a.spawnedByMessageId).filter((x): x is number => x !== null))];
  if (spawnMsgIds.length === 0) return out;

  const calls = await prisma.toolCall.findMany({
    where: { messageId: { in: spawnMsgIds }, name: "Agent" },
    select: { messageId: true, toolUseId: true },
    orderBy: { id: "asc" },
  });
  const callsByMsg = new Map<number, (string | null)[]>();
  for (const c of calls) {
    let arr = callsByMsg.get(c.messageId);
    if (arr === undefined) {
      arr = [];
      callsByMsg.set(c.messageId, arr);
    }
    arr.push(c.toolUseId);
  }

  const kidsByMsg = new Map<number, AgentRow[]>();
  for (const a of agents) {
    if (a.spawnedByMessageId === null) continue;
    let arr = kidsByMsg.get(a.spawnedByMessageId);
    if (arr === undefined) {
      arr = [];
      kidsByMsg.set(a.spawnedByMessageId, arr);
    }
    arr.push(a);
  }
  const ts = (aid: number) => firstTsByAgent.get(aid) ?? Number.MAX_SAFE_INTEGER;
  for (const [msgId, kids] of kidsByMsg) {
    const ordered = [...kids].sort((x, y) => ts(x.id) - ts(y.id) || x.id - y.id);
    const msgCalls = callsByMsg.get(msgId) ?? [];
    ordered.forEach((kid, i) => out.set(kid.id, msgCalls[i] ?? null));
  }
  return out;
}

/** Assemble the lineage-nested agent tree (siblings ordered by spawn time). */
function buildAgentTree(
  agents: AgentRow[],
  ctx: {
    ownCost: Map<number, OwnCost>;
    errorAgentIds: Set<number>;
    metaByAgent: Map<number, number>;
    firstTsByAgent: Map<number, number>;
    spawnToolUseByAgent: Map<number, string | null>;
  },
): TranscriptAgentNode {
  const nodeById = new Map<number, TranscriptAgentNode>();
  for (const a of agents) {
    const oc = ctx.ownCost.get(a.id) ?? {
      tokens: emptyTokens(),
      costUsd: 0,
      unpriced: false,
    };
    nodeById.set(a.id, {
      id: agentKey(a),
      agentType: a.agentType,
      resolvedModel: a.resolvedModel,
      costUsd: oc.costUsd,
      tokens: oc.tokens,
      unpriced: oc.unpriced,
      hasError: ctx.errorAgentIds.has(a.id),
      metaCount: ctx.metaByAgent.get(a.id) ?? 0,
      spawnedByMessageId: a.spawnedByMessageId,
      spawnedByToolUseId: ctx.spawnToolUseByAgent.get(a.id) ?? null,
      children: [],
    });
  }

  const main = agents.find((a) => a.parentAgentId === null) ?? agents[0];
  const mainId = main?.id;

  // Attach children in spawn-time order (stable tiebreak by id).
  const ts = (aid: number) => ctx.firstTsByAgent.get(aid) ?? Number.MAX_SAFE_INTEGER;
  const ordered = [...agents].sort((x, y) => ts(x.id) - ts(y.id) || x.id - y.id);
  for (const a of ordered) {
    if (a.id === mainId) continue;
    const node = nodeById.get(a.id);
    if (node === undefined) continue;
    const parent = a.parentAgentId !== null ? nodeById.get(a.parentAgentId) : undefined;
    // Dangling/null parent (defensive) → nest under main.
    (parent ?? (mainId === undefined ? undefined : nodeById.get(mainId)))?.children.push(node);
  }

  return mainId === undefined ? emptyMainNode() : (nodeById.get(mainId) as TranscriptAgentNode);
}

/** Degenerate main node for a conversation with no agent rows (should not occur). */
function emptyMainNode(): TranscriptAgentNode {
  return {
    id: "main",
    agentType: null,
    resolvedModel: null,
    costUsd: 0,
    tokens: emptyTokens(),
    unpriced: false,
    hasError: false,
    metaCount: 0,
    spawnedByMessageId: null,
    spawnedByToolUseId: null,
    children: [],
  };
}

/** The user Message kinds a transcript renders (tool-result carriers and meta are hidden). */
const RENDERED_USER_KINDS = ["prompt", "inter-agent", "task-notification"];

/** The selected-agent half of a {@link TranscriptView}: one Transcript page plus the whole agent's figures. */
type TranscriptPage = Pick<
  TranscriptView,
  | "messages"
  | "page"
  | "pageCount"
  | "pageSize"
  | "messageCount"
  | "turnCount"
  | "toolCallCount"
  | "effortLevels"
  | "effortBefore"
>;

/** The page of a conversation with no agent rows (should not occur). */
function emptyTranscriptPage(pageSize: number): TranscriptPage {
  return {
    messages: [],
    page: 1,
    pageCount: 1,
    pageSize,
    messageCount: 0,
    turnCount: 0,
    toolCallCount: 0,
    effortLevels: [],
    effortBefore: null,
  };
}

/** The rows of one agent's rendered transcript (what {@link readAgentTranscript} shows). */
function renderedMessages(agentId: number): Prisma.MessageWhereInput {
  return {
    agentId,
    OR: [{ role: "assistant" }, { role: "user", kind: { in: RENDERED_USER_KINDS } }],
  };
}

/**
 * Read the selected agent's Transcript page and the figures of its whole
 * transcript. The page is the explicit `opts.page` when given (`"all"`: the
 * whole transcript as one page), else the one holding the `?msg=`/`?call=`
 * anchor, else the first; it is clamped to the pages that exist. Every figure is a batched count/groupBy — the window is the
 * only full read.
 */
async function readTranscriptPage(
  prisma: PrismaClient,
  agent: AgentRow,
  agents: AgentRow[],
  opts: TranscriptOptions,
): Promise<TranscriptPage> {
  const rendered = renderedMessages(agent.id);
  const [messageCount, turnCount, toolCallCount, effortRows, anchorIndex] = await Promise.all([
    prisma.message.count({ where: rendered }),
    prisma.message.count({ where: { agentId: agent.id, role: "assistant" } }),
    prisma.toolCall.count({ where: { agentId: agent.id } }),
    prisma.message.groupBy({
      by: ["effort"],
      where: { agentId: agent.id, role: "assistant", effort: { not: null } },
      orderBy: { effort: "asc" },
    }),
    opts.page === undefined ? anchorPosition(prisma, agent.id, opts) : Promise.resolve(undefined),
  ]);

  // The whole transcript is one page exactly its size.
  const pageSize = opts.page === "all" ? messageCount : (opts.pageSize ?? TRANSCRIPT_PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(messageCount / Math.max(1, pageSize)));
  const requested =
    opts.page === "all" ? 1 : (opts.page ?? (anchorIndex === undefined ? 1 : Math.floor(anchorIndex / pageSize) + 1));
  const page = Math.min(Math.max(1, requested), pageCount);

  const messages = await readAgentTranscript(prisma, agent, agents, { skip: (page - 1) * pageSize, take: pageSize });
  const first = messages[0];
  const effortBefore = page === 1 || first === undefined ? null : await effortBeforeMessage(prisma, rendered, first);

  return {
    messages,
    page,
    pageCount,
    pageSize,
    messageCount,
    turnCount,
    toolCallCount,
    effortLevels: effortRows.flatMap((r) => (r.effort === null ? [] : [r.effort])),
    effortBefore,
  };
}

/** Effort of the last effort-carrying rendered message before `message`, or null when none. */
async function effortBeforeMessage(
  prisma: PrismaClient,
  rendered: Prisma.MessageWhereInput,
  message: TranscriptMessage,
): Promise<string | null> {
  const timestamp = message.timestamp === null ? null : BigInt(Date.parse(message.timestamp));
  const row = await prisma.message.findFirst({
    where: { AND: [rendered, { effort: { not: null } }, orderedBefore({ id: message.id, timestamp })] },
    orderBy: REVERSE_TRANSCRIPT_ORDER,
    select: { effort: true },
  });
  return row?.effort ?? null;
}

/**
 * The 0-based position, in the agent's rendered transcript, of the message a
 * `?msg=` uuid names — or, failing that, of the turn holding the `?call=` tool
 * call. Undefined when neither names a rendered message of this agent.
 */
async function anchorPosition(
  prisma: PrismaClient,
  agentId: number,
  opts: Pick<TranscriptOptions, "anchoredMessage" | "anchoredCall">,
): Promise<number | undefined> {
  const rendered = renderedMessages(agentId);
  const select = { id: true, timestamp: true } as const;
  let anchor =
    opts.anchoredMessage === undefined
      ? null
      : await prisma.message.findFirst({ where: { AND: [rendered, { uuid: opts.anchoredMessage }] }, select });
  if (anchor === null && opts.anchoredCall !== undefined) {
    const call = await prisma.toolCall.findFirst({
      where: { toolUseId: opts.anchoredCall, message: rendered },
      select: { message: { select } },
    });
    anchor = call?.message ?? null;
  }
  if (anchor === null) return undefined;
  return prisma.message.count({ where: { AND: [rendered, orderedBefore(anchor)] } });
}

/**
 * Read one window of an agent's rendered transcript: assistant turns + user
 * rows of the {@link RENDERED_USER_KINDS}, in timestamp/id order, each
 * assistant turn carrying its per-turn cost and nested tool calls, each user
 * row its extras with their agent links resolved against `agents`.
 */
async function readAgentTranscript(
  prisma: PrismaClient,
  agent: AgentRow,
  agents: AgentRow[],
  window: { skip: number; take: number },
): Promise<TranscriptMessage[]> {
  const rows = await prisma.message.findMany({
    where: renderedMessages(agent.id),
    orderBy: TRANSCRIPT_ORDER,
    skip: window.skip,
    take: window.take,
    select: {
      id: true,
      uuid: true,
      role: true,
      kind: true,
      text: true,
      origin: true,
      model: true,
      effort: true,
      thinkingText: true,
      thinkingDurationMs: true,
      // The Turn this occurrence owns; none when another occurrence owns it (ADR-0011).
      turn: { select: { ...TOKEN_SUM, model: true } },
      isApiError: true,
      apiErrorMessage: true,
      timestamp: true,
      apiRequestId: true,
      // The owning occurrence of a Copied Message: one more query for the window, not one per row.
      copiedFrom: {
        select: {
          uuid: true,
          agent: { select: { externalAgentId: true } },
          conversation: { select: { sessionId: true, title: true } },
        },
      },
    },
  });

  const toolCallsByMsg = await toolCallsByMessage(
    prisma,
    rows.map((r) => r.id),
  );
  const assistantMessageIds = rows.filter((r) => r.role === "assistant").map((r) => r.id);
  const failedAttemptsByMessageId = await failedAttemptsByMessage(prisma, assistantMessageIds);

  // A Sub-agent's agent id is its external id, so `senderTaskId`/`taskId`
  // resolve against it; a coordinator is the agent that spawned this one.
  const keyByExternalId = new Map<string, string>();
  for (const a of agents) if (a.externalAgentId !== null) keyByExternalId.set(a.externalAgentId, agentKey(a));
  const parent = agents.find((a) => a.id === agent.parentAgentId);
  const resolve = (origin: MessageOrigin): TranscriptMessageOrigin => ({
    ...origin,
    senderAgentId: origin.coordinator
      ? parent === undefined
        ? null
        : agentKey(parent)
      : ((origin.senderTaskId === undefined ? undefined : keyByExternalId.get(origin.senderTaskId)) ?? null),
    taskAgentId: (origin.taskId === undefined ? undefined : keyByExternalId.get(origin.taskId)) ?? null,
  });

  return rows.map((r) => {
    const turn = priceTurn(r.turn);
    const origin = readOrigin(r.origin);
    const failedAttempts = failedAttemptsByMessageId.get(r.id) ?? [];
    const knownLostMs = failedAttempts.flatMap((attempt) => (attempt.lostMs === null ? [] : [attempt.lostMs]));
    return {
      id: r.id,
      uuid: r.uuid,
      role: r.role,
      kind: r.kind,
      text: r.text,
      origin: origin === null ? null : resolve(origin),
      model: r.model,
      effort: r.effort,
      thinkingText: r.thinkingText,
      thinkingDurationMs: r.thinkingDurationMs,
      tokens: turn.tokens,
      costUsd: turn.costUsd,
      unpriced: turn.unpriced,
      isApiError: r.isApiError,
      apiErrorMessage: r.apiErrorMessage,
      isCopied: r.copiedFrom !== null,
      copiedFrom:
        r.copiedFrom === null
          ? null
          : {
              sessionId: r.copiedFrom.conversation.sessionId,
              title: r.copiedFrom.conversation.title,
              agentId: r.copiedFrom.agent.externalAgentId,
              messageUuid: r.copiedFrom.uuid,
            },
      timestamp: r.timestamp === null ? null : new Date(Number(r.timestamp)).toISOString(),
      toolCalls: toolCallsByMsg.get(r.id) ?? [],
      apiRequestId: r.apiRequestId,
      failedAttemptCount: failedAttempts.length,
      failedAttemptsLostMs: knownLostMs.length > 0 ? knownLostMs.reduce((total, lostMs) => total + lostMs, 0) : null,
    };
  });
}

/**
 * A stored `message.origin`, validated against {@link messageOriginSchema}.
 * Null when absent, not JSON, or not of that shape — the row then renders
 * without its extras; reading never throws.
 */
function readOrigin(stored: string | null): MessageOrigin | null {
  if (stored === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(stored);
  } catch {
    return null;
  }
  const parsed = messageOriginSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** The `turn` row a Transcript message owns, as per-turn pricing reads it. */
type OwnedTurn = {
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
  cacheReadTokens: number;
};

/**
 * Price ONE Turn exactly (per-tier, matching the rollups), on the occurrence
 * that owns it. A user prompt, and an assistant occurrence another one owns (a
 * copy), carry none → `tokens: null`, `costUsd: 0`: a page's per-Turn figures
 * sum to its Cost. A Turn with no resolved model is `unpriced` at `$0`.
 */
function priceTurn(turn: OwnedTurn | null): {
  tokens: Tokens | null;
  costUsd: number;
  unpriced: boolean;
} {
  if (turn === null) {
    return { tokens: null, costUsd: 0, unpriced: false };
  }
  const input = turn.inputTokens;
  const output = turn.outputTokens;
  const cw5m = turn.cacheCreation5mTokens;
  const cw1h = turn.cacheCreation1hTokens;
  const cr = turn.cacheReadTokens;
  const cacheWrite = cw5m + cw1h;
  const tokens: Tokens = {
    input,
    output,
    cacheWrite,
    cacheRead: cr,
    total: input + output + cacheWrite + cr,
  };
  if (turn.model === null) {
    return { tokens, costUsd: 0, unpriced: true };
  }
  const cost = priceSplitByType({ input, output, cacheWrite5m: cw5m, cacheWrite1h: cw1h, cacheRead: cr }, turn.model);
  return { tokens, costUsd: cost.usd, unpriced: cost.unpriced };
}

/** Batched `tool_call` rows for the given message ids, grouped by message id. */
async function toolCallsByMessage(
  prisma: PrismaClient,
  messageIds: number[],
): Promise<Map<number, TranscriptToolCall[]>> {
  const out = new Map<number, TranscriptToolCall[]>();
  if (messageIds.length === 0) return out;
  const rows = await prisma.toolCall.findMany({
    where: { messageId: { in: messageIds } },
    orderBy: { id: "asc" },
    select: {
      id: true,
      messageId: true,
      toolUseId: true,
      name: true,
      inputJson: true,
      resultTruncated: true,
      resultCharSize: true,
      isError: true,
    },
  });
  for (const r of rows) {
    let arr = out.get(r.messageId);
    if (arr === undefined) {
      arr = [];
      out.set(r.messageId, arr);
    }
    arr.push({
      id: r.id,
      toolUseId: r.toolUseId,
      name: r.name,
      inputJson: r.inputJson,
      resultTruncated: r.resultTruncated,
      resultCharSize: r.resultCharSize,
      isError: r.isError,
    });
  }
  return out;
}

type ConversationRow = {
  id: number;
  sessionId: string;
  title: string | null;
  continuedFromConversationId: number | null;
  sourceMtime: bigint;
  project: { path: string };
};

/**
 * One per-model token-sum row, the shape every priced rollup folds: a
 * `turn` groupBy's `_sum`, or one `turn` row. `model` may be null (a turn with no resolved
 * model); the fold skips those. SQL `SUM` ignores nulls, so an absent tier
 * arrives as null and folds to 0.
 */
type ModelSumRow = {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreation5mTokens: number | null;
  cacheCreation1hTokens: number | null;
  cacheReadTokens: number | null;
};

/** One timestamped usage row, as the daily fold buckets it by local day. */
type DailyUsageRow = ModelSumRow & {
  /** Epoch ms; a row without one cannot be bucketed and is skipped. */
  timestamp: bigint | number | null;
};

/** The `_sum` selection shared by every per-model groupBy (the five token tiers). */
const TOKEN_SUM = {
  inputTokens: true,
  outputTokens: true,
  cacheCreation5mTokens: true,
  cacheCreation1hTokens: true,
  cacheReadTokens: true,
} as const;

/** One priced model group: merged Tokens + exact per-tier cost + unpriced flag. */
type PricedGroup = {
  model: string;
  tokens: Tokens;
  costUsd: number;
  /** Per-bucket dollar split of `costUsd` (buckets sum to `costUsd`). */
  costByType: CostByType;
  unpriced: boolean;
};

/** Build a merged-`Tokens` value + exact per-tier cost from one grouped SUM row. */
function priceModelRow(row: ModelSumRow): PricedGroup {
  const model = row.model as string; // pricedRollup filters model != null
  const input = Number(row.inputTokens ?? 0);
  const output = Number(row.outputTokens ?? 0);
  const cw5m = Number(row.cacheCreation5mTokens ?? 0);
  const cw1h = Number(row.cacheCreation1hTokens ?? 0);
  const cr = Number(row.cacheReadTokens ?? 0);
  const cacheWrite = cw5m + cw1h;
  const tokens: Tokens = {
    input,
    output,
    cacheWrite,
    cacheRead: cr,
    total: input + output + cacheWrite + cr,
  };
  const cost = priceSplitByType({ input, output, cacheWrite5m: cw5m, cacheWrite1h: cw1h, cacheRead: cr }, model);
  return {
    model,
    tokens,
    costUsd: cost.usd,
    costByType: cost.byType,
    unpriced: resolveModel(model).unpriced,
  };
}

/**
 * THE single priced-rollup fold (Part B1). Turns grouped (model) token-sum rows
 * into priced, merged `PricedGroup[]` — one entry per distinct non-null model,
 * each priced exactly at its own per-tier rate. Rows whose `model` is null are
 * skipped (the old SQL `m.model IS NOT NULL` filter). Rows that repeat a model
 * (e.g. when grouping also partitions by skill/agent, then projecting back to
 * model) are merged. By-model, by-skill+model, and by-agent+model reads ALL
 * funnel their model-grouped rows through here so pricing happens in exactly one
 * place. Order follows first appearance of each model in `rows`.
 */
function pricedRollup(rows: ModelSumRow[]): PricedGroup[] {
  const byModel = new Map<string, PricedGroup>();
  const order: string[] = [];
  for (const row of rows) {
    if (row.model === null) continue;
    const priced = priceModelRow(row);
    const existing = byModel.get(priced.model);
    if (existing === undefined) {
      byModel.set(priced.model, priced);
      order.push(priced.model);
      continue;
    }
    addTokens(existing.tokens, priced.tokens);
    existing.costUsd += priced.costUsd;
    addCostByType(existing.costByType, priced.costByType);
    existing.unpriced = existing.unpriced || priced.unpriced;
  }
  return order.map((m) => byModel.get(m) as PricedGroup);
}

/** Map a Prisma `turn.groupBy` `_sum` row to the `ModelSumRow` fold shape. */
function toModelSumRow(g: {
  model: string | null;
  _sum: {
    inputTokens: number | null;
    outputTokens: number | null;
    cacheCreation5mTokens: number | null;
    cacheCreation1hTokens: number | null;
    cacheReadTokens: number | null;
  };
}): ModelSumRow {
  return {
    model: g.model,
    inputTokens: g._sum.inputTokens,
    outputTokens: g._sum.outputTokens,
    cacheCreation5mTokens: g._sum.cacheCreation5mTokens,
    cacheCreation1hTokens: g._sum.cacheCreation1hTokens,
    cacheReadTokens: g._sum.cacheReadTokens,
  };
}

/** Add `b` into `a` (mutates `a`) — per-bucket dollar accumulation. */
function addCostByType(a: CostByType, b: CostByType): void {
  a.input += b.input;
  a.output += b.output;
  a.cacheWrite += b.cacheWrite;
  a.cacheRead += b.cacheRead;
}

/** Add `b` into `a` (mutates `a`) and refresh its `total`. */
function addTokens(a: Tokens, b: Tokens): void {
  a.input += b.input;
  a.output += b.output;
  a.cacheWrite += b.cacheWrite;
  a.cacheRead += b.cacheRead;
  a.total = a.input + a.output + a.cacheWrite + a.cacheRead;
}

/** Group every Turn a conversation owns, of all its agents, by model, priced exactly. */
async function pricedGroupsByModel(prisma: PrismaClient, conversationId: number): Promise<PricedGroup[]> {
  // Per-model token sums via one typed `groupBy` (ADR-0001: SUM, never stored
  // aggregates). `turn.conversationId` is the owner's, denormalized onto every
  // row — sub-agents' Turns included — so scoping by it rolls up every agent's
  // own tokens without an `agent` join.
  const grouped = await prisma.turn.groupBy({
    by: ["model"],
    where: { conversationId },
    _sum: TOKEN_SUM,
  });
  return pricedRollup(grouped.map(toModelSumRow));
}

/** Convert min/max timestamp epoch-ms bounds to startedAt/endedAt ISO strings. */
function isoBounds(
  minTs: bigint | number | null,
  maxTs: bigint | number | null,
): { startedAt: string; endedAt: string } {
  const min = minTs == null ? null : Number(minTs);
  const max = maxTs == null ? null : Number(maxTs);
  return {
    startedAt: min === null ? "" : new Date(min).toISOString(),
    endedAt: max === null ? "" : new Date(max).toISOString(),
  };
}

/** startedAt/endedAt ISO bounds from min/max message timestamps (all agents). */
async function timeBounds(
  prisma: PrismaClient,
  conversationId: number,
): Promise<{ startedAt: string; endedAt: string }> {
  // `conversationId` denormalization scopes every agent's messages — no join.
  const bounds = await prisma.message.aggregate({
    where: { conversationId },
    _min: { timestamp: true },
    _max: { timestamp: true },
  });
  return isoBounds(bounds._min.timestamp, bounds._max.timestamp);
}

/**
 * Pure assembly of one `ConversationSummary` from its priced model groups plus
 * the precomputed time bounds, sub-agent count and resolved continued-from
 * sessionId. The single place that folds priced groups into the summary's
 * totals / cost / unpriced / dominant-model fields — shared by the batched
 * `listConversations` and the single-id `summarizeConversation`, so both
 * produce byte-identical summaries.
 */
function assembleSummary(
  convo: ConversationRow,
  parts: {
    groups: PricedGroup[];
    bounds: { startedAt: string; endedAt: string };
    subAgentCount: number;
    errorCount: number;
    continuedFromId: string | null;
  },
): ConversationSummary {
  const totals: Tokens = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 };
  const costByType: CostByType = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  let costUsd = 0;
  let unpriced = false;
  let dominant = "";
  let dominantOutput = -1;

  for (const g of parts.groups) {
    addTokens(totals, g.tokens);
    costUsd += g.costUsd;
    addCostByType(costByType, g.costByType);
    if (g.unpriced) unpriced = true;
    if (g.tokens.output > dominantOutput) {
      dominant = g.model;
      dominantOutput = g.tokens.output;
    }
  }

  return {
    id: convo.sessionId,
    title: convo.title,
    project: { path: convo.project.path },
    startedAt: parts.bounds.startedAt,
    endedAt: parts.bounds.endedAt,
    models: { dominant, distinctCount: parts.groups.length },
    tokens: totals,
    costUsd,
    costByType,
    unpriced,
    subAgentCount: parts.subAgentCount,
    errorCount: parts.errorCount,
    continuedFromId: parts.continuedFromId,
    sourceChangedAt: sourceChangedAtOf(convo.sourceMtime),
  };
}

/** A Conversation's stored composite `sourceMtime` (epoch ms) as the ISO `sourceChangedAt`. */
function sourceChangedAtOf(sourceMtime: bigint): string {
  return new Date(Number(sourceMtime)).toISOString();
}

/**
 * Single-id summary path (used by `getConversation`). Computes the same parts as
 * the batched list path but for ONE conversation, then funnels through
 * `assembleSummary`. Returns the priced model `groups` alongside the summary so
 * `getConversation` can build `perModel` from the SAME rollup (priced once).
 */
async function summarizeConversation(
  prisma: PrismaClient,
  convo: ConversationRow,
): Promise<{ summary: ConversationSummary; groups: PricedGroup[] }> {
  const groups = await pricedGroupsByModel(prisma, convo.id);
  const bounds = await timeBounds(prisma, convo.id);
  const subAgentCount = await prisma.agent.count({
    where: { conversationId: convo.id, parentAgentId: { not: null } },
  });
  const errorCount = await prisma.message.count({
    where: { conversationId: convo.id, isApiError: true },
  });

  let continuedFromId: string | null = null;
  if (convo.continuedFromConversationId !== null) {
    const from = await prisma.conversation.findUnique({
      where: { id: convo.continuedFromConversationId },
      select: { sessionId: true },
    });
    continuedFromId = from?.sessionId ?? null;
  }

  const summary = assembleSummary(convo, {
    groups,
    bounds,
    subAgentCount,
    errorCount,
    continuedFromId,
  });
  return { summary, groups };
}

function sortSummaries(summaries: ConversationSummary[], sortBy: keyof ConversationSummary, dir: "asc" | "desc"): void {
  const factor = dir === "desc" ? -1 : 1;
  summaries.sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
    return String(av).localeCompare(String(bv)) * factor;
  });
}
