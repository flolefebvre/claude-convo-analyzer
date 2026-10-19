// Live (GLOSSARY.md): while it is on, the logs root and the Recordings root are
// watched, and each change runs a Refresh through the shared refresh runner
// (ADR-0004). The watcher and the runner are dependencies, so the rules below
// run in-process under test; the production watcher is `watchLogsAndRecordings`.

import { existsSync, type FSWatcher, mkdirSync, watch as watchDirectory } from "node:fs";

import { defaultLogsRoot } from "@/core/discovery";
import { defaultRecordingsRoot } from "@/core/recording";
import type { RefreshRunner } from "@/core/refresh-runner";

/** What a watcher tells Live: something changed under a root, or the watcher broke. */
export type LiveWatchHandlers = {
  onChange: () => void;
  onError: (error: Error) => void;
};

/** A running watcher; `close` stops it. */
export type LiveWatcher = { close: () => void };

/** Start watching, reporting to `handlers`; throws when watching cannot start. */
export type LiveWatch = (handlers: LiveWatchHandlers) => LiveWatcher;

/** The switch onto Live. */
export type Live = {
  /** Start watching, then run a catch-up Refresh; nothing when already on. Throws when watching cannot start. */
  turnOn: () => void;
  /** Stop watching and drop any Refresh not begun yet; a Refresh already running finishes. */
  turnOff: () => void;
  /** Whether Live is watching now. */
  isOn: () => boolean;
};

/**
 * Build Live over `runner`, watching with `watch`. Each change opens a window
 * of `debounceMs` that later changes ride on without extending it, so a session
 * writing more often than that still gets a Refresh every `debounceMs`: a
 * trailing debounce, reset by each change, would never fire while it writes.
 * When the window closes during a Refresh, that run may already have read the
 * changed file, so exactly one more Refresh is queued for when it settles,
 * whoever began it and however it ends. A watcher error is logged and turns
 * Live off.
 *
 * @example
 * const live = createLive({ runner: getRefreshRunner(), watch: watchLogsAndRecordings(), debounceMs: 2000 });
 * live.turnOn();
 */
export function createLive({
  runner,
  watch,
  debounceMs,
}: {
  runner: RefreshRunner;
  watch: LiveWatch;
  debounceMs: number;
}): Live {
  let watcher: LiveWatcher | null = null;
  let stopFollowingRuns: (() => void) | null = null;
  let debounceWindow: ReturnType<typeof setTimeout> | null = null;
  let isFollowUpQueued = false;

  function startRefresh(): void {
    // Its outcome reaches every page through the runner's subscribers.
    runner.start({ origin: "live" }).catch(() => undefined);
  }

  function refreshOrQueueFollowUp(): void {
    if (runner.state().status === "running") isFollowUpQueued = true;
    else startRefresh();
  }

  function handleChange(): void {
    debounceWindow ??= setTimeout(() => {
      debounceWindow = null;
      refreshOrQueueFollowUp();
    }, debounceMs);
  }

  function handleWatchError(error: Error): void {
    console.error("Live stopped: its watcher failed", error);
    turnOff();
  }

  function turnOff(): void {
    watcher?.close();
    watcher = null;
    stopFollowingRuns?.();
    stopFollowingRuns = null;
    if (debounceWindow !== null) clearTimeout(debounceWindow);
    debounceWindow = null;
    isFollowUpQueued = false;
  }

  function turnOn(): void {
    if (watcher !== null) return;
    watcher = watch({ onChange: handleChange, onError: handleWatchError });
    stopFollowingRuns = runner.subscribe((state) => {
      if (state.status === "running" || !isFollowUpQueued) return;
      isFollowUpQueued = false;
      // Out of the runner's listener loop first: a start from inside it would
      // tell the subscribers after this one the new run before the settled one.
      queueMicrotask(() => {
        if (watcher !== null) startRefresh();
      });
    });
    refreshOrQueueFollowUp();
  }

  return { turnOn, turnOff, isOn: () => watcher !== null };
}

/**
 * The production watcher: `fs.watch`, recursive, over the logs root and the
 * Recordings root (by default `defaultLogsRoot()` and `defaultRecordingsRoot()`),
 * any event under either a change. The Recordings root is the app's own, so it
 * is created when missing, and a Recorder started later is still followed; a
 * missing logs root is skipped with a warning. An error of either watcher goes
 * to `onError`.
 *
 * @example
 * const watcher = watchLogsAndRecordings()({ onChange: () => console.log("changed"), onError: console.error });
 */
export function watchLogsAndRecordings({
  logsRoot = defaultLogsRoot(),
  recordingsRoot = defaultRecordingsRoot(),
}: { logsRoot?: string; recordingsRoot?: string } = {}): LiveWatch {
  return ({ onChange, onError }) => {
    mkdirSync(recordingsRoot, { recursive: true });
    const rootsToWatch = [recordingsRoot];
    if (existsSync(logsRoot)) rootsToWatch.push(logsRoot);
    else console.warn(`Live does not watch the logs root ${logsRoot}: it does not exist`);

    const directoryWatchers: FSWatcher[] = [];
    const closeAll = () => {
      for (const directoryWatcher of directoryWatchers) directoryWatcher.close();
    };
    try {
      for (const root of rootsToWatch) {
        const directoryWatcher = watchDirectory(root, { recursive: true }, () => onChange());
        directoryWatcher.on("error", onError);
        directoryWatchers.push(directoryWatcher);
      }
    } catch (error) {
      closeAll();
      throw error;
    }
    return { close: closeAll };
  };
}
