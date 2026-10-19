import { describe, expect, it } from "vitest";

import { isRerenderDue, refreshActivityOf, RERENDER_INTERVAL_MS } from "@/app/_lib/refresh-activity";

describe("refreshActivityOf", () => {
  it("is idle before any Refresh and after one settled", () => {
    expect(refreshActivityOf({ status: "idle" })).toEqual({ isRunning: false });
    expect(
      refreshActivityOf({ status: "failed", runId: "run-a", origin: "user", error: new Error("disk gone") }),
    ).toEqual({
      isRunning: false,
    });
  });

  it("is running with its run id and latest progress, or none before the total is known", () => {
    expect(refreshActivityOf({ status: "running", runId: "run-b", origin: "user", progress: null })).toEqual({
      isRunning: true,
      runId: "run-b",
      progress: null,
    });
    expect(
      refreshActivityOf({ status: "running", runId: "run-b", origin: "user", progress: { done: 50, total: 120 } }),
    ).toEqual({
      isRunning: true,
      runId: "run-b",
      progress: { done: 50, total: 120 },
    });
  });
});

describe("isRerenderDue", () => {
  const due = {
    nowMs: 20_000,
    lastRerenderAtMs: 20_000 - RERENDER_INTERVAL_MS,
    isTabVisible: true,
    isRerenderPending: false,
  };

  it("is due once the interval has passed since the last re-render, on a visible tab", () => {
    expect(isRerenderDue(due)).toBe(true);
  });

  it("is due on the first progress of a page that never re-rendered", () => {
    expect(isRerenderDue({ ...due, lastRerenderAtMs: null })).toBe(true);
  });

  it("is not due within the interval", () => {
    expect(isRerenderDue({ ...due, nowMs: due.nowMs - 1 })).toBe(false);
  });

  it("is not due on a hidden tab", () => {
    expect(isRerenderDue({ ...due, isTabVisible: false })).toBe(false);
  });

  it("is not due while the previous re-render is pending", () => {
    expect(isRerenderDue({ ...due, isRerenderPending: true })).toBe(false);
  });
});
