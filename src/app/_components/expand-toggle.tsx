// The chevron that opens and closes a table row's detail panel. Row expansion
// is URL view state (`?expanded=<id>`), so the toggle is a plain `<Link>` to the
// page's own href — shareable, reload-proof, and server-rendered — with
// `scroll={false}` so toggling a row deep in a table never jumps the viewport.
// The conversation list and the Tools table both hang their first cell on it.

import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";

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
  /** The cell's visible content, rendered inside the link after the chevron. */
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-expanded={expanded}
      className="inline-flex items-center gap-1.5 rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {expanded ? (
        <ChevronDown className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <ChevronRight className="size-3.5 shrink-0" aria-hidden />
      )}
      <span className="sr-only">
        {expanded ? "Collapse" : "Expand"} {label}
      </span>
      {children}
    </Link>
  );
}
