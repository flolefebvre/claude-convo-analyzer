// Live: watching the logs and Recordings, it runs a Refresh when they change,
// through the shared refresh runner. Driven here by a fake watcher the test
// fires by hand and a job the test settles by hand, under fake timers.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLive, type LiveWatch } from "@/core/live";
import { createRefreshRunner } from "@/core/refresh-runner";
import { controlledJob } from "./helpers/controlled-job";
import { refreshSummaryOfRun } from "./helpers/refresh-summary";

const DEBOUNCE_MS = 2000;

/**
 * A watcher the test fires by hand. `timeline` records, in order, each
 * "watch", "change", "close" and each Refresh the job began ("refresh").
 * `onWatchStarted` runs as soon as watching started, before `watch` returns.
 */
function liveHarness({ onWatchStarted }: { onWatchStarted?: (fireChange: () => void) => void } = {}) {
  const timeline: string[] = [];
  let handlers: Parameters<LiveWatch>[0] | null = null;
  const fireChange = () => {
    timeline.push("change");
    handlers?.onChange();
  };
  const watch: LiveWatch = (watchHandlers) => {
    handlers = watchHandlers;
    timeline.push("watch");
    onWatchStarted?.(fireChange);
    return {
      close: () => {
        handlers = null;
        timeline.push("close");
      },
    };
  };
  const { job, runs } = controlledJob(() => timeline.push("refresh"));
  const runner = createRefreshRunner(job);
  const live = createLive({ runner, watch, debounceMs: DEBOUNCE_MS });
  return {
    live,
    runner,
    runs,
    timeline,
    fireChange,
    failWatcher: (error: Error) => handlers?.onError(error),
    isWatching: () => handlers !== null,
  };
}

/** Settle run `index` and let Live react to it. */
async function succeedRun(runs: ReturnType<typeof liveHarness>["runs"], index: number) {
  runs[index]?.succeed(refreshSummaryOfRun(index));
  await vi.advanceTimersByTimeAsync(0);
}

describe("Live", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("queues exactly one follow-up for a change during a Refresh", async () => {
    const { live, runs, fireChange } = liveHarness();
    live.turnOn();

    fireChange();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(runs).toHaveLength(1);

    await succeedRun(runs, 0);
    expect(runs).toHaveLength(2);
    await succeedRun(runs, 1);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(runs).toHaveLength(2);
  });

  it("still queues one follow-up for many changes during a Refresh", async () => {
    const { live, runs, fireChange } = liveHarness();
    live.turnOn();

    for (let change = 0; change < 5; change += 1) {
      fireChange();
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    }
    expect(runs).toHaveLength(1);

    await succeedRun(runs, 0);
    await succeedRun(runs, 1);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(runs).toHaveLength(2);
  });

  it("does not lose a change between starting to watch and starting the catch-up", async () => {
    const { live, runs, timeline } = liveHarness({ onWatchStarted: (fireChange) => fireChange() });

    live.turnOn();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await succeedRun(runs, 0);

    expect(timeline.slice(0, 2)).toEqual(["watch", "change"]);
    expect(timeline.indexOf("refresh")).toBeGreaterThan(timeline.indexOf("change"));
  });

  it("stops follow-ups once turned off", async () => {
    const { live, runs, fireChange, isWatching } = liveHarness();
    live.turnOn();
    fireChange();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    fireChange();

    live.turnOff();
    await succeedRun(runs, 0);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(runs).toHaveLength(1);
    expect(isWatching()).toBe(false);
    expect(live.isOn()).toBe(false);
  });

  it("drops a change still in its debounce window when turned off", async () => {
    const { live, runs, fireChange } = liveHarness();
    live.turnOn();
    await succeedRun(runs, 0);

    fireChange();
    live.turnOff();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    expect(runs).toHaveLength(1);
  });

  it("starts watching, then runs a catch-up Refresh begun by Live", () => {
    const { live, runner, timeline } = liveHarness();

    live.turnOn();

    expect(timeline).toEqual(["watch", "refresh"]);
    expect(runner.state()).toMatchObject({ status: "running", origin: "live" });
    expect(live.isOn()).toBe(true);
  });

  it("runs one Refresh for the changes of one debounce window, which a later change does not extend", async () => {
    const { live, runs, fireChange } = liveHarness();
    live.turnOn();
    await succeedRun(runs, 0);

    fireChange();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 500);
    fireChange();
    await vi.advanceTimersByTimeAsync(499);
    expect(runs).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toHaveLength(2);
  });

  it("runs the follow-up after a failed Refresh too", async () => {
    const { live, runs, fireChange } = liveHarness();
    live.turnOn();
    fireChange();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);

    runs[0]?.fail(new Error("disk gone"));
    await vi.advanceTimersByTimeAsync(0);

    expect(runs).toHaveLength(2);
  });

  it("queues a follow-up for a change during a Refresh the user began", async () => {
    const { live, runner, runs, fireChange } = liveHarness();
    live.turnOn();
    await succeedRun(runs, 0);
    void runner.start({ origin: "user" });

    fireChange();
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    expect(runs).toHaveLength(2);

    await succeedRun(runs, 1);
    expect(runs).toHaveLength(3);
    expect(runner.state()).toMatchObject({ status: "running", origin: "live" });
  });

  it("queues its catch-up behind a Refresh already running when turned on", async () => {
    const { live, runner, runs } = liveHarness();
    void runner.start({ origin: "user" });

    live.turnOn();
    expect(runs).toHaveLength(1);

    await succeedRun(runs, 0);
    expect(runs).toHaveLength(2);
  });

  it("watches once when turned on twice", () => {
    const { live, timeline } = liveHarness();

    live.turnOn();
    live.turnOn();

    expect(timeline.filter((event) => event === "watch")).toHaveLength(1);
  });

  it("turns off on a watcher error, logging it", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { live, runs, failWatcher, isWatching } = liveHarness();
    live.turnOn();

    failWatcher(new Error("ENOSPC: inotify watch limit reached"));
    await succeedRun(runs, 0);

    expect(live.isOn()).toBe(false);
    expect(isWatching()).toBe(false);
    expect(consoleError).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ message: expect.stringContaining("ENOSPC") }),
    );
    consoleError.mockRestore();
  });

  it("stays off, with no Refresh, when watching cannot start", () => {
    const { job, runs } = controlledJob();
    const live = createLive({
      runner: createRefreshRunner(job),
      watch: () => {
        throw new Error("EACCES");
      },
      debounceMs: DEBOUNCE_MS,
    });

    expect(() => live.turnOn()).toThrow("EACCES");
    expect(live.isOn()).toBe(false);
    expect(runs).toHaveLength(0);
  });
});
