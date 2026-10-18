// The bridge from the refresh runner (core, framework-free, ADR-0002) to the
// `refresh` Channel: it subscribes to the runner's states and publishes them.
// App code reaches the process-wide runner only through
// `getPublishedRefreshRunner()`, so the bridge is attached before anything can
// start a Refresh or read its state.

import type { Snapshot } from "@flefebvre/next-sse/client";

import { refreshActivityOf, type RefreshActivity } from "@/app/_lib/refresh-activity";
import { sse } from "@/app/_lib/sse";
import { getRefreshRunner, type RefreshRunner, type RefreshRunState } from "@/core/refresh-runner";

/** What a click on Refresh did: began a Refresh, or joined the one running. */
export type RefreshStart = "started" | "already running";

/** The runner's error in one line, with its cause's message when it has one. */
function describeRefreshFailure(error: Error): string {
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message;
}

/** Publish the event `state` stands for, if any: a running state without a total has none. */
function publishRefreshState(state: RefreshRunState): Promise<unknown> | null {
  const refreshChannel = sse.refresh();
  switch (state.status) {
    case "idle":
      return null;
    case "running":
      return state.progress === null ? null : refreshChannel.progress(state.progress);
    case "succeeded":
      return refreshChannel.finished({ summary: state.summary });
    case "failed":
      return refreshChannel.failed({ message: describeRefreshFailure(state.error) });
  }
}

/**
 * Publish `runner`'s Refresh on the `refresh` Channel: one `progress` per
 * committed batch, then one `finished` or `failed`. Returns the unsubscribe.
 *
 * @example const stopPublishing = publishRefreshEvents(createRefreshRunner(job));
 */
export function publishRefreshEvents(runner: RefreshRunner): () => void {
  return runner.subscribe((state) => {
    // A lost event costs a stale count until the next one (counts are absolute)
    // and never the Refresh itself.
    publishRefreshState(state)?.catch((error: unknown) => console.error("Refresh event not published", error));
  });
}

/**
 * Start a Refresh on `runner`, or join the one running, without waiting for it:
 * its outcome arrives on the `refresh` Channel.
 *
 * @example const refreshStart = startOrJoinRefresh(getPublishedRefreshRunner()); // "started"
 */
export function startOrJoinRefresh(runner: RefreshRunner): RefreshStart {
  const refreshStart: RefreshStart = runner.state().status === "running" ? "already running" : "started";
  // A failure reaches every page as `failed`; nothing waits on this promise.
  runner.start().catch(() => undefined);
  return refreshStart;
}

const refreshEventsSlot = Symbol.for("claude-convo-analyzer.refreshEvents");

const globalForRefreshEvents = globalThis as unknown as { [refreshEventsSlot]?: () => void };

/**
 * The process-wide Refresh's activity as of now, sealed with the `refresh`
 * Channel's position taken just before, so the control that spends it misses
 * no event. Request-time state: call it after `connection()`.
 *
 * @example const snapshot = await snapshotRefreshActivity();
 */
export function snapshotRefreshActivity(): Promise<Snapshot<RefreshActivity>> {
  return sse.snapshot(() => refreshActivityOf(getPublishedRefreshRunner().state()));
}

/**
 * The process-wide refresh runner, publishing on the `refresh` Channel. The
 * bridge is attached on the first call and kept on `globalThis`, so a dev
 * re-evaluation of this module does not publish every event twice.
 *
 * @example const refreshStart = startOrJoinRefresh(getPublishedRefreshRunner());
 */
export function getPublishedRefreshRunner(): RefreshRunner {
  const runner = getRefreshRunner();
  globalForRefreshEvents[refreshEventsSlot] ??= publishRefreshEvents(runner);
  return runner;
}
