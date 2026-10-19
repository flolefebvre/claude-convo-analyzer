"use client";

// The lazy read behind a transcript disclosure (a Tool call's body, what a
// recorded Turn sent): nothing is fetched until the reader first opens the
// `<details>`, and what came back is kept for every later open.

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
 * The state of `read` and the two `<details>` hooks that start it on the first
 * open: `onToggle`, and `detailsRef` for a disclosure opened before hydration
 * (its one `toggle` fired with no listener attached). `preloaded` starts it
 * loaded, never fetching.
 *
 * @example const { state, onToggle, detailsRef } = useReadOnFirstOpen(() => callRoute(routes.api["tool-call"](id).GET()));
 */
export function useReadOnFirstOpen<Value>(
  read: () => Promise<{ status: number; json: unknown }>,
  preloaded?: Value,
): {
  state: ReadOnFirstOpenState<Value>;
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

  return {
    state,
    onToggle(event) {
      if (event.currentTarget.open && (state.status === "idle" || state.status === "failed")) void load();
    },
    detailsRef(details) {
      if (details?.open && state.status === "idle") void load();
    },
  };
}
