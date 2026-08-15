export const PRICE_TABLE_VERSION = "2026-07-25.1";

export const PRICE_TABLE_SOURCE = {
  url: "https://platform.claude.com/docs/en/about-claude/pricing",
  asOf: "2026-07-25",
};

const PER_MTOK = 1_000_000;

export type ModelPrices = {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
};

function priceRow(inputPerMTok: number, outputPerMTok: number): ModelPrices {
  return {
    input: inputPerMTok / PER_MTOK,
    output: outputPerMTok / PER_MTOK,
    cacheWrite5m: (inputPerMTok * 1.25) / PER_MTOK,
    cacheWrite1h: (inputPerMTok * 2) / PER_MTOK,
    cacheRead: (inputPerMTok * 0.1) / PER_MTOK,
  };
}

export const PRICES: Record<string, ModelPrices> = {
  "claude-fable-5": priceRow(10, 50),
  "claude-opus-5": priceRow(5, 25),
  "claude-opus-4-8": priceRow(5, 25),
  "claude-opus-4-7": priceRow(5, 25),
  "claude-opus-4-6": priceRow(5, 25),
  "claude-sonnet-5": priceRow(3, 15),
  "claude-sonnet-4-6": priceRow(3, 15),
  "claude-haiku-4-5-20251001": priceRow(1, 5),
};

export const ALIAS_TO_LATEST: Record<string, string> = {
  opus: "claude-opus-5",
  sonnet: "claude-sonnet-5",
  haiku: "claude-haiku-4-5-20251001",
};
