// Read API (ADR-0001, ADR-0002). `listConversations()` and `getConversation()`
// are the stable read seams over the seven tables written by `refresh()` (the
// ingest spine, in `refresh.ts`). This module is read-only — it issues SUM
// queries and prices/assembles summaries, and never writes.
//
// ROLLUP DESIGN (ADR-0001): conversation totals/cost are SUM queries over ALL
// messages of ALL agents in the conversation — so sub-agent tokens roll up
// automatically, counted ONCE (the parent Agent aggregate is never summed in).

import {
  type CostByType,
  priceSplitByType,
  resolveModel,
  type TokenSplit,
  type Tokens,
} from "@/core/cost";
import { readClient } from "@/core/db";
import { addLocalDays, localDayKey, startOfLocalDay } from "@/core/local-day";
import type { PrismaClient } from "@/core/prisma/generated/client";

export type ConversationSummary = {
  id: string;
  title: string | null;
  project: { folder: string; path: string };
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
};

/**
 * The detail view of one conversation. Extends the SAME `ConversationSummary`
 * (the base fields match `listConversations` exactly) with three breakdowns, all
 * computed by SUM queries over every agent's messages (ADR-0001):
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

/** One `tool_use` block on an assistant turn (raw fields; the app classifies kind). */
export type TranscriptToolCall = {
  /** `tool_use` block id — correlates to a spawned agent's `spawnedByToolUseId`. */
  toolUseId: string | null;
  /** Tool name (`Bash`, `Skill`, `Agent`, …). */
  name: string;
  /** Full tool input, serialized JSON (the app extracts snippets). */
  inputJson: string;
  /** Stored tool result, truncated to ≤10k chars (NULL until paired). */
  resultText: string | null;
  resultTruncated: boolean;
  /** Full (untruncated) result length — a token-cost proxy. */
  resultCharSize: number | null;
  isError: boolean;
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
  /** `prompt` on rendered user rows (tool-result/meta are filtered out); null on assistant. */
  kind: string | null;
  text: string | null;
  model: string | null;
  /**
   * Reasoning effort of this assistant turn, verbatim (`high`, `xhigh`, …).
   * Null on user prompts and on turns whose log predates the field. The pane
   * derives uniform-vs-mixed and the change markers from these values.
   */
  effort: string | null;
  /** Merged per-turn token split; null on user prompts (they have no usage). */
  tokens: Tokens | null;
  /** Exact per-tier cost of this turn ($0 on user prompts and unpriced models). */
  costUsd: number;
  unpriced: boolean;
  isApiError: boolean;
  apiErrorMessage: string | null;
  /** Record timestamp as an ISO string (null when absent). */
  timestamp: string | null;
  /** `tool_use` blocks on this (assistant) turn, in stored order. */
  toolCalls: TranscriptToolCall[];
};

/** One node of the agent tree — an agent plus its own-transcript cost and lineage. */
export type TranscriptAgentNode = {
  /** Stable `?agent=` URL key: `externalAgentId ?? String(id)` (matches the cost panel). */
  id: string;
  /** Raw `agent_type` — null/empty on the main thread (the app maps empty → "main"). */
  agentType: string | null;
  /** Concrete model the agent ran on (label source; may be null). */
  resolvedModel: string | null;
  /** Own-transcript cost — THIS agent's own messages only, priced per-tier (not rolled up). */
  costUsd: number;
  /** Own-transcript tokens (this agent's messages only). */
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
  /** The root/main agent, with sub-agents nested under it by lineage. */
  tree: TranscriptAgentNode;
  /** Conversation grand total — sum of every agent's own cost (counted once). */
  totalCostUsd: number;
  totalTokens: Tokens;
  /** The resolved selected-agent key actually rendered in `messages`. */
  selectedAgentId: string;
  /** The selected agent's transcript, in timestamp/id order. */
  messages: TranscriptMessage[];
  /** Meta user records hidden from `messages` for the selected agent. */
  metaHiddenCount: number;
};

type ListOptions = {
  sortBy?: keyof ConversationSummary;
  dir?: "asc" | "desc";
  /** Additional (non-seam) opt for isolated DBs in refresh + tests. */
  dbPath?: string;
};

/**
 * Read all conversations as `ConversationSummary[]`. Totals and cost are computed
 * as SUM queries over every message of every agent in the conversation (ADR-0001),
 * so sub-agents added in Slice 4 roll up automatically.
 */
export async function listConversations(
  opts: ListOptions = {},
): Promise<ConversationSummary[]> {
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    // O(1) queries regardless of conversation count (no per-conversation loop):
    // one findMany + three batched groupBys + one continued-from resolve. All
    // rollups bucket on `message.conversationId` (denormalized onto every row,
    // sub-agents included), then assemble per-conversation summaries in JS.
    const conversations = await prisma.conversation.findMany({
      include: { project: true },
    });

    const modelSums = await prisma.message.groupBy({
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
    const boundsById = new Map<
      number,
      { startedAt: string; endedAt: string }
    >();
    for (const t of timeSpans) {
      boundsById.set(
        t.conversationId,
        isoBounds(t._min.timestamp, t._max.timestamp),
      );
    }
    const subCountById = new Map<number, number>();
    for (const c of subAgentCounts) {
      subCountById.set(c.conversationId, c._count._all);
    }
    const errorCountById = new Map<number, number>();
    for (const c of errorCounts) {
      errorCountById.set(c.conversationId, c._count._all);
    }
    const continuedFromById = await resolveContinuedFromIds(
      prisma,
      conversations,
    );

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
    ...new Set(
      conversations
        .map((c) => c.continuedFromConversationId)
        .filter((id): id is number => id !== null),
    ),
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
 * every agent's messages (sub-agent tokens roll up automatically, counted once).
 */
export async function getConversation(
  id: string,
  opts: DetailOptions = {},
): Promise<ConversationDetail | null> {
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

/** Per-skill rollup — exact cost via per-turn attribution (ADR-0001). */
async function pricedGroupsBySkill(
  prisma: PrismaClient,
  conversationId: number,
): Promise<{ skill: string; tokens: Tokens; costUsd: number }[]> {
  // Grouped per (skill, model) so each model's tokens price at its own rate;
  // results are then merged per skill (a skill may drive >1 model's turns).
  // `conversationId` denormalization lets us scope without an `agent` join.
  const grouped = await prisma.message.groupBy({
    by: ["attributionSkill", "model"],
    where: {
      conversationId,
      attributionSkill: { not: null },
      model: { not: null },
    },
    _sum: TOKEN_SUM,
  });

  // Partition the (skill, model) rows by skill, then fold each skill's model
  // rows through the single `pricedRollup` (which prices+merges by model) and
  // re-merge to one entry per skill.
  const bySkill = new Map<string, ModelSumRow[]>();
  const order: string[] = [];
  for (const g of grouped) {
    const skill = g.attributionSkill as string;
    let rows = bySkill.get(skill);
    if (rows === undefined) {
      rows = [];
      bySkill.set(skill, rows);
      order.push(skill);
    }
    rows.push(toModelSumRow(g));
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

/** One agent's own-transcript cost — its own messages only, priced per-tier. */
type OwnCost = { tokens: Tokens; costUsd: number; unpriced: boolean };

/**
 * Own-transcript cost for each agent in `agentIds` (its OWN messages only, NOT
 * rolled up with children). One batched per-(agent, model) groupBy for ALL
 * agents (never N+1), folded through the shared `pricedRollup`. This is the
 * single source of the per-agent own-cost used by both the sub-agent breakdown
 * (detail panel) and the Transcript agent tree, so their numbers match exactly.
 */
async function ownCostByAgent(
  prisma: PrismaClient,
  agentIds: number[],
): Promise<Map<number, OwnCost>> {
  const out = new Map<number, OwnCost>();
  if (agentIds.length === 0) return out;

  const grouped = await prisma.message.groupBy({
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
export async function getTranscript(
  id: string,
  opts: TranscriptOptions = {},
): Promise<TranscriptView | null> {
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    const convo = await prisma.conversation.findUnique({
      where: { sessionId: id },
      select: { id: true, sessionId: true, title: true },
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
    const [ownCost, errorAgentIds, metaByAgent, firstTsByAgent] =
      await Promise.all([
        ownCostByAgent(prisma, agentIds),
        errorAgentIdSet(prisma, convo.id),
        metaCountByAgent(prisma, convo.id),
        firstMessageTsByAgent(prisma, convo.id),
      ]);

    const spawnToolUseByAgent = await resolveSpawnToolUseIds(
      prisma,
      agents,
      firstTsByAgent,
    );

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
    for (const a of agents) {
      const oc = ownCost.get(a.id);
      if (oc === undefined) continue;
      addTokens(totalTokens, oc.tokens);
      totalCostUsd += oc.costUsd;
    }

    // Resolve the selected agent (the `?agent=` key), defaulting to main.
    const mainAgent = agents.find((a) => a.parentAgentId === null) ?? agents[0];
    const selected =
      (opts.agentId === undefined
        ? undefined
        : agents.find((a) => agentKey(a) === opts.agentId)) ?? mainAgent;

    const messages =
      selected === undefined
        ? []
        : await readAgentTranscript(prisma, selected.id);

    return {
      sessionId: convo.sessionId,
      title: convo.title,
      tree,
      totalCostUsd,
      totalTokens,
      selectedAgentId: selected === undefined ? "" : agentKey(selected),
      messages,
      metaHiddenCount:
        selected === undefined ? 0 : (metaByAgent.get(selected.id) ?? 0),
    };
  } finally {
    // Only a caller-owned (non-default) client is disconnected; the shared
    // default singleton stays open for the next request.
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

type DailySpendOptions = {
  /** Scope to one Project by its `folderName` (the `?folder=` key); all Projects when omitted. */
  folder?: string;
  /** Range length in days, ending today (inclusive). All time when omitted. */
  days?: number;
  /** Clock injection point — the instant "today" is derived from. Defaults to now. */
  now?: number;
  /** Additional (non-seam) opt for isolated DBs in refresh + tests. */
  dbPath?: string;
};

/**
 * Daily spend read API (ADR-0001, ADR-0002): per-day, per-model cost for the
 * Trends view. Messages are bucketed by the LOCAL calendar day of their own
 * timestamp, so an assistant Turn's cost lands on the day it ran; sub-agent
 * messages are ordinary Messages and are therefore included (no join needed —
 * `conversationId` is denormalized onto every row). Every day of the range is
 * emitted, zero-filled where nothing ran, so the axis is continuous.
 *
 * The range always ENDS on today's local day: `days` counts back from today
 * (inclusive), and omitting it spans from the earliest in-scope message day.
 * Usage timestamped after today is excluded.
 *
 * Pricing is exact per tier (`priceSplitByType`, 5m and 1h cache writes priced
 * separately). Three row policies, all deliberate:
 *  - a message with a NULL timestamp is EXCLUDED — it cannot be bucketed;
 *  - a message with a NULL model is SKIPPED, as in every other rollup here;
 *  - an unpriced model (`<synthetic>`/unknown) contributes `$0` and NO band,
 *    but its tokens still count in the day/range totals and raise `hasUnpriced`
 *    so the UI can mark the cost as a lower bound.
 */
export async function getDailySpend(
  opts: DailySpendOptions = {},
): Promise<DailySpend> {
  const { prisma, owned } = readClient(opts.dbPath);
  try {
    const today = startOfLocalDay(opts.now ?? Date.now());
    // `days` counts back from today inclusive: 7 days = today and the 6 before.
    const from = opts.days === undefined ? null : addLocalDays(today, 1 - opts.days);

    const rows = await prisma.message.findMany({
      where: {
        model: { not: null },
        // A NULL timestamp never satisfies a comparison, so this filter also
        // enforces the "no timestamp → excluded" policy.
        timestamp: {
          lt: BigInt(addLocalDays(today, 1).getTime()),
          ...(from === null ? {} : { gte: BigInt(from.getTime()) }),
        },
        ...(opts.folder === undefined
          ? {}
          : { conversation: { project: { folderName: opts.folder } } }),
      },
      select: {
        timestamp: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        cacheCreation5mTokens: true,
        cacheCreation1hTokens: true,
        cacheReadTokens: true,
      },
    });

    const byDay = foldByLocalDay(rows);
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

/** One message row as read for the daily fold (already filtered to a real model). */
type DailyMessageRow = {
  timestamp: bigint | number | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreation5mTokens: number | null;
  cacheCreation1hTokens: number | null;
  cacheReadTokens: number | null;
};

/** A zeroed per-tier accumulator (cache-write tiers kept separate for pricing). */
function emptySplit(): TokenSplit {
  return { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
}

/** Accumulate message rows into per-local-day, per-model per-tier token splits. */
function foldByLocalDay(
  rows: DailyMessageRow[],
): Map<string, Map<string, TokenSplit>> {
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
function earliestDay(
  byDay: Map<string, Map<string, TokenSplit>>,
  fallback: Date,
): Date {
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
function byCostDesc(
  a: { model: string; costUsd: number },
  b: { model: string; costUsd: number },
): number {
  return b.costUsd - a.costUsd || a.model.localeCompare(b.model);
}

/** Agent ids that recorded at least one API-error turn (the error dot). */
async function errorAgentIdSet(
  prisma: PrismaClient,
  conversationId: number,
): Promise<Set<number>> {
  const rows = await prisma.message.groupBy({
    by: ["agentId"],
    where: { conversationId, isApiError: true },
    _count: { _all: true },
  });
  return new Set(rows.map((r) => r.agentId));
}

/** Per-agent count of hidden `meta` user records (for the "N meta hidden" marker). */
async function metaCountByAgent(
  prisma: PrismaClient,
  conversationId: number,
): Promise<Map<number, number>> {
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
async function firstMessageTsByAgent(
  prisma: PrismaClient,
  conversationId: number,
): Promise<Map<number, number>> {
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
  const spawnMsgIds = [
    ...new Set(
      agents
        .map((a) => a.spawnedByMessageId)
        .filter((x): x is number => x !== null),
    ),
  ];
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
  const ts = (aid: number) =>
    ctx.firstTsByAgent.get(aid) ?? Number.MAX_SAFE_INTEGER;
  const ordered = [...agents].sort(
    (x, y) => ts(x.id) - ts(y.id) || x.id - y.id,
  );
  for (const a of ordered) {
    if (a.id === mainId) continue;
    const node = nodeById.get(a.id);
    if (node === undefined) continue;
    const parent =
      a.parentAgentId !== null ? nodeById.get(a.parentAgentId) : undefined;
    // Dangling/null parent (defensive) → nest under main.
    (parent ?? (mainId === undefined ? undefined : nodeById.get(mainId)))
      ?.children.push(node);
  }

  return mainId === undefined
    ? emptyMainNode()
    : (nodeById.get(mainId) as TranscriptAgentNode);
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

/**
 * Read one agent's rendered transcript: assistant turns + user rows WHERE
 * `kind = 'prompt'` (tool-result & meta excluded), in timestamp/id order, each
 * assistant turn carrying its per-turn cost and nested tool calls.
 */
async function readAgentTranscript(
  prisma: PrismaClient,
  agentId: number,
): Promise<TranscriptMessage[]> {
  const rows = await prisma.message.findMany({
    where: {
      agentId,
      OR: [{ role: "assistant" }, { role: "user", kind: "prompt" }],
    },
    orderBy: [{ timestamp: "asc" }, { id: "asc" }],
    select: {
      id: true,
      uuid: true,
      role: true,
      kind: true,
      text: true,
      model: true,
      effort: true,
      inputTokens: true,
      outputTokens: true,
      cacheCreation5mTokens: true,
      cacheCreation1hTokens: true,
      cacheReadTokens: true,
      isApiError: true,
      apiErrorMessage: true,
      timestamp: true,
    },
  });

  const toolCallsByMsg = await toolCallsByMessage(
    prisma,
    rows.map((r) => r.id),
  );

  return rows.map((r) => {
    const turn = priceTurn(r);
    return {
      id: r.id,
      uuid: r.uuid,
      role: r.role,
      kind: r.kind,
      text: r.text,
      model: r.model,
      effort: r.effort,
      tokens: turn.tokens,
      costUsd: turn.costUsd,
      unpriced: turn.unpriced,
      isApiError: r.isApiError,
      apiErrorMessage: r.apiErrorMessage,
      timestamp: r.timestamp === null ? null : new Date(Number(r.timestamp)).toISOString(),
      toolCalls: toolCallsByMsg.get(r.id) ?? [],
    };
  });
}

/** One assistant turn's row shape for per-turn pricing. */
type TurnRow = {
  role: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreation5mTokens: number | null;
  cacheCreation1hTokens: number | null;
  cacheReadTokens: number | null;
};

/**
 * Price ONE turn exactly (per-tier, matching the rollups). User prompts carry no
 * usage → `tokens: null`, `costUsd: 0`. Assistant turns always report `tokens`;
 * an assistant turn with no resolved model is `unpriced` at `$0`.
 */
function priceTurn(row: TurnRow): {
  tokens: Tokens | null;
  costUsd: number;
  unpriced: boolean;
} {
  if (row.role !== "assistant") {
    return { tokens: null, costUsd: 0, unpriced: false };
  }
  const input = row.inputTokens ?? 0;
  const output = row.outputTokens ?? 0;
  const cw5m = row.cacheCreation5mTokens ?? 0;
  const cw1h = row.cacheCreation1hTokens ?? 0;
  const cr = row.cacheReadTokens ?? 0;
  const cacheWrite = cw5m + cw1h;
  const tokens: Tokens = {
    input,
    output,
    cacheWrite,
    cacheRead: cr,
    total: input + output + cacheWrite + cr,
  };
  if (row.model === null) {
    return { tokens, costUsd: 0, unpriced: true };
  }
  const cost = priceSplitByType(
    { input, output, cacheWrite5m: cw5m, cacheWrite1h: cw1h, cacheRead: cr },
    row.model,
  );
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
      messageId: true,
      toolUseId: true,
      name: true,
      inputJson: true,
      resultText: true,
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
      toolUseId: r.toolUseId,
      name: r.name,
      inputJson: r.inputJson,
      resultText: r.resultText,
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
  project: { folderName: string; path: string };
};

/**
 * One per-(model) token-sum row, as returned by a Prisma `groupBy` over
 * `message`. `model` may be null (a turn with no resolved model); `pricedRollup`
 * skips those (matching the old `m.model IS NOT NULL` SQL filter). The token
 * fields mirror `message` columns; SQL `SUM` ignores nulls, so an absent tier
 * arrives as null and folds to 0 (the old `COALESCE(..,0)` is no longer needed).
 */
type ModelSumRow = {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreation5mTokens: number | null;
  cacheCreation1hTokens: number | null;
  cacheReadTokens: number | null;
};

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
  const cost = priceSplitByType(
    { input, output, cacheWrite5m: cw5m, cacheWrite1h: cw1h, cacheRead: cr },
    model,
  );
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

/** Map a Prisma `message.groupBy` `_sum` row to the `ModelSumRow` fold shape. */
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

/** The `_sum` selection shared by every per-model groupBy (the five token tiers). */
const TOKEN_SUM = {
  inputTokens: true,
  outputTokens: true,
  cacheCreation5mTokens: true,
  cacheCreation1hTokens: true,
  cacheReadTokens: true,
} as const;

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

/** Group ALL messages of ALL agents in a conversation by model, priced exactly. */
async function pricedGroupsByModel(
  prisma: PrismaClient,
  conversationId: number,
): Promise<PricedGroup[]> {
  // Per-model token sums via one typed `groupBy` (ADR-0001: SUM, never stored
  // aggregates). `message.conversationId` is denormalized onto every row —
  // including sub-agent messages — so scoping by it rolls up every agent's
  // tokens without an `agent` join. SUM ignores nulls (no COALESCE needed).
  const grouped = await prisma.message.groupBy({
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
    project: { folder: convo.project.folderName, path: convo.project.path },
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
  };
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

function sortSummaries(
  summaries: ConversationSummary[],
  sortBy: keyof ConversationSummary,
  dir: "asc" | "desc",
): void {
  const factor = dir === "desc" ? -1 : 1;
  summaries.sort((a, b) => {
    const av = a[sortBy];
    const bv = b[sortBy];
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
    return String(av).localeCompare(String(bv)) * factor;
  });
}
