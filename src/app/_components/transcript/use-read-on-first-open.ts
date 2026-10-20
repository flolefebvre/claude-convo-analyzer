"use client";

// The lazy read behind a transcript disclosure (a Tool call's body, what a
// recorded Turn sent, its Raw view): nothing is fetched until the reader first
// opens the `<details>` or the tab, and what came back is kept for every later
// open.

import { useState } from "react";

/** Where a disclosure's read stands: not asked for, on its way, shown, or not loadable. */
export type ReadOnFirstOpenState<Value> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "loaded"; value: Value }
  /** The row is gone: the transcript was re-parsed since the page rendered (the route answered 404). */
  | { status: "stale" }
  /** Any other failure; the next open tries again. */
  | { status: "failed" };

/**
 * The state of `read` and what starts it on the first open: `onToggle` and
 * `detailsRef` for a `<details>` (the ref catches one opened before
 * hydration, its one `toggle` fired with no listener attached), or
 * `startReading` for any other opening, such as a tab's first activation.
 * `preloaded` starts it loaded, never fetching.
 *
 * @example const { state, onToggle, detailsRef } = useReadOnFirstOpen(() => callRoute(routes.api["tool-call"](id).GET()));
 */
export function useReadOnFirstOpen<Value>(
  read: () => Promise<{ status: number; json: unknown }>,
  preloaded?: Value,
): {
  state: ReadOnFirstOpenState<Value>;
  /** Start the read, unless it is on its way, done, or stale. */
  startReading: () => void;
  onToggle: (event: React.ToggleEvent<HTMLDetailsElement>) => void;
  detailsRef: (details: HTMLDetailsElement | null) => void;
} {
  const [state, setState] = useState<ReadOnFirstOpenState<Value>>(
    preloaded === undefined ? { status: "idle" } : { status: "loaded", value: preloaded },
  );

  async function load() {
    setState({ status: "loading" });
    try {
      const res = await read();
      if (res.status === 200) setState({ status: "loaded", value: res.json as Value });
      else setState({ status: res.status === 404 ? "stale" : "failed" });
    } catch {
      setState({ status: "failed" });
    }
  }

  function startReading() {
    if (state.status === "idle" || state.status === "failed") void load();
  }

  return {
    state,
    startReading,
    onToggle(event) {
      if (event.currentTarget.open) startReading();
    },
    detailsRef(details) {
      if (details?.open && state.status === "idle") void load();
    },
  };
}
