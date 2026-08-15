import type { RefreshSummary } from "@/core/refresh";

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

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
  const duplicates = summary.duplicateSessionsSkipped.length;
  if (duplicates > 0) {
    const noun = duplicates === 1 ? "file" : "files";
    segments.push(`${duplicates} duplicate session ${noun} skipped`);
  }
  segments.push(formatDuration(summary.durationMs));
  return segments.join(" · ");
}

export function formatDuplicateSessionDetail(summary: RefreshSummary): string | null {
  if (summary.duplicateSessionsSkipped.length === 0) return null;
  return [
    "Two log files shared one session id; only one was ingested:",
    ...summary.duplicateSessionsSkipped.map((d) => `${d.sessionId}: skipped ${d.skippedPath} (kept ${d.keptPath})`),
  ].join("\n");
}
