// Dated, versioned Anthropic API price table (ADR-0003).
//
// PRICING POLICY: the displayed cost is "what these tokens would list for on the
// public Anthropic API today" — current list price, not the user's subscription
// economics. Hardcoded, no network (ADR-0002/0003). Re-pricing = edit this table
// and bump the version comment below; all historical conversations reprice
// instantly because cost is computed at query time, never stored (ADR-0001).
//
// UNITS: every rate below is USD per *single* token (USD/MTok ÷ 1_000_000).
// Storing per-token keeps computeCost a plain multiply with no scaling factor.
//
// SOURCE & DATE: Anthropic list prices as of 2026-07-02.
//   - Base input/output USD/MTok: claude-api skill model table (cached 2026-06-24):
//       fable-5 $10 / $50,  opus-4-8 $5 / $25,  opus-4-7 $5 / $25,
//       opus-4-6 $5 / $25,  sonnet-5 $3 / $15,  sonnet-4-6 $3 / $15,
//       haiku-4-5 $1 / $5.
//   - sonnet-5: Anthropic also lists an introductory rate of $2 / $10 through
//       2026-08-31; per ADR-0003 ("not blended/discounted rates") we price at the
//       standard $3 / $15 list rate, not the temporary intro discount.
//   - Cache-tier multipliers vs base input (platform.claude.com prompt-caching docs):
//       cache write 5m = 1.25x base input,  cache write 1h = 2x base input,
//       cache read = 0.1x base input.
//   Cache tiers are kept DISTINCT here (not derived by a shared multiplier at call
//   time) so a model with atypical cache pricing stays correct — ADR-0003.
//
// PRICE TABLE VERSION: 2026-07-02.1

const PER_MTOK = 1_000_000;

/** Explicit per-token (USD) rates for one resolved model. Cache tiers distinct. */
export type ModelPrices = {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
};

/** Build a per-token price row from USD/MTok base prices + standard cache multipliers. */
function priceRow(inputPerMTok: number, outputPerMTok: number): ModelPrices {
  return {
    input: inputPerMTok / PER_MTOK,
    output: outputPerMTok / PER_MTOK,
    cacheWrite5m: (inputPerMTok * 1.25) / PER_MTOK,
    cacheWrite1h: (inputPerMTok * 2) / PER_MTOK,
    cacheRead: (inputPerMTok * 0.1) / PER_MTOK,
  };
}

/**
 * Canonical price-table keys → per-token prices. Keys are the *resolved* model
 * ids seen in the logs (finding #9). Bare aliases and unknown/synthetic models
 * are handled by the resolver, not by extra rows here.
 */
export const PRICES: Record<string, ModelPrices> = {
  "claude-fable-5": priceRow(10, 50),
  "claude-opus-4-8": priceRow(5, 25),
  "claude-opus-4-7": priceRow(5, 25),
  "claude-opus-4-6": priceRow(5, 25),
  "claude-sonnet-5": priceRow(3, 15),
  "claude-sonnet-4-6": priceRow(3, 15),
  "claude-haiku-4-5-20251001": priceRow(1, 5),
};

/**
 * Bare family aliases → the latest resolved model of that family. Pricing an
 * alias is approximate (ADR-0003): we price it at the family-latest rate and the
 * resolver flags it. `unpriced` stays false — aliases ARE priced.
 */
export const ALIAS_TO_LATEST: Record<string, string> = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5-20251001",
};
