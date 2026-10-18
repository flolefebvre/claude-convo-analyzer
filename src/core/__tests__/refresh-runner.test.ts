// The refresh runner: at most one Refresh at a time, shared by every caller
// that starts one while it runs. Driven here by a fake job, in-process.

import { describe, expect, it } from "vitest";
import type { RefreshProgress, RefreshSummary } from "@/core/refresh";
import { createRefreshRunner } from "@/core/refresh-runner";

/** A summary whose `conversationsParsed` tells runs apart. */
function summaryOfRun(conversationsParsed: number): RefreshSummary {
  return {
    conversationsParsed,
    conversationsSkipped: 0,
    conversationsDeleted: 0,
    malformedLinesSkipped: 0,
    duplicateSessionsSkipped: [],
    durationMs: 1,
  };
}

/** A job the test settles by hand, recording each run it is asked for. */
function controlledJob() {
  const runs: {
    reportProgress: (progress: RefreshProgress) => void;
    succeed: (summary: RefreshSummary) => void;
    fail: (error: Error) => void;
  }[] = [];
  const job = (onProgress: (progress: RefreshProgress) => void) =>
    new Promise<RefreshSummary>((resolve, reject) => {
      runs.push({ reportProgress: onProgress, succeed: resolve, fail: reject });
    });
  return { job, runs };
}

describe("refresh runner", () => {
  it("shares one Refresh between overlapping starts, both resolving to its summary", async () => {
    const { job, runs } = controlledJob();
    const runner = createRefreshRunner(job);

    const firstStart = runner.start();
    const secondStart = runner.start();
    runs[0]?.succeed(summaryOfRun(7));

    expect(runs).toHaveLength(1);
    await expect(firstStart).resolves.toEqual(summaryOfRun(7));
    await expect(secondStart).resolves.toEqual(summaryOfRun(7));
  });

  it("begins a new Refresh on a start after the previous one settled", async () => {
    const { job, runs } = controlledJob();
    const runner = createRefreshRunner(job);

    const firstStart = runner.start();
    runs[0]?.succeed(summaryOfRun(1));
    await firstStart;

    const secondStart = runner.start();
    runs[1]?.succeed(summaryOfRun(2));

    expect(runs).toHaveLength(2);
    await expect(secondStart).resolves.toEqual(summaryOfRun(2));
  });

  it("rejects every waiting start when the Refresh fails, and runs fresh on the next start", async () => {
    const { job, runs } = controlledJob();
    const runner = createRefreshRunner(job);

    const firstStart = runner.start();
    const secondStart = runner.start();
    runs[0]?.fail(new Error("disk gone"));

    await expect(firstStart).rejects.toThrow("disk gone");
    await expect(secondStart).rejects.toThrow("disk gone");

    const retryStart = runner.start();
    runs[1]?.succeed(summaryOfRun(3));

    expect(runs).toHaveLength(2);
    await expect(retryStart).resolves.toEqual(summaryOfRun(3));
  });

  it("reads idle before any Refresh, then running with its latest progress", () => {
    const { job, runs } = controlledJob();
    const runner = createRefreshRunner(job);

    expect(runner.state()).toEqual({ status: "idle" });

    void runner.start();
    expect(runner.state()).toEqual({ status: "running", progress: null });

    runs[0]?.reportProgress({ done: 0, total: 3 });
    runs[0]?.reportProgress({ done: 1, total: 3 });
    expect(runner.state()).toEqual({ status: "running", progress: { done: 1, total: 3 } });
  });

  it("reads the summary once the Refresh succeeded", async () => {
    const { job, runs } = controlledJob();
    const runner = createRefreshRunner(job);

    const start = runner.start();
    runs[0]?.succeed(summaryOfRun(4));
    await start;

    expect(runner.state()).toEqual({ status: "succeeded", summary: summaryOfRun(4) });
  });

  it("reads the error once the Refresh failed", async () => {
    const { job, runs } = controlledJob();
    const runner = createRefreshRunner(job);

    const start = runner.start();
    const error = new Error("disk gone");
    runs[0]?.fail(error);
    await expect(start).rejects.toThrow();

    expect(runner.state()).toEqual({ status: "failed", error });
  });
});
