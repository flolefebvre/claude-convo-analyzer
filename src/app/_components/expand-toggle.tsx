// The chevron that opens and closes a table row's detail panel. Row expansion
// is URL view state (`?expanded=<id>`), so the toggle is a plain `<Link>` to the
// page's own href — shareable, reload-proof, and server-rendered — with
// `scroll={false}` so toggling a row deep in a table never jumps the viewport.
// The conversation list and the Tools table both hang their first cell on it.

import { ChevronRight } from "lucide-react";

import { PendingLink } from "@/app/_components/pending-link";

/**
 * The row's disclosure control: a 24px chevron button that turns down when
 * open, optionally followed by a label that is part of the same target.
 *
 * @example <ExpandToggle href={expandHref(row.id, expandedId, links)} expanded={false} label="conversation details" />
 */
export function ExpandToggle({
  href,
  expanded,
  // What the screen-reader label expands or collapses, e.g. "tool details".
  label,
  children,
}: {
  /** The toggled `?expanded=` target for this row. */
  href: string;
  expanded: boolean;
  label: string;
  /** Visible content after the chevron, inside the same link; omit for a chevron-only toggle. */
  children?: React.ReactNode;
}) {
  return (
    <PendingLink
      href={href}
      scroll={false}
      aria-expanded={expanded}
      className="group/expand inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-md text-left focus-inset"
    >
      <span className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors group-hover/expand:bg-muted group-hover/expand:text-foreground group-has-data-link-pending/expand:bg-muted group-aria-expanded/expand:text-foreground">
        <ChevronRight
          className="size-4 transition-transform duration-150 group-aria-expanded/expand:rotate-90"
          aria-hidden
        />
      </span>
      <span className="sr-only">
        {expanded ? "Collapse" : "Expand"} {label}
      </span>
      {children}
    </PendingLink>
  );
}
