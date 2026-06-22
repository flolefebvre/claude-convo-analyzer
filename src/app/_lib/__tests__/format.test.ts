import { describe, expect, it } from "vitest";

import {
  formatCompactTokens,
  formatCost,
  formatDate,
  formatDateRange,
  formatDuration,
  formatGrandTotalCost,
  formatTokens,
} from "@/app/_lib/format";

describe("formatTokens", () => {
  it("formats an integer with thousands separators", () => {
    expect(formatTokens(1_234_567)).toBe("1,234,567");
  });
});

describe("formatCompactTokens", () => {
  it("leaves counts under 1,000 as a plain integer", () => {
    expect(formatCompactTokens(0)).toBe("0");
    expect(formatCompactTokens(999)).toBe("999");
  });

  it("abbreviates thousands / millions / billions to one decimal", () => {
    expect(formatCompactTokens(1_500)).toBe("1.5K");
    expect(formatCompactTokens(2_300_000)).toBe("2.3M");
    expect(formatCompactTokens(1_260_000_000)).toBe("1.3B");
  });

  it("drops a trailing .0 so round magnitudes stay clean", () => {
    expect(formatCompactTokens(2_000)).toBe("2K");
    expect(formatCompactTokens(5_000_000)).toBe("5M");
  });
});

describe("formatDateRange", () => {
  it("returns an empty string when both endpoints are empty", () => {
    expect(formatDateRange("", "")).toBe("");
  });

  it("shows a single date when the endpoints fall on the same UTC day", () => {
    const at = "2026-06-22T08:00:00.000Z";
    expect(formatDateRange(at, "2026-06-22T20:00:00.000Z")).toBe("Jun 22 2026");
    expect(formatDateRange("", at)).toBe("Jun 22 2026");
  });

  it("omits the repeated year within a same-year range", () => {
    expect(
      formatDateRange("2026-06-02T00:00:00.000Z", "2026-06-22T00:00:00.000Z"),
    ).toBe("Jun 2 – Jun 22 2026");
  });

  it("shows both years when the range spans a year boundary", () => {
    expect(
      formatDateRange("2025-12-30T00:00:00.000Z", "2026-06-22T00:00:00.000Z"),
    ).toBe("Dec 30 2025 – Jun 22 2026");
  });
});

describe("formatDuration", () => {
  it("returns empty string when either endpoint is missing or unparseable", () => {
    expect(formatDuration("", "2026-06-22T10:00:00Z")).toBe("");
    expect(formatDuration("2026-06-22T10:00:00Z", "")).toBe("");
    expect(formatDuration("nope", "2026-06-22T10:00:00Z")).toBe("");
  });

  it("renders sub-minute spans in seconds", () => {
    expect(formatDuration("2026-06-22T10:00:00Z", "2026-06-22T10:00:30Z")).toBe(
      "30s",
    );
  });

  it("renders sub-hour spans in whole minutes", () => {
    expect(formatDuration("2026-06-22T10:00:00Z", "2026-06-22T10:45:20Z")).toBe(
      "45m",
    );
  });

  it("renders multi-hour spans as hours and minutes, dropping a zero minute", () => {
    expect(formatDuration("2026-06-22T10:00:00Z", "2026-06-22T11:20:00Z")).toBe(
      "1h 20m",
    );
    expect(formatDuration("2026-06-22T10:00:00Z", "2026-06-22T12:00:00Z")).toBe(
      "2h",
    );
  });

  it("treats a non-positive span as zero seconds", () => {
    expect(formatDuration("2026-06-22T10:00:05Z", "2026-06-22T10:00:00Z")).toBe(
      "0s",
    );
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
