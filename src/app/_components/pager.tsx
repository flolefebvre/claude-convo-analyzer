// The app's one pager line, `‹ Previous  51–100 of 180  Next ›`, shared by the
// conversation list (`ListPager`) and the transcript (`TranscriptPager`).
// Previous/Next only — no page-number widget — because both are scan surfaces,
// not indexes.
//
// A SERVER component and purely presentational: each caller builds its own
// hrefs (paging is URL view state, and every view carries different axes
// forward), so this only lays out the two ends and the count between them.

import { ChevronLeft, ChevronRight } from "lucide-react";

import { PendingLink } from "@/app/_components/pending-link";
import { formatCount } from "@/app/_lib/format";
import { cn } from "@/lib/utils-cn";

/**
 * Previous / Next around the items one page shows ("1–50 of 60"). The `full`
 * pager has worded ends; the `compact` one has icon-only ends with the count
 * first. Renders NOTHING when neither end exists — everything fits on one
 * page. An end that does not exist (no previous on page 1, no next on the last
 * page) is shown dimmed instead of linked, so the line never changes width as
 * you page.
 *
 * @example <Pager prevHref={undefined} nextHref="?page=2" first={1} last={50} total={60} label="Pagination" />
 */
export function Pager({
  prevHref,
  nextHref,
  first,
  last,
  total,
  noun,
  label,
  variant = "full",
  className,
}: {
  /** The previous page's href, or `undefined` on the first page. */
  prevHref: string | undefined;
  /** The next page's href, or `undefined` on the last page. */
  nextHref: string | undefined;
  /** 1-based position of the first item this page shows. */
  first: number;
  /** 1-based position of the last item this page shows. */
  last: number;
  /** How many items the whole set holds, across every page. */
  total: number;
  /** What is counted, plural, appended to the total ("of 450 messages"); bare when omitted. */
  noun?: string;
  /** The navigation landmark's accessible name. */
  label: string;
  variant?: "full" | "compact";
  className?: string;
}) {
  if (prevHref === undefined && nextHref === undefined) return null;
  const compact = variant === "compact";
  return (
    <nav aria-label={label} className={cn("flex items-center gap-1 text-sm", className)}>
      <PagerEnd href={prevHref} rel="prev" compact={compact}>
        <ChevronLeft className="size-4 shrink-0" aria-hidden />
        <span className={compact ? "sr-only" : undefined}>{compact ? "Previous page" : "Previous"}</span>
      </PagerEnd>
      <span className={cn("px-1.5 whitespace-nowrap text-muted-foreground", compact && "order-first")}>
        {formatCount(first)}–{formatCount(last)} of {formatCount(total)}
        {noun && ` ${noun}`}
      </span>
      <PagerEnd href={nextHref} rel="next" compact={compact}>
        <span className={compact ? "sr-only" : undefined}>{compact ? "Next page" : "Next"}</span>
        <ChevronRight className="size-4 shrink-0" aria-hidden />
      </PagerEnd>
    </nav>
  );
}

/** One end of the pager: a link, or — with no `href` — the same label dimmed
 *  and marked disabled for assistive tech. */
function PagerEnd({
  href,
  rel,
  compact,
  children,
}: {
  /** The target page's href, or `undefined` when this end does not exist. */
  href: string | undefined;
  rel: "prev" | "next";
  compact: boolean;
  children: React.ReactNode;
}) {
  const shape = cn(
    "inline-flex h-8 items-center gap-1 rounded-md font-medium",
    compact ? "w-8 justify-center" : "px-2.5",
  );
  if (href === undefined) {
    return (
      <span aria-disabled="true" className={cn(shape, "text-muted-foreground/40")}>
        {children}
      </span>
    );
  }
  return (
    <PendingLink
      href={href}
      rel={rel}
      className={cn(
        shape,
        "text-muted-foreground transition-colors hover:bg-muted hover:text-foreground has-data-link-pending:bg-muted",
      )}
    >
      {children}
    </PendingLink>
  );
}
