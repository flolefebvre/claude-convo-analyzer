"use client";

// The chrome every route shares — the app bar and whatever sits under it (the
// parser-update banner) — wrapped in one element whose rendered height is
// published as `--chrome-height` on <html>. Layout that must fit under the
// chrome (the transcript's sticky agent tree) reads that variable instead of
// hard-coding a height: the banner mounting and unmounting, text wrapping on a
// phone, or a new piece of chrome all resize this element.
//
// ADR-0002: imports only React — no core.

import { useEffect, useRef } from "react";

/**
 * The shared chrome (`children`), measured: its height stays in `--chrome-height`
 * on <html> while it renders.
 *
 * @example <MeasuredChrome><AppBar /></MeasuredChrome>
 */
export function MeasuredChrome({ children }: { children: React.ReactNode }) {
  const chromeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const chrome = chromeRef.current;
    if (!chrome) return;
    const rootStyle = document.documentElement.style;
    const observer = new ResizeObserver(([entry]) => {
      // The wrapper has no padding or border, so its content box is its full
      // height; `contentRect` is in every ResizeObserver, `borderBoxSize` is newer.
      rootStyle.setProperty("--chrome-height", `${entry.contentRect.height}px`);
    });
    observer.observe(chrome);
    return () => {
      observer.disconnect();
      rootStyle.removeProperty("--chrome-height");
    };
  }, []);

  return <div ref={chromeRef}>{children}</div>;
}
