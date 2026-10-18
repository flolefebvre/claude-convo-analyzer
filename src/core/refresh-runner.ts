// The refresh runner (ADR-0004): owns the one Refresh the server process runs at
// a time. A start while a Refresh runs joins it; the Refresh outlives the
// request that started it. The runner takes the job as a dependency, so its
// logic runs in-process under test, without a worker.

import type { RefreshProgress, RefreshSummary } from "@/core/refresh";

/** The work of one Refresh: reports progress as it goes, resolves to its summary. */
export type RefreshJob = (onProgress: (progress: RefreshProgress) => void) => Promise<RefreshSummary>;

/** Where the runner stands: no Refresh yet, one running, or the last one's outcome. */
export type RefreshRunState =
  | { status: "idle" }
  /** `progress` is null until the Refresh knows its total. */
  | { status: "running"; progress: RefreshProgress | null }
  | { status: "succeeded"; summary: RefreshSummary }
  | { status: "failed"; error: Error };

/** The handle onto the shared Refresh. */
export type RefreshRunner = {
  /** Start a Refresh, or join the one running; resolves to its summary. */
  start: () => Promise<RefreshSummary>;
  /** The current state, as of this call. */
  state: () => RefreshRunState;
};

/**
 * Build a runner that runs `job` at most once at a time. Overlapping starts share
 * one promise; a start after it settled runs `job` again; a failure rejects every
 * waiter and the next start runs fresh. There is no cancel.
 *
 * @example
 * const runner = createRefreshRunner((onProgress) => refresh({ onProgress }));
 * const summary = await runner.start();
 */
export function createRefreshRunner(job: RefreshJob): RefreshRunner {
  let runState: RefreshRunState = { status: "idle" };
  let runningRefresh: Promise<RefreshSummary> | null = null;

  function runRefresh(): Promise<RefreshSummary> {
    runState = { status: "running", progress: null };
    // The executor turns a job that throws synchronously into a rejection too.
    const jobSummary = new Promise<RefreshSummary>((resolve) =>
      resolve(
        job((progress) => {
          runState = { status: "running", progress };
        }),
      ),
    );
    return jobSummary.then(
      (summary) => {
        runState = { status: "succeeded", summary };
        runningRefresh = null;
        return summary;
      },
      (cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        runState = { status: "failed", error };
        runningRefresh = null;
        throw error;
      },
    );
  }

  return {
    start: () => (runningRefresh ??= runRefresh()),
    state: () => runState,
  };
}
