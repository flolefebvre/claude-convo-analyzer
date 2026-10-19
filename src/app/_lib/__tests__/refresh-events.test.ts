// The bridge from the refresh runner to the `refresh` Channel: each committed
// batch publishes one `progress`, then the run publishes exactly one `finished`
// or `failed`. Driven by `createRefreshRunner` with an in-process job.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { recordPublishes } from "@flefebvre/next-sse/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishRefreshEvents, startOrJoinRefresh } from "@/app/_lib/refresh-events";
import { refresh, type RefreshProgress, type RefreshSummary } from "@/core/refresh";
import { refreshSummaryOfRun } from "@/core/__tests__/helpers/refresh-summary";
import { createRefreshRunner } from "@/core/refresh-runner";

// A `REDIS_URL` in the environment must not move the app off its Memory
// Transport: under Redis detection, these publishes would go to an unreachable
// server and never be recorded.
vi.hoisted(() => {
  process.env.REDIS_URL = "redis://127.0.0.1:1";
});

const FIXTURES_ROOT = path.join(import.meta.dirname, "..", "..", "..", "core", "__tests__", "fixtures", "logs");

describe("refresh events", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-refresh-events-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("publishes one progress per committed batch, then the run's summary once", async () => {
    const progressReports: RefreshProgress[] = [];
    const runner = createRefreshRunner((onProgress) =>
      refresh({
        logsRoot: FIXTURES_ROOT,
        dbPath: path.join(tmpDir, "analyzer.db"),
        onProgress: (progress) => {
          progressReports.push(progress);
          onProgress(progress);
        },
      }),
    );
    publishRefreshEvents(runner);
    const published = await recordPublishes();

    const summary = await runner.start();

    expect(progressReports.length).toBeGreaterThanOrEqual(2);
    await vi.waitFor(async () =>
      expect(await published()).toEqual([
        ...progressReports.map((progress) => ({
          channel: "refresh",
          event: "progress",
          payload: { runId: expect.any(String), ...progress },
        })),
        { channel: "refresh", event: "finished", payload: { runId: expect.any(String), origin: "user", summary } },
      ]),
    );
  });

  it("publishes the failure once, with its cause, after the progress before it", async () => {
    const runner = createRefreshRunner(async (onProgress) => {
      onProgress({ done: 0, total: 3 });
      throw new Error("Refresh failed in its worker", { cause: new Error("disk gone") });
    });
    publishRefreshEvents(runner);
    const published = await recordPublishes();

    await expect(runner.start()).rejects.toThrow();

    await vi.waitFor(async () =>
      expect(await published()).toEqual([
        { channel: "refresh", event: "progress", payload: { runId: expect.any(String), done: 0, total: 3 } },
        {
          channel: "refresh",
          event: "failed",
          payload: { runId: expect.any(String), origin: "user", message: "Refresh failed in its worker: disk gone" },
        },
      ]),
    );
  });

  it("starts a Refresh when none runs, and joins the running one without a second run", async () => {
    let runCount = 0;
    let finishRun: (summary: RefreshSummary) => void = () => undefined;
    const runner = createRefreshRunner(() => {
      runCount += 1;
      return new Promise((resolve) => (finishRun = resolve));
    });
    publishRefreshEvents(runner);
    const published = await recordPublishes();

    expect(startOrJoinRefresh(runner)).toBe("started");
    expect(startOrJoinRefresh(runner)).toBe("already running");
    finishRun(SUMMARY);
    await vi.waitFor(async () => expect(await published()).toHaveLength(1));

    expect(runCount).toBe(1);
    expect(await published()).toEqual([
      {
        channel: "refresh",
        event: "finished",
        payload: { runId: expect.any(String), origin: "user", summary: SUMMARY },
      },
    ]);
  });

  it("carries one run id on all of a run's events, and another on the next run's", async () => {
    const runner = createRefreshRunner(async (onProgress) => {
      onProgress({ done: 1, total: 1 });
      return SUMMARY;
    });
    publishRefreshEvents(runner);
    const published = await recordPublishes();

    await runner.start();
    await runner.start();

    await vi.waitFor(async () => expect(await published()).toHaveLength(4));
    const messages = await published();
    const runIds = messages.map((message) => (message.payload as { runId: unknown }).runId);
    const [firstRunId, , secondRunId] = runIds;
    expect(firstRunId).toEqual(expect.any(String));
    expect(secondRunId).not.toBe(firstRunId);
    expect(messages).toEqual([
      { channel: "refresh", event: "progress", payload: { runId: firstRunId, done: 1, total: 1 } },
      { channel: "refresh", event: "finished", payload: { runId: firstRunId, origin: "user", summary: SUMMARY } },
      { channel: "refresh", event: "progress", payload: { runId: secondRunId, done: 1, total: 1 } },
      { channel: "refresh", event: "finished", payload: { runId: secondRunId, origin: "user", summary: SUMMARY } },
    ]);
  });

  it("publishes the origin of a Refresh Live began on its outcome", async () => {
    const runner = createRefreshRunner(async () => SUMMARY);
    publishRefreshEvents(runner);
    const published = await recordPublishes();

    await runner.start({ origin: "live" });

    await vi.waitFor(async () =>
      expect(await published()).toEqual([
        {
          channel: "refresh",
          event: "finished",
          payload: { runId: expect.any(String), origin: "live", summary: SUMMARY },
        },
      ]),
    );
  });

  it("stops publishing once unsubscribed", async () => {
    const runner = createRefreshRunner(async () => SUMMARY);
    const unsubscribe = publishRefreshEvents(runner);
    const published = await recordPublishes();

    unsubscribe();
    await runner.start();
    // A publish lands within a few microtasks; a macrotask is past all of them.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await published()).toEqual([]);
  });
});

const SUMMARY = refreshSummaryOfRun(1);
