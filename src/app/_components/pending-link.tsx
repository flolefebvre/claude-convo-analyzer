"use client";

// A `<Link>` that reports its own pending navigation to CSS. Every shell
// interaction (section tabs, folder entries, sort headers, the pager, range
// presets, row expansion) is a server round trip that keeps the old screen up
// until the new one lands; without feedback a click reads as ignored.
//
// `useLinkStatus` only works in a descendant of the `<Link>`, so a hidden,
// zero-size marker rides inside it and carries `data-link-pending` while the
// navigation is in flight. Styling keys off the marker with `:has()` — never a
// change of size — so the feedback cannot shift layout:
//   - globals.css dims the page's `#main` after a short delay (a fast
//     navigation shows nothing);
//   - a link can light up its own optimistic state with the
//     `has-data-link-pending:` variant (e.g. the clicked tab's underline).
//
// ADR-0002: imports only `next/link` and React — no core.

import Link, { useLinkStatus } from "next/link";

/** The in-flight marker; must render inside the `<Link>`. */
function PendingMarker() {
  const { pending } = useLinkStatus();
  return <span hidden data-link-pending={pending ? "" : undefined} />;
}

/**
 * `next/link` plus pending feedback: the page content dims while this link's
 * navigation is in flight. Takes every `<Link>` prop; pass `scroll={false}` for
 * links that only change in-page view state.
 *
 * @example <PendingLink href={sortHref("cost", links)} scroll={false}>Cost</PendingLink>
 */
export function PendingLink({ children, ...props }: React.ComponentProps<typeof Link>) {
  return (
    <Link {...props}>
      {children}
      <PendingMarker />
    </Link>
  );
}
