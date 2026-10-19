// Unlogged usage (GLOSSARY.md): the token usage a Recording adds to a
// Conversation's Cost — its Side requests' and its failed attempts' — read
// from `api_request`, never from a Turn's own API request (the logs' Turn
// usage is the source of truth, ADR-0006). It comes back as the same token-sum
// rows the `message` rollups fold, so every Cost view prices it through the
// one priced fold in `read.ts` (`priceSplitByType`), and they all agree.
// Framework-free (ADR-0002).

import type { FolderScopeOptions } from "@/core/folder-scope";
import { conversationInFolderScope } from "@/core/folder-scope";
import type { Prisma, PrismaClient } from "@/core/prisma/generated/client";

/**
 * One per-model token-sum row, the shape every priced rollup folds: a
 * `message` or `api_request` groupBy's `_sum`, or an unlogged-usage row.
 * `model` may be null (a turn with no resolved model); the fold skips those.
 * SQL `SUM` ignores nulls, so an absent tier arrives as null and folds to 0.
 */
export type ModelSumRow = {
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreation5mTokens: number | null;
  cacheCreation1hTokens: number | null;
  cacheReadTokens: number | null;
};

/** One timestamped usage row, as the daily fold buckets it by local day: a Message, or an unlogged API request at its arrival. */
export type DailyUsageRow = ModelSumRow & {
  /** Epoch ms; a row without one cannot be bucketed and is skipped. */
  timestamp: bigint | number | null;
};

/** The `_sum` selection shared by every per-model groupBy (the five token tiers). */
export const TOKEN_SUM = {
  inputTokens: true,
  outputTokens: true,
  cacheCreation5mTokens: true,
  cacheCreation1hTokens: true,
  cacheReadTokens: true,
} as const;

/**
 * The `api_request` rows that reported usage on a model (their token columns
 * are all set or all null).
 *
 * @example const priced = await prisma.apiRequest.findMany({ where: { conversationId, ...REPORTED_USAGE_WHERE } });
 */
export const REPORTED_USAGE_WHERE = {
  inputTokens: { not: null },
  model: { not: null },
} satisfies Prisma.ApiRequestWhereInput;

/** The `api_request` rows whose usage is unlogged: every one that is not a Turn's own request, and that reported usage. */
const UNLOGGED_USAGE_WHERE = {
  kind: { not: "turn" },
  ...REPORTED_USAGE_WHERE,
} satisfies Prisma.ApiRequestWhereInput;

/**
 * The unlogged usage of every Conversation, or of the one `conversationId`
 * names, summed per Conversation and per Resolved model — rows to merge into
 * the Conversation's per-model rows before they are priced.
 *
 * @example
 * const rows = await unloggedUsageByConversationAndModel(prisma, { conversationId: convo.id });
 */
export async function unloggedUsageByConversationAndModel(
  prisma: PrismaClient,
  where: { conversationId?: number } = {},
): Promise<(ModelSumRow & { conversationId: number })[]> {
  const grouped = await prisma.apiRequest.groupBy({
    by: ["conversationId", "model"],
    where: { ...UNLOGGED_USAGE_WHERE, ...where },
    _sum: TOKEN_SUM,
  });
  return grouped.map((group) => ({ conversationId: group.conversationId, model: group.model, ...group._sum }));
}

/**
 * The unlogged usage that arrived in `[from, to)` (from the start when `from`
 * is null) in the Conversations of `scope`, one row per API request
 * timestamped at its arrival, so it lands on the local day it ran, like a Turn.
 *
 * @example
 * const rows = await unloggedUsageByArrival(prisma, { from: null, to: tomorrow }, { folder: "/a" });
 */
export async function unloggedUsageByArrival(
  prisma: PrismaClient,
  range: { from: Date | null; to: Date },
  scope: FolderScopeOptions,
): Promise<DailyUsageRow[]> {
  const rows = await prisma.apiRequest.findMany({
    where: {
      ...UNLOGGED_USAGE_WHERE,
      arrivedAt: {
        lt: BigInt(range.to.getTime()),
        ...(range.from === null ? {} : { gte: BigInt(range.from.getTime()) }),
      },
      ...(await conversationInFolderScope(prisma, scope)),
    },
    select: { arrivedAt: true, model: true, ...TOKEN_SUM },
  });
  return rows.map(({ arrivedAt, ...usage }) => ({ timestamp: arrivedAt, ...usage }));
}
