// A Refresh job the test settles by hand, for driving the refresh runner (and
// Live over it) in-process, without a worker.
//
// Not a test file: it declares no tests and lives under `__tests__/helpers/`,
// which vitest's `include` excludes (see `vitest.config.ts`).

import type { RefreshProgress, RefreshSummary } from "@/core/refresh";
import type { RefreshJob } from "@/core/refresh-runner";

/** One run the job was asked for, settled by the test. */
export type ControlledRun = {
  reportProgress: (progress: RefreshProgress) => void;
  succeed: (summary: RefreshSummary) => void;
  fail: (error: Error) => void;
};

/**
 * A job recording each run it is asked for in `runs`, each left pending until
 * the test settles it; `onRun` is told as each one begins.
 *
 * @example
 * const { job, runs } = controlledJob();
 * runs[0]?.succeed(refreshSummaryOfRun(7));
 */
export function controlledJob(onRun?: () => void): { job: RefreshJob; runs: ControlledRun[] } {
  const runs: ControlledRun[] = [];
  const job: RefreshJob = (onProgress) =>
    new Promise<RefreshSummary>((resolve, reject) => {
      onRun?.();
      runs.push({ reportProgress: onProgress, succeed: resolve, fail: reject });
    });
  return { job, runs };
}
