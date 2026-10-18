import { describe, expect, it } from "vitest";

import type { RefreshSummary } from "@/core/refresh";

import {
  formatDuplicateSessionDetail,
  formatOutdatedParserNotice,
  formatRefreshSummary,
} from "@/app/_lib/refresh-summary";

function summary(partial: Partial<RefreshSummary> = {}): RefreshSummary {
  return {
    conversationsParsed: partial.conversationsParsed ?? 0,
    conversationsSkipped: partial.conversationsSkipped ?? 0,
    conversationsDeleted: partial.conversationsDeleted ?? 0,
    malformedLinesSkipped: partial.malformedLinesSkipped ?? 0,
    duplicateSessionsSkipped: partial.duplicateSessionsSkipped ?? [],
    vanishedLogFilesSkipped: partial.vanishedLogFilesSkipped ?? 0,
    durationMs: partial.durationMs ?? 0,
    durationMsByPhase: partial.durationMsByPhase ?? { discovery: 0, parse: 0, write: 0, links: 0, stamp: 0 },
  };
}

/** `n` distinct log files all claiming one session id, minus the winner. */
function duplicates(n: number): RefreshSummary["duplicateSessionsSkipped"] {
  return Array.from({ length: n }, (_, i) => ({
    sessionId: `sess-${i}`,
    keptPath: `/logs/-a/sess-${i}.jsonl`,
    skippedPath: `/logs/-b/sess-${i}.jsonl`,
  }));
}

describe("formatRefreshSummary", () => {
  it("says everything is up to date when no conversation changed", () => {
    expect(formatRefreshSummary(summary({ conversationsSkipped: 60, durationMs: 18 }))).toBe(
      "Everything is up to date",
    );
  });

  it("counts updated and removed conversations in plain words", () => {
    expect(formatRefreshSummary(summary({ conversationsParsed: 3, conversationsDeleted: 2 }))).toBe(
      "3 conversations updated, 2 removed",
    );
    expect(formatRefreshSummary(summary({ conversationsParsed: 1 }))).toBe("1 conversation updated");
    expect(formatRefreshSummary(summary({ conversationsDeleted: 1 }))).toBe("1 conversation removed");
  });

  it("adds the log lines it could not read, singular at one", () => {
    expect(formatRefreshSummary(summary({ conversationsParsed: 2, malformedLinesSkipped: 3 }))).toBe(
      "2 conversations updated, 3 log lines could not be read",
    );
    expect(formatRefreshSummary(summary({ malformedLinesSkipped: 1 }))).toBe(
      "Everything is up to date, 1 log line could not be read",
    );
  });

  it("adds the duplicate log files it ignored, singular at one", () => {
    expect(formatRefreshSummary(summary({ duplicateSessionsSkipped: duplicates(1) }))).toBe(
      "Everything is up to date, 1 duplicate log file ignored",
    );
    expect(formatRefreshSummary(summary({ conversationsParsed: 1, duplicateSessionsSkipped: duplicates(2) }))).toBe(
      "1 conversation updated, 2 duplicate log files ignored",
    );
  });
});

describe("formatDuplicateSessionDetail", () => {
  it("names the file that was skipped and the one that was kept for each session", () => {
    expect(formatDuplicateSessionDetail(summary({ duplicateSessionsSkipped: duplicates(2) }))).toBe(
      [
        "Two log files shared one session id; only one was ingested:",
        "sess-0: skipped /logs/-b/sess-0.jsonl (kept /logs/-a/sess-0.jsonl)",
        "sess-1: skipped /logs/-b/sess-1.jsonl (kept /logs/-a/sess-1.jsonl)",
      ].join("\n"),
    );
  });

  it("has nothing to report when no duplicate was skipped", () => {
    expect(formatDuplicateSessionDetail(summary())).toBeNull();
  });
});

describe("formatOutdatedParserNotice", () => {
  it("names how many conversations need a Refresh, with thousands separators", () => {
    expect(formatOutdatedParserNotice(2445)).toBe(
      "The parser was updated — 2,445 conversations need a Refresh to show the latest data.",
    );
  });

  it("uses the singular for one conversation", () => {
    expect(formatOutdatedParserNotice(1)).toBe(
      "The parser was updated — 1 conversation needs a Refresh to show the latest data.",
    );
  });
});
