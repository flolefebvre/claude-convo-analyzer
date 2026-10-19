// The refresh runner: at most one Refresh at a time, shared by every caller
// that starts one while it runs. Driven here by a fake job, in-process.

import { describe, expect, it } from "vitest";
import { createRefreshRunner, type RefreshRunState } from "@/core/refresh-runner";
import { controlledJob } from "./helpers/controlled-job";
import { refreshSummaryOfRun } from "./helpers/refresh-summary";

/** A runner over a {@link controlledJob}, with a subscriber recording every state it is told. */
function observedRunner() {
  const { job, runs } = controlledJob();
  const runner = createRefreshRunner(job);
  const states: RefreshRunState[] = [];
  const unsubscribe = runner.subscribe((state) => states.push(state));
  return { runner, runs, states, unsubscribe };
}

describe("refresh runner", () => {
  it("shares one Refresh between overlapping starts, both resolving to its summary", async () => {
    const { job, runs } = controlledJob();
    const runner = createRefreshRunner(job);

    const firstStart = runner.start();
    const secondStart = runner.start();
    runs[0]?.succeed(refreshSummaryOfRun(7));

    expect(runs).toHaveLength(1);
    await expect(firstStart).resolves.toEqual(refreshSummaryOfRun(7));
    await expect(secondStart).resolves.toEqual(refreshSummaryOfRun(7));
  });

  it("begins a new Refresh on a start after the previous one settled", async () => {
    const { job, runs } = controlledJob();
    const runner = createRefreshRunner(job);

    const firstStart = runner.start();
    runs[0]?.succeed(refreshSummaryOfRun(1));
    await firstStart;

    const secondStart = runner.start();
    runs[1]?.succeed(refreshSummaryOfRun(2));

    expect(runs).toHaveLength(2);
    await expect(secondStart).resolves.toEqual(refreshSummaryOfRun(2));
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
    runs[1]?.succeed(refreshSummaryOfRun(3));

    expect(runs).toHaveLength(2);
    await expect(retryStart).resolves.toEqual(refreshSummaryOfRun(3));
  });

  it("reads idle before any Refresh, then running with its latest progress", () => {
    const { job, runs } = controlledJob();
    const runner = createRefreshRunner(job);

    expect(runner.state()).toEqual({ status: "idle" });

    void runner.start();
    expect(runner.state()).toEqual({ status: "running", runId: expect.any(String), origin: "user", progress: null });

    runs[0]?.reportProgress({ done: 0, total: 3 });
    runs[0]?.reportProgress({ done: 1, total: 3 });
    expect(runner.state()).toEqual({
      status: "running",
      runId: expect.any(String),
      origin: "user",
      progress: { done: 1, total: 3 },
    });
  });

  it("reads the summary once the Refresh succeeded", async () => {
    const { job, runs } = controlledJob();
    const runner = createRefreshRunner(job);

    const start = runner.start();
    runs[0]?.succeed(refreshSummaryOfRun(4));
    await start;

    expect(runner.state()).toEqual({
      status: "succeeded",
      runId: expect.any(String),
      origin: "user",
      summary: refreshSummaryOfRun(4),
    });
  });

  it("reads the error once the Refresh failed", async () => {
    const { job, runs } = controlledJob();
    const runner = createRefreshRunner(job);

    const start = runner.start();
    const error = new Error("disk gone");
    runs[0]?.fail(error);
    await expect(start).rejects.toThrow();

    expect(runner.state()).toEqual({ status: "failed", runId: expect.any(String), origin: "user", error });
  });

  it("tells a subscriber each state it moves to: running, each progress, then the summary", async () => {
    const { runner, runs, states } = observedRunner();

    const start = runner.start();
    runs[0]?.reportProgress({ done: 0, total: 2 });
    runs[0]?.reportProgress({ done: 2, total: 2 });
    runs[0]?.succeed(refreshSummaryOfRun(2));
    await start;

    expect(states).toEqual([
      { status: "running", runId: expect.any(String), origin: "user", progress: null },
      { status: "running", runId: expect.any(String), origin: "user", progress: { done: 0, total: 2 } },
      { status: "running", runId: expect.any(String), origin: "user", progress: { done: 2, total: 2 } },
      { status: "succeeded", runId: expect.any(String), origin: "user", summary: refreshSummaryOfRun(2) },
    ]);
  });

  it("tells a subscriber the failure, and nothing for a start that joins the running Refresh", async () => {
    const { runner, runs, states } = observedRunner();

    const start = runner.start();
    const joined = runner.start();
    const error = new Error("disk gone");
    runs[0]?.fail(error);
    await expect(start).rejects.toThrow();
    await expect(joined).rejects.toThrow();

    expect(states).toEqual([
      { status: "running", runId: expect.any(String), origin: "user", progress: null },
      { status: "failed", runId: expect.any(String), origin: "user", error },
    ]);
  });

  it("stops telling a subscriber once it unsubscribed", async () => {
    const { runner, runs, states, unsubscribe } = observedRunner();

    const start = runner.start();
    unsubscribe();
    runs[0]?.succeed(refreshSummaryOfRun(1));
    await start;

    expect(states).toEqual([{ status: "running", runId: expect.any(String), origin: "user", progress: null }]);
  });

  it("carries the origin of the start that began the Refresh, kept when a start of another origin joins it", async () => {
    const { runner, runs, states } = observedRunner();

    const liveStart = runner.start({ origin: "live" });
    void runner.start({ origin: "user" });
    runs[0]?.reportProgress({ done: 0, total: 1 });
    runs[0]?.succeed(refreshSummaryOfRun(1));
    await liveStart;
    const userStart = runner.start();
    runs[1]?.fail(new Error("disk gone"));
    await expect(userStart).rejects.toThrow();

    expect(states.map((state) => ("origin" in state ? state.origin : null))).toEqual([
      "live",
      "live",
      "live",
      "user",
      "user",
    ]);
  });

  it("gives each Refresh its own run id, the same across its states and shared by a joining start", async () => {
    const runIdsOf = (states: RefreshRunState[]) => states.map((state) => ("runId" in state ? state.runId : null));
    const { runner, runs, states } = observedRunner();

    const firstStart = runner.start();
    void runner.start();
    runs[0]?.succeed(refreshSummaryOfRun(1));
    await firstStart;
    const secondStart = runner.start();
    runs[1]?.reportProgress({ done: 0, total: 1 });
    runs[1]?.succeed(refreshSummaryOfRun(2));
    await secondStart;

    const [firstRunId, , secondRunId] = runIdsOf(states);
    expect(runIdsOf(states)).toEqual([firstRunId, firstRunId, secondRunId, secondRunId, secondRunId]);
    expect(firstRunId).toEqual(expect.any(String));
    expect(secondRunId).not.toBe(firstRunId);
  });
});
