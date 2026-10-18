// The refresh runner (ADR-0004): owns the one Refresh the server process runs at
// a time. A start while a Refresh runs joins it; the Refresh outlives the
// request that started it. The runner takes the job as a dependency, so its
// logic runs in-process under test, without a worker; the process-wide runner
// runs each Refresh in a worker thread, off the main thread.

import { Worker } from "node:worker_threads";

import type { RefreshProgress, RefreshSummary } from "@/core/refresh";

/**
 * What `refresh.worker.ts` posts: each progress report, then the summary or the
 * failure. A failure travels as its message and stack because an error thrown
 * in the worker reaches the main thread without them (a better-sqlite3
 * `SqliteError` arrives as a bare `{ code }`).
 */
export type RefreshWorkerMessage =
  | { type: "progress"; progress: RefreshProgress }
  | { type: "summary"; summary: RefreshSummary }
  | { type: "failure"; message: string; stack: string | undefined };

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

/**
 * Spawn the worker a Refresh runs in (`refresh.worker.ts`). `execArgv` holds
 * Node flags for it, e.g. `["--import", "tsx"]` to load its `.ts` graph outside
 * the bundler.
 *
 * @example
 * const worker = spawnRefreshWorker(["--import", "tsx"]);
 */
export function spawnRefreshWorker(execArgv?: string[]): Worker {
  // Keep this the only `new Worker`, on a literal URL: Turbopack bundles that
  // pattern as a worker entry, but traces a Worker on a computed URL to every
  // file in the project (a 500 on every page under `next dev`).
  return new Worker(new URL("./refresh.worker.ts", import.meta.url), { execArgv });
}

/** How a worker-backed job spawns its worker; the default is production's. */
type WorkerRefreshJobOptions = {
  /** Starts the worker for one Refresh; defaults to {@link spawnRefreshWorker}. */
  spawnWorker?: () => Worker;
};

/**
 * A job that runs each Refresh in a fresh worker thread, which opens its own
 * database connection and reads a copy of `process.env` (`CCA_DB_PATH`,
 * `CCA_LOGS_ROOT`). It relays the worker's progress and resolves to its summary;
 * the worker then exits on its own. A failed Refresh rejects with an `Error`
 * whose `cause` is the worker's error, message and stack included; a worker
 * error or an exit before the outcome (out of memory lands here) rejects too.
 *
 * @example
 * const runner = createRefreshRunner(createWorkerRefreshJob());
 */
export function createWorkerRefreshJob({
  spawnWorker = () => spawnRefreshWorker(),
}: WorkerRefreshJobOptions = {}): RefreshJob {
  return (onProgress) =>
    new Promise((resolve, reject) => {
      const worker = spawnWorker();
      let hasPostedOutcome = false;

      worker.on("message", (message: RefreshWorkerMessage) => {
        if (message.type === "progress") {
          onProgress(message.progress);
          return;
        }
        hasPostedOutcome = true;
        if (message.type === "summary") {
          resolve(message.summary);
          return;
        }
        const cause = Object.assign(new Error(message.message), { stack: message.stack });
        reject(new Error("Refresh failed in its worker", { cause }));
      });
      worker.on("error", (cause) => reject(new Error("Refresh worker crashed", { cause })));
      worker.on("exit", (exitCode) => {
        if (hasPostedOutcome) return;
        reject(new Error(`Refresh worker stopped with exit code ${exitCode} before its summary`));
      });
    });
}

const refreshRunnerSlot = Symbol.for("claude-convo-analyzer.refreshRunner");

const globalForRefreshRunner = globalThis as unknown as { [refreshRunnerSlot]?: RefreshRunner };

/**
 * The process-wide refresh runner, running each Refresh in a worker thread.
 * Created on first call and kept on `globalThis`, so a dev re-evaluation of this
 * module joins the running Refresh instead of starting a second one.
 *
 * @example
 * const summary = await getRefreshRunner().start();
 */
export function getRefreshRunner(): RefreshRunner {
  globalForRefreshRunner[refreshRunnerSlot] ??= createRefreshRunner(createWorkerRefreshJob());
  return globalForRefreshRunner[refreshRunnerSlot];
}
