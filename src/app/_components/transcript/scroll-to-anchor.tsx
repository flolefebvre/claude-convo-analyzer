"use client";

// Scrolls a deep link's target (`?msg=` / `?call=`) into view once it is on
// screen. The `#msg-…` / `#call-…` fragment alone never reaches a target below
// the fold: the transcript streams in inside a Suspense boundary AFTER the
// browser (hard load) or the router (client navigation) has already tried the
// fragment and found nothing. The fragment stays on the hrefs for copied links
// and no-JS; this leaf is the reliable path.
//
// ADR-0002: imports only React — no core.

import { useEffect } from "react";

/**
 * Scroll the element with `id` to the top of the viewport (instantly, under
 * the page's `scroll-padding-top`) when this renders; a no-op when no such
 * element is on the page — an unknown anchor, or a page that doesn't hold it.
 * Renders nothing.
 *
 * @example <ScrollToAnchor id={messageAnchorId(anchoredMessage)} />
 */
export function ScrollToAnchor({ id }: { id: string }) {
  useEffect(() => {
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [id]);
  return null;
}
