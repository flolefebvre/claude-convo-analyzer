// Pure presentation helpers for the Refresh result (slice 3). Like the sibling
// `format` module, this is free of React, I/O, and any runtime dependency on
// `src/core` (the only core touch is a type-only `RefreshSummary` import, erased
// at compile time). The client RefreshButton renders these strings; keeping the
// logic here means it is unit-tested in the node vitest environment.

import type { RefreshSummary } from "@/core/refresh";

/** `n` and its noun, singular at exactly one: `plural(3, "log line")` → "3 log lines". */
function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * The Refresh result in plain words, for the status line under the button:
 * "Everything is up to date", or "3 conversations updated, 1 removed".
 * Unreadable log lines and ignored duplicate log files are appended only when
 * there are some.
 *
 * @example formatRefreshSummary(result.data) // "2 conversations updated, 1 log line could not be read"
 */
export function formatRefreshSummary(summary: RefreshSummary): string {
  const parsed = summary.conversationsParsed;
  const deleted = summary.conversationsDeleted;
  const segments: string[] = [];
  if (parsed > 0) segments.push(`${plural(parsed, "conversation")} updated`);
  // "3 conversations updated, 1 removed": the noun is said once.
  if (deleted > 0) segments.push(parsed > 0 ? `${deleted} removed` : `${plural(deleted, "conversation")} removed`);
  if (segments.length === 0) segments.push("Everything is up to date");
  if (summary.malformedLinesSkipped > 0) {
    const lines = summary.malformedLinesSkipped;
    segments.push(`${plural(lines, "log line")} could not be read`);
  }
  const duplicates = summary.duplicateSessionsSkipped.length;
  if (duplicates > 0) segments.push(`${plural(duplicates, "duplicate log file")} ignored`);
  return segments.join(", ");
}

/**
 * The multi-line detail behind the duplicate-session count: which file was NOT
 * ingested, and which one took the session id instead.
 *
 * The one-line digest can only carry a count, but a count alone is not
 * actionable — the user needs the PATH of the stray file to delete it. Returns
 * null in the normal case (no duplicates) so the caller can skip rendering it.
 */
export function formatDuplicateSessionDetail(summary: RefreshSummary): string | null {
  if (summary.duplicateSessionsSkipped.length === 0) return null;
  return [
    "Two log files shared one session id; only one was ingested:",
    ...summary.duplicateSessionsSkipped.map((d) => `${d.sessionId}: skipped ${d.skippedPath} (kept ${d.keptPath})`),
  ].join("\n");
}
