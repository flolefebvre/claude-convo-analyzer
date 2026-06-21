import { describe, expect, it } from "vitest";

import {
  computeCost,
  priceTokenSplit,
  resolveModel,
  type TokenSplit,
  type Tokens,
} from "@/core/cost";

// A Tokens value with every bucket set, so each test can zero out all but the
// bucket it cares about and reason about one price at a time.
function tokens(partial: Partial<Tokens>): Tokens {
  const input = partial.input ?? 0;
  const output = partial.output ?? 0;
  const cacheWrite = partial.cacheWrite ?? 0;
  const cacheRead = partial.cacheRead ?? 0;
  return {
    input,
    output,
    cacheWrite,
    cacheRead,
    total: partial.total ?? input + output + cacheWrite + cacheRead,
  };
}

describe("computeCost — known resolved models", () => {
  it("prices claude-opus-4-8 input at $5/MTok", () => {
    // 1,000,000 input tokens at $5/MTok = $5.
    const result = computeCost(tokens({ input: 1_000_000 }), "claude-opus-4-8");
    expect(result).toEqual({ usd: 5, unpriced: false, approximate: false });
  });

  it("prices claude-opus-4-8 output at $25/MTok", () => {
    const result = computeCost(tokens({ output: 1_000_000 }), "claude-opus-4-8");
    expect(result).toEqual({ usd: 25, unpriced: false, approximate: false });
  });

  it("prices claude-sonnet-4-6 at its own (cheaper) rates", () => {
    // 1M input @ $3 + 1M output @ $15 = $18.
    const result = computeCost(
      tokens({ input: 1_000_000, output: 1_000_000 }),
      "claude-sonnet-4-6",
    );
    expect(result).toEqual({ usd: 18, unpriced: false, approximate: false });
  });

  it("prices claude-haiku-4-5-20251001 cache reads at $0.10/MTok (0.1x input)", () => {
    const result = computeCost(
      tokens({ cacheRead: 1_000_000 }),
      "claude-haiku-4-5-20251001",
    );
    expect(result).toEqual({ usd: 0.1, unpriced: false, approximate: false });
  });
});

function split(partial: Partial<TokenSplit>): TokenSplit {
  return {
    input: partial.input ?? 0,
    output: partial.output ?? 0,
    cacheWrite5m: partial.cacheWrite5m ?? 0,
    cacheWrite1h: partial.cacheWrite1h ?? 0,
    cacheRead: partial.cacheRead ?? 0,
  };
}

describe("priceTokenSplit — cache tiers are distinct", () => {
  it("prices a 5m cache write at 1.25x base input ($6.25/MTok on opus-4-8)", () => {
    const result = priceTokenSplit(
      split({ cacheWrite5m: 1_000_000 }),
      "claude-opus-4-8",
    );
    expect(result).toEqual({ usd: 6.25, unpriced: false, approximate: false });
  });

  it("prices a 1h cache write at 2x base input ($10/MTok on opus-4-8) — distinct from 5m", () => {
    const result = priceTokenSplit(
      split({ cacheWrite1h: 1_000_000 }),
      "claude-opus-4-8",
    );
    expect(result).toEqual({ usd: 10, unpriced: false, approximate: false });
    // The 5m and 1h tiers must price differently.
    expect(result.usd).not.toBe(6.25);
  });
});

describe("computeCost — merged cacheWrite is priced at the 5m tier", () => {
  it("prices merged cacheWrite at the 5m rate, not the 1h rate", () => {
    // 1M merged cacheWrite → priced as 5m: 1M * $6.25/MTok = $6.25.
    const result = computeCost(
      tokens({ cacheWrite: 1_000_000 }),
      "claude-opus-4-8",
    );
    expect(result).toEqual({ usd: 6.25, unpriced: false, approximate: false });
  });
});

describe("computeCost — bare aliases price at family-latest, flagged approximate", () => {
  it("prices `opus` at claude-opus-4-8 rates and flags approximate (still priced)", () => {
    const alias = computeCost(tokens({ input: 1_000_000 }), "opus");
    const resolved = computeCost(
      tokens({ input: 1_000_000 }),
      "claude-opus-4-8",
    );
    expect(alias.usd).toBe(resolved.usd);
    expect(alias.unpriced).toBe(false);
    expect(alias.approximate).toBe(true);
  });

  it("prices `sonnet` at claude-sonnet-4-6 rates, approximate", () => {
    const result = computeCost(tokens({ input: 1_000_000 }), "sonnet");
    expect(result).toEqual({ usd: 3, unpriced: false, approximate: true });
  });

  it("prices `haiku` at claude-haiku-4-5 rates, approximate", () => {
    const result = computeCost(tokens({ input: 1_000_000 }), "haiku");
    expect(result).toEqual({ usd: 1, unpriced: false, approximate: true });
  });
});

describe("computeCost — synthetic and unknown models contribute $0, flagged unpriced", () => {
  it("flags <synthetic> as unpriced with $0", () => {
    const result = computeCost(
      tokens({ input: 1_000_000, output: 1_000_000 }),
      "<synthetic>",
    );
    expect(result).toEqual({ usd: 0, unpriced: true, approximate: false });
  });

  it("flags an unknown model as unpriced with $0", () => {
    const result = computeCost(
      tokens({ input: 1_000_000 }),
      "some-future-model-99",
    );
    expect(result).toEqual({ usd: 0, unpriced: true, approximate: false });
  });
});

describe("Tokens.total is the sum of all token buckets", () => {
  it("computes a known model's cost across every bucket and reflects total", () => {
    const t = tokens({
      input: 100,
      output: 200,
      cacheWrite: 300,
      cacheRead: 400,
    });
    // total auto-summed by the helper.
    expect(t.total).toBe(1000);
    // Cost still computes over the individual buckets (opus-4-8, cacheWrite@5m):
    //   100*$5 + 200*$25 + 300*$6.25 + 400*$0.50  (all /MTok)
    const perMTok = 1_000_000;
    const expected =
      (100 * 5 + 200 * 25 + 300 * 6.25 + 400 * 0.5) / perMTok;
    const result = computeCost(t, "claude-opus-4-8");
    expect(result.usd).toBeCloseTo(expected, 12);
    expect(result.unpriced).toBe(false);
  });
});

describe("resolveModel — shared resolution logic", () => {
  it("maps a known model to itself, not approximate, not unpriced", () => {
    expect(resolveModel("claude-opus-4-8")).toEqual({
      key: "claude-opus-4-8",
      approximate: false,
      unpriced: false,
    });
  });

  it("maps a bare alias to family-latest and flags approximate", () => {
    expect(resolveModel("opus")).toEqual({
      key: "claude-opus-4-8",
      approximate: true,
      unpriced: false,
    });
  });

  it("maps <synthetic> to no key, unpriced", () => {
    expect(resolveModel("<synthetic>")).toEqual({
      key: null,
      approximate: false,
      unpriced: true,
    });
  });
});
