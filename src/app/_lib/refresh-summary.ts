// Pure presentation helpers for the Refresh result (slice 3). Like the sibling
// `format` module, this is free of React, I/O, and any runtime dependency on
// `src/core` (the only core touch is a type-only `RefreshSummary` import, erased
// at compile time). The client RefreshButton renders these strings; keeping the
// logic here means it is unit-tested in the node vitest environment.

import type { RefreshSummary } from "@/core/refresh";

/**
 * Human-readable elapsed time, so a multi-second scan reads as non-instant.
 *
 * Rule:
 *   - < 1000ms        -> whole milliseconds ("0ms", "850ms")
 *   - 1000ms..<10s    -> seconds at 1 decimal place ("1.0s", "1.2s")
 *   - >= 10s          -> whole seconds ("10s", "18s")
 *
 * The decimal is dropped at >= 10s because the tenth of a second is noise once
 * the duration is in the tens of seconds.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

/**
 * One-line, human-readable digest of a Refresh result for the status region:
 * "Parsed 12 · Skipped 5 · Deleted 2 · 3 malformed lines skipped · 1.2s".
 *
 * The malformed-lines segment is omitted entirely when zero (the common, clean
 * case) and singularized at exactly one. Duration is rendered by
 * {@link formatDuration}.
 */
export function formatRefreshSummary(summary: RefreshSummary): string {
  const segments = [
    `Parsed ${summary.conversationsParsed}`,
    `Skipped ${summary.conversationsSkipped}`,
    `Deleted ${summary.conversationsDeleted}`,
  ];
  if (summary.malformedLinesSkipped > 0) {
    const noun = summary.malformedLinesSkipped === 1 ? "line" : "lines";
    segments.push(`${summary.malformedLinesSkipped} malformed ${noun} skipped`);
  }
  segments.push(formatDuration(summary.durationMs));
  return segments.join(" · ");
}
