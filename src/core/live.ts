// Live (GLOSSARY.md): while it is on, the logs root is watched, and each
// change runs a Refresh through the shared refresh runner (ADR-0004). The
// watcher and the runner are dependencies, so the rules below run in-process
// under test; the production watcher is `watchLogs`.

import { existsSync, watch as watchDirectory } from "node:fs";

import { defaultLogsRoot } from "@/core/discovery";
import type { RefreshRunner } from "@/core/refresh-runner";

/** How long after its newest source change a Conversation stays active now (GLOSSARY.md, Active now). */
export const ACTIVE_WINDOW_MS = 2 * 60_000;

/**
 * Whether a Conversation whose newest source change was at `sourceChangedAt`
 * (ISO) is active now at `now`: the change is under {@link ACTIVE_WINDOW_MS}
 * old. Only meaningful while Live is on; the caller checks that.
 *
 * @example isActiveNow(row.sourceChangedAt, new Date()) && getLive().isOn()
 */
export function isActiveNow(sourceChangedAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(sourceChangedAt) < ACTIVE_WINDOW_MS;
}

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
 * const live = createLive({ runner: getRefreshRunner(), watch: watchLogs(), debounceMs: 2000 });
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
 * The production watcher: `fs.watch`, recursive, over the logs root (by
 * default `defaultLogsRoot()`), any event under it a change. A missing logs
 * root is skipped with a warning, and nothing is watched. An error of the
 * watcher goes to `onError`.
 *
 * @example
 * const watcher = watchLogs()({ onChange: () => console.log("changed"), onError: console.error });
 */
export function watchLogs({ logsRoot = defaultLogsRoot() }: { logsRoot?: string } = {}): LiveWatch {
  return ({ onChange, onError }) => {
    // Turbopack cannot resolve this runtime path, so it would trace the whole project into the build. The path
    // lies outside the project by design, so no scoping or include can describe it, and this local-only app never
    // deploys the trace: the per-call opt-out is the accurate answer. It is the same opt-out as the env-root
    // readers in discovery.ts, db.ts and settings.ts.
    if (!existsSync(/*turbopackIgnore: true*/ logsRoot)) {
      console.warn(`Live does not watch the logs root ${logsRoot}: it does not exist`);
      return { close: () => {} };
    }
    const directoryWatcher = watchDirectory(logsRoot, { recursive: true }, () => onChange());
    directoryWatcher.on("error", onError);
    return { close: () => directoryWatcher.close() };
  };
}
