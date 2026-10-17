import { describe, expect, it } from "vitest";

import type { DailySpend } from "@/core/read";
import { buildTrendsView } from "@/app/_lib/trends";

/** A `Tokens` value from its four buckets (total derived, as the core does). */
function tokens(input: number, output: number, cacheWrite = 0, cacheRead = 0) {
  return {
    input,
    output,
    cacheWrite,
    cacheRead,
    total: input + output + cacheWrite + cacheRead,
  };
}

/** A minimal `DailySpend` — two days, one of them empty, two priced models. */
function spendFixture(): DailySpend {
  return {
    days: [
      {
        date: "2026-06-10",
        costUsd: 3,
        tokens: tokens(100, 50),
        perModel: [
          { model: "claude-opus-4-8", costUsd: 2 },
          { model: "claude-sonnet-4-6", costUsd: 1 },
        ],
      },
      { date: "2026-06-11", costUsd: 0, tokens: tokens(0, 0), perModel: [] },
    ],
    models: [
      { model: "claude-opus-4-8", costUsd: 2, tokens: tokens(60, 30) },
      { model: "claude-sonnet-4-6", costUsd: 1, tokens: tokens(40, 20) },
    ],
    totalCostUsd: 3,
    totalTokens: tokens(100, 50),
    hasUnpriced: false,
    hasApproximate: false,
  };
}

describe("buildTrendsView", () => {
  it("keeps the core's cost ranking as the band order", () => {
    const view = buildTrendsView(spendFixture());

    expect(view.bands.map((b) => b.model)).toEqual(["claude-opus-4-8", "claude-sonnet-4-6"]);
    // Each band knows its share of the range total (the legend's bar).
    expect(view.bands[0]?.share).toBeCloseTo(2 / 3, 12);
  });

  it("gives every day a point, with a zero for each band on an empty day", () => {
    const view = buildTrendsView(spendFixture());

    expect(view.points).toHaveLength(2);
    expect(view.points[0]?.models).toEqual({
      "claude-opus-4-8": 2,
      "claude-sonnet-4-6": 1,
    });
    // The untouched day still carries every band at zero, so the stack is
    // continuous instead of dropping to nothing.
    expect(view.points[1]?.models).toEqual({
      "claude-opus-4-8": 0,
      "claude-sonnet-4-6": 0,
    });
    expect(view.points[1]?.costUsd).toBe(0);
    expect(view.points[0]?.label).toBe("Jun 10");
  });

  it("carries the range totals and the lower-bound flags through", () => {
    const spend = spendFixture();
    spend.hasUnpriced = true;
    spend.hasApproximate = true;
    const view = buildTrendsView(spend);

    expect(view.totalCostUsd).toBe(3);
    expect(view.totalTokens.total).toBe(150);
    expect(view.isApproximate).toBe(true);
  });

  it("is empty when the range holds no priced spend", () => {
    const view = buildTrendsView({
      days: [{ date: "2026-06-11", costUsd: 0, tokens: tokens(0, 0), perModel: [] }],
      models: [],
      totalCostUsd: 0,
      totalTokens: tokens(0, 0),
      hasUnpriced: false,
      hasApproximate: false,
    });

    expect(view.isEmpty).toBe(true);
    expect(view.bands).toEqual([]);
  });

  it("colors each band by its model family, whatever its cost rank", () => {
    const view = buildTrendsView(withModels(["claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-8"]));

    expect(colorsByModel(view)).toEqual({
      "claude-opus-4-8": "var(--chart-1)",
      "claude-sonnet-4-6": "var(--chart-3)",
      "claude-haiku-4-5-20251001": "var(--chart-4)",
    });
  });

  it("keeps a model's color when another range reorders the models' costs", () => {
    const models = ["claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"];
    const thirtyDays = buildTrendsView(withModels(models));
    const sevenDays = buildTrendsView(withModels([...models].reverse()));

    expect(colorsByModel(sevenDays)).toEqual(colorsByModel(thirtyDays));
  });

  it("gives the newest version of a family the family's color, and an older one another", () => {
    const view = buildTrendsView(withModels(["claude-opus-4-7", "claude-opus-4-8"]));

    expect(colorsByModel(view)["claude-opus-4-8"]).toBe("var(--chart-1)");
    expect(colorsByModel(view)["claude-opus-4-7"]).not.toBe("var(--chart-1)");
  });

  it("never repeats a color among the bands, even past the palette's size", () => {
    const view = buildTrendsView(
      withModels([
        "claude-opus-4-8",
        "claude-opus-4-7",
        "claude-opus-4-1",
        "claude-sonnet-4-6",
        "claude-sonnet-4-5",
        "claude-3-7-sonnet",
        "claude-haiku-4-5",
        "claude-3-5-haiku",
        "some-other-model",
        "another-model",
      ]),
    );

    expect(new Set(view.bands.map((b) => b.color)).size).toBe(10);
  });
});

/** A spend whose models come in the given (cost) order, one dollar apart. */
function withModels(models: string[]): DailySpend {
  const spend = spendFixture();
  spend.models = models.map((model, i) => ({ model, costUsd: models.length - i, tokens: tokens(1, 1) }));
  return spend;
}

/** Each band's color, keyed by its model. */
function colorsByModel(view: ReturnType<typeof buildTrendsView>): Record<string, string> {
  return Object.fromEntries(view.bands.map((b) => [b.model, b.color]));
}
