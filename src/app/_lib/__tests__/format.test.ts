import { describe, expect, it } from "vitest";

import type { Tokens } from "@/core/cost";

import {
  formatCost,
  formatDate,
  formatGrandTotalCost,
  formatTokens,
  grandTotal,
} from "@/app/_lib/format";

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

describe("formatTokens", () => {
  it("formats an integer with thousands separators", () => {
    expect(formatTokens(1_234_567)).toBe("1,234,567");
  });
});

describe("formatCost", () => {
  it("renders values >= 0.01 at 2 decimal places", () => {
    expect(formatCost(12.34)).toBe("$12.34");
  });

  it("rounds to 2 decimal places at the 0.01 boundary", () => {
    expect(formatCost(0.01)).toBe("$0.01");
    expect(formatCost(0.005)).toBe("$0.0050");
  });

  it("renders tiny values with up to 4 decimal places to stay legible", () => {
    expect(formatCost(0.0042)).toBe("$0.0042");
  });

  it("renders zero as $0.00", () => {
    expect(formatCost(0)).toBe("$0.00");
  });
});

describe("formatGrandTotalCost", () => {
  it("always renders at 2 decimal places", () => {
    expect(formatGrandTotalCost(12.3456)).toBe("$12.35");
    expect(formatGrandTotalCost(0)).toBe("$0.00");
    expect(formatGrandTotalCost(0.0042)).toBe("$0.00");
  });
});

describe("formatDate", () => {
  const now = new Date("2026-06-22T12:00:00Z");

  it("renders a placeholder for null", () => {
    expect(formatDate(null, now)).toEqual({ label: "—", absolute: "" });
  });

  it("renders a placeholder for an empty string", () => {
    expect(formatDate("", now)).toEqual({ label: "—", absolute: "" });
  });

  it("renders a placeholder for an unparseable date", () => {
    expect(formatDate("not-a-date", now)).toEqual({ label: "—", absolute: "" });
  });

  it("labels a sub-minute difference as 'just now'", () => {
    expect(formatDate("2026-06-22T11:59:30Z", now).label).toBe("just now");
  });

  it("labels a same-day difference in minutes", () => {
    expect(formatDate("2026-06-22T11:55:00Z", now).label).toBe("5m ago");
  });

  it("labels a same-day difference in hours past the hour boundary", () => {
    expect(formatDate("2026-06-22T10:00:00Z", now).label).toBe("2h ago");
  });

  it("labels an earlier day in the same year as 'MMM d'", () => {
    expect(formatDate("2026-06-19T08:00:00Z", now).label).toBe("Jun 19");
  });

  it("labels an earlier year as 'MMM d yyyy'", () => {
    expect(formatDate("2025-03-04T08:00:00Z", now).label).toBe("Mar 4 2025");
  });

  it("returns a deterministic absolute timestamp in UTC for hover", () => {
    expect(formatDate("2026-06-19T14:30:00Z", now).absolute).toBe(
      "Jun 19, 2026, 14:30 UTC",
    );
  });
});

describe("grandTotal", () => {
  it("sums tokens by bucket and sums costUsd across rows", () => {
    const result = grandTotal([
      {
        tokens: tokens({ input: 10, output: 20, cacheWrite: 1, cacheRead: 2 }),
        costUsd: 1.5,
        unpriced: false,
      },
      {
        tokens: tokens({ input: 5, output: 7, cacheWrite: 3, cacheRead: 4 }),
        costUsd: 2.25,
        unpriced: false,
      },
    ]);

    expect(result.tokens).toEqual({
      input: 15,
      output: 27,
      cacheWrite: 4,
      cacheRead: 6,
      total: 52,
    });
    expect(result.costUsd).toBe(3.75);
  });

  it("reports hasUnpriced false when no row is unpriced", () => {
    const result = grandTotal([
      { tokens: tokens({ input: 1 }), costUsd: 0, unpriced: false },
      { tokens: tokens({ input: 2 }), costUsd: 0, unpriced: false },
    ]);
    expect(result.hasUnpriced).toBe(false);
  });

  it("reports hasUnpriced true when any row is unpriced", () => {
    const result = grandTotal([
      { tokens: tokens({ input: 1 }), costUsd: 0, unpriced: false },
      { tokens: tokens({ input: 2 }), costUsd: 0, unpriced: true },
    ]);
    expect(result.hasUnpriced).toBe(true);
  });

  it("returns a zeroed total for an empty list", () => {
    const result = grandTotal([]);
    expect(result.tokens).toEqual({
      input: 0,
      output: 0,
      cacheWrite: 0,
      cacheRead: 0,
      total: 0,
    });
    expect(result.costUsd).toBe(0);
    expect(result.hasUnpriced).toBe(false);
  });
});
