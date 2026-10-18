// A Refresh run by the refresh runner in a real worker thread. The worker's
// `.ts` graph uses the `@/` aliases, which Node cannot resolve on its own, so it
// loads through tsx (`--import tsx`); the app's bundler needs no such flag.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RefreshProgress } from "@/core/refresh";
import { createRefreshRunner, createWorkerRefreshJob, spawnRefreshWorker } from "@/core/refresh-runner";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");
const TSX_EXEC_ARGV = ["--import", "tsx"];
const WORKER_TIMEOUT_MS = 30_000;

/** The production worker-backed job, with its worker loaded through tsx. */
function tsxWorkerRefreshJob() {
  return createWorkerRefreshJob({ spawnWorker: () => spawnRefreshWorker(TSX_EXEC_ARGV) });
}

/** Longest stretch, in ms, between two ticks of a 10 ms interval while `work` runs. */
async function longestTickGapDuring(work: () => Promise<unknown>): Promise<number> {
  let lastTickAt = performance.now();
  let longestTickGap = 0;
  const ticker = setInterval(() => {
    const tickAt = performance.now();
    longestTickGap = Math.max(longestTickGap, tickAt - lastTickAt);
    lastTickAt = tickAt;
  }, 10);
  try {
    await work();
  } finally {
    clearInterval(ticker);
  }
  return Math.max(longestTickGap, performance.now() - lastTickAt);
}

describe("refresh in a worker", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-worker-"));
    vi.stubEnv("CCA_LOGS_ROOT", FIXTURES_ROOT);
    vi.stubEnv("CCA_DB_PATH", path.join(tmpDir, "analyzer.db"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it(
    "keeps the main thread ticking while a cold Refresh runs, and resolves to its summary",
    async () => {
      const runner = createRefreshRunner(tsxWorkerRefreshJob());
      let summary;

      const longestTickGap = await longestTickGapDuring(async () => {
        summary = await runner.start();
      });

      expect(summary).toMatchObject({ conversationsParsed: 21, conversationsSkipped: 0 });
      expect(longestTickGap).toBeLessThanOrEqual(100);
    },
    WORKER_TIMEOUT_MS,
  );

  it(
    "relays every progress report of the Refresh, in order",
    async () => {
      const refreshInWorker = tsxWorkerRefreshJob();
      const progressReports: RefreshProgress[] = [];

      const summary = await refreshInWorker((progress) => progressReports.push(progress));

      const total = summary.conversationsParsed;
      expect(progressReports).toEqual(Array.from({ length: total + 1 }, (_, done) => ({ done, total })));
    },
    WORKER_TIMEOUT_MS,
  );

  it(
    "rejects the start with the error a Refresh throws in the worker",
    async () => {
      // A directory is no database: opening it throws inside the worker.
      vi.stubEnv("CCA_DB_PATH", tmpDir);
      const runner = createRefreshRunner(tsxWorkerRefreshJob());

      const failure = await runner.start().catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(Error);
      expect((failure as Error).cause).toBeInstanceOf(Error);
      expect((failure as Error).cause).toMatchObject({ message: expect.stringMatching(/open database/) });
      expect(runner.state().status).toBe("failed");
    },
    WORKER_TIMEOUT_MS,
  );

  it(
    "rejects the start with the exit code when the worker exits without a summary",
    async () => {
      const runner = createRefreshRunner(
        createWorkerRefreshJob({
          spawnWorker: () =>
            new Worker(new URL("./helpers/exit-without-summary.worker.ts", import.meta.url), {
              execArgv: TSX_EXEC_ARGV,
            }),
        }),
      );

      await expect(runner.start()).rejects.toThrow(/exit code 2/);
    },
    WORKER_TIMEOUT_MS,
  );
});
