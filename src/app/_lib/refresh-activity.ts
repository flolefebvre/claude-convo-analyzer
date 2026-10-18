// What the Refresh control follows: whether a Refresh runs and how far it has
// got, and when the open page is due a re-render while it runs. Pure, so the
// server part that mints the Snapshot and the client button share it; core is
// reached by type only (ADR-0002).

import type { RefreshProgress } from "@/core/refresh";
import type { RefreshRunId, RefreshRunState } from "@/core/refresh-runner";

export type { RefreshRunId };

/** Whether a Refresh runs; while it does, its run id and latest progress, or null before the total is known. */
export type RefreshActivity =
  { isRunning: false } | { isRunning: true; runId: RefreshRunId; progress: RefreshProgress | null };

/**
 * The activity a runner state stands for: the last outcome is not carried, a
 * page opened after it shows the idle control.
 *
 * @example refreshActivityOf(runner.state()) // { isRunning: true, runId: "0b9f…", progress: { done: 50, total: 2450 } }
 */
export function refreshActivityOf(state: RefreshRunState): RefreshActivity {
  return state.status === "running"
    ? { isRunning: true, runId: state.runId, progress: state.progress }
    : { isRunning: false };
}

/** The shortest gap between two re-renders of the open page during a Refresh. */
export const RERENDER_INTERVAL_MS = 10_000;

/**
 * Whether the open page is due a `router.refresh()` on a progress event: the
 * interval has passed since the last one (or there was none), the tab is
 * visible, and the previous one has landed.
 *
 * @example isRerenderDue({ nowMs: Date.now(), lastRerenderAtMs: null, isTabVisible: true, isRerenderPending: false }) // true
 */
export function isRerenderDue({
  nowMs,
  lastRerenderAtMs,
  isTabVisible,
  isRerenderPending,
}: {
  nowMs: number;
  lastRerenderAtMs: number | null;
  isTabVisible: boolean;
  isRerenderPending: boolean;
}): boolean {
  if (!isTabVisible || isRerenderPending) return false;
  return lastRerenderAtMs === null || nowMs - lastRerenderAtMs >= RERENDER_INTERVAL_MS;
}
