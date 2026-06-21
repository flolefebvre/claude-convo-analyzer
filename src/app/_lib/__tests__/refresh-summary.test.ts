import { describe, expect, it } from "vitest";

import type { RefreshSummary } from "@/core/refresh";

import {
  formatDuration,
  formatRefreshSummary,
} from "@/app/_lib/refresh-summary";

describe("formatDuration", () => {
  it("renders sub-second durations in milliseconds", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(850)).toBe("850ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("switches to seconds at 1000ms with one decimal under ten seconds", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(1234)).toBe("1.2s");
    expect(formatDuration(9949)).toBe("9.9s");
  });

  it("drops the decimal at ten seconds and above", () => {
    expect(formatDuration(10_000)).toBe("10s");
    expect(formatDuration(17_900)).toBe("18s");
  });
});

function summary(partial: Partial<RefreshSummary> = {}): RefreshSummary {
  return {
    conversationsParsed: partial.conversationsParsed ?? 0,
    conversationsSkipped: partial.conversationsSkipped ?? 0,
    conversationsDeleted: partial.conversationsDeleted ?? 0,
    malformedLinesSkipped: partial.malformedLinesSkipped ?? 0,
    durationMs: partial.durationMs ?? 0,
  };
}

describe("formatRefreshSummary", () => {
  it("renders all counts and the formatted duration in one line", () => {
    expect(
      formatRefreshSummary(
        summary({
          conversationsParsed: 12,
          conversationsSkipped: 5,
          conversationsDeleted: 2,
          malformedLinesSkipped: 3,
          durationMs: 1234,
        }),
      ),
    ).toBe("Parsed 12 · Skipped 5 · Deleted 2 · 3 malformed lines skipped · 1.2s");
  });

  it("singularizes the malformed-line phrase when exactly one", () => {
    expect(
      formatRefreshSummary(summary({ malformedLinesSkipped: 1, durationMs: 500 })),
    ).toBe("Parsed 0 · Skipped 0 · Deleted 0 · 1 malformed line skipped · 500ms");
  });

  it("omits the malformed-line segment when there are none", () => {
    expect(
      formatRefreshSummary(
        summary({ conversationsParsed: 1, durationMs: 12_000 }),
      ),
    ).toBe("Parsed 1 · Skipped 0 · Deleted 0 · 12s");
  });
});
