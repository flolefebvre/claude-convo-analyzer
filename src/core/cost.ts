import { ALIAS_TO_LATEST, PRICES } from "@/core/pricing";

export type Tokens = {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  total: number;
};

export type TokenSplit = {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
};

export type CostResult = {
  usd: number;
  unpriced: boolean;
  approximate: boolean;
};

export type CostByType = {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
};

export type SplitCostResult = CostResult & { byType: CostByType };

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

export function priceTokenSplit(split: TokenSplit, model: string): CostResult {
  const { usd, unpriced, approximate } = priceSplitByType(split, model);
  return { usd, unpriced, approximate };
}

export function priceSplitByType(split: TokenSplit, model: string): SplitCostResult {
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
