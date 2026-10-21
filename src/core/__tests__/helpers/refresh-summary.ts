// A hand-built `RefreshSummary`, for tests that drive the refresh runner with a
// fake job rather than a real `refresh()`.
//
// Not a test file: it declares no tests and lives under `__tests__/helpers/`,
// which vitest's `include` excludes (see `vitest.config.ts`).

import type { RefreshSummary } from "@/core/refresh";

/**
 * A summary whose `conversationsParsed` tells runs apart; every other count is 0.
 *
 * @example
 * runs[0]?.succeed(refreshSummaryOfRun(7));
 */
export function refreshSummaryOfRun(conversationsParsed: number): RefreshSummary {
  return {
    conversationsParsed,
    conversationsSkipped: 0,
    conversationsDeleted: 0,
    malformedLinesSkipped: 0,
    duplicateSessionsSkipped: [],
    vanishedLogFilesSkipped: 0,
    durationMs: 1,
    durationMsByPhase: { discovery: 0, parse: 0, write: 1, links: 0, stamp: 0 },
  };
}
