// Pure cost layer (ADR-0003). No DB, no filesystem, no network, no next/react.
//
// Two pricing entry points:
//   - priceTokenSplit(): the precise primitive. Takes cache-write tiers SEPARATED
//     (5m vs 1h), as the `message` table stores them. Rollups use this for exact
//     per-tier cost.
//   - computeCost(): the public seam (the contract issue #2 builds against). Takes
//     the MERGED Tokens shape, where cacheWrite = 5m + 1h. It can't tell the tiers
//     apart, so it prices the merged cacheWrite at the 5m tier (the standard
//     cache-write tier; 1h is the less-common premium). Exact per-tier pricing is
//     applied via priceTokenSplit during rollups where the tiers are preserved.

import { ALIAS_TO_LATEST, PRICES } from "@/core/pricing";

/**
 * Rolled-up token split for a unit of work (a turn, a model, a conversation).
 * `cacheWrite` is the MERGED 5m+1h cache-creation sum (the two ephemeral tiers
 * price differently but are summed here — see ADR-0001 finding #3). `total` is
 * the sum of all token buckets.
 */
export type Tokens = {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  total: number;
};

/** Cache-write tiers kept SEPARATE — the exact shape priceTokenSplit prices. */
export type TokenSplit = {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
};

/** What a price computation yields. `approximate` is additive (ADR-0003 alias policy). */
export type CostResult = {
  usd: number;
  unpriced: boolean;
  approximate: boolean;
};

/**
 * The per-bucket dollar split of a price computation (ADR-0003). One USD figure
 * per token type; the four buckets sum exactly to the `usd` total. `cacheWrite`
 * combines the 5m and 1h ephemeral tiers, EACH priced at its own rate then
 * summed into this single bucket (ADR-0001 finding #3). An unpriced model
 * contributes `0` to every bucket.
 */
export type CostByType = {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
};

/** A `CostResult` plus its per-bucket dollar split (the four buckets sum to `usd`). */
export type SplitCostResult = CostResult & { byType: CostByType };

/**
 * Resolve a raw model string to a canonical price-table key. Pure; reused by
 * every pricing path so alias/synthetic/unknown handling stays in one place.
 *
 *  - known resolved model  → { key, approximate: false, unpriced: false }
 *  - bare family alias     → { key: family-latest, approximate: true, unpriced: false }
 *  - <synthetic> / unknown → { key: null, approximate: false, unpriced: true }
 */
export function resolveModel(model: string): {
  key: string | null;
  approximate: boolean;
  unpriced: boolean;
} {
  if (model in PRICES) {
    return { key: model, approximate: false, unpriced: false };
  }
  const aliasTarget = ALIAS_TO_LATEST[model];
  if (aliasTarget !== undefined) {
    return { key: aliasTarget, approximate: true, unpriced: false };
  }
  return { key: null, approximate: false, unpriced: true };
}

/**
 * Precise pricing primitive: prices a token split with cache-write tiers kept
 * SEPARATE (5m vs 1h priced distinctly). This is the seam later slices use to
 * cost the `message` table's per-tier columns exactly.
 */
export function priceTokenSplit(split: TokenSplit, model: string): CostResult {
  const { usd, unpriced, approximate } = priceSplitByType(split, model);
  return { usd, unpriced, approximate };
}

/**
 * Same precise pricing as `priceTokenSplit`, but ALSO surfaces the per-bucket
 * dollar split (`CostByType`). The two cache-write tiers are each priced at
 * their own rate, then summed into the single `cacheWrite` bucket; the four
 * buckets sum exactly to `usd`. An unpriced model yields `$0` for every bucket
 * and the `usd` total, while still setting `unpriced` (ADR-0003).
 */
export function priceSplitByType(
  split: TokenSplit,
  model: string,
): SplitCostResult {
  const { key, approximate, unpriced } = resolveModel(model);
  if (key === null) {
    return {
      usd: 0,
      unpriced: true,
      approximate: false,
      byType: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    };
  }
  const p = PRICES[key];
  const byType: CostByType = {
    input: split.input * p.input,
    output: split.output * p.output,
    cacheWrite: split.cacheWrite5m * p.cacheWrite5m + split.cacheWrite1h * p.cacheWrite1h,
    cacheRead: split.cacheRead * p.cacheRead,
  };
  const usd = byType.input + byType.output + byType.cacheWrite + byType.cacheRead;
  return { usd, unpriced, approximate, byType };
}

/**
 * Public cost seam (stable contract). Prices a MERGED Tokens value. Because
 * `cacheWrite` is the 5m+1h sum with the tiers lost, it is priced at the 5m tier
 * via priceTokenSplit; exact per-tier pricing is applied via priceTokenSplit
 * during rollups where the tiers are preserved.
 *
 * `usd` and `unpriced` are the specified, load-bearing fields; `approximate` is
 * additive (true only for bare aliases).
 */
export function computeCost(tokens: Tokens, model: string): CostResult {
  return priceTokenSplit(
    {
      input: tokens.input,
      output: tokens.output,
      cacheWrite5m: tokens.cacheWrite,
      cacheWrite1h: 0,
      cacheRead: tokens.cacheRead,
    },
    model,
  );
}
