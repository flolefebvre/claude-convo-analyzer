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
  type Tokens,
} from "@/core/cost";
import { createPrismaClient, DEFAULT_DB_PATH } from "@/core/db";
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
  const prisma = createPrismaClient(opts.dbPath ?? DEFAULT_DB_PATH);
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
    const continuedFromById = await resolveContinuedFromIds(
      prisma,
      conversations,
    );

    const summaries = conversations.map((convo) =>
      assembleSummary(convo, {
        groups: pricedRollup(modelRowsById.get(convo.id) ?? []),
        bounds: boundsById.get(convo.id) ?? { startedAt: "", endedAt: "" },
        subAgentCount: subCountById.get(convo.id) ?? 0,
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
    await prisma.$disconnect();
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
  const prisma = createPrismaClient(opts.dbPath ?? DEFAULT_DB_PATH);
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
    await prisma.$disconnect();
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

  // One batched per-(agent, model) groupBy for ALL sub-agents (was N+1) — then
  // bucket by agentId and fold each bucket through `pricedRollup`.
  const grouped =
    subs.length === 0
      ? []
      : await prisma.message.groupBy({
          by: ["agentId", "model"],
          where: { agentId: { in: subs.map((s) => s.id) }, model: { not: null } },
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

  return subs.map((sub) => {
    const groups = pricedRollup(rowsByAgent.get(sub.id) ?? []);
    const tokens: Tokens = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 };
    let costUsd = 0;
    for (const g of groups) {
      addTokens(tokens, g.tokens);
      costUsd += g.costUsd;
    }
    return {
      agentId: sub.externalAgentId ?? String(sub.id),
      agentType: sub.agentType ?? "",
      model: sub.resolvedModel ?? "",
      tokens,
      costUsd,
    };
  });
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
