// The conversation list's pager (issue #63): one quiet line under the table,
// `‹ Previous  51–100 of 180  Next ›`, and a compact copy above it.
// Previous/Next only — no page-number widget — because the list is a scan
// surface, not an index.
//
// A SERVER component: paging is URL view state like sort, scope and the errors
// filter, so each end is a plain `<Link>` to a `?page=` href built by
// `pageHref` (which carries every other axis forward). Each end targets the
// table's `#conversations` anchor, so the new page opens at its first row
// rather than at the top of the page, above the overview band.
//
// ADR-0002 boundary: no core import — it takes plain numbers and the link
// context.

import { ChevronLeft, ChevronRight } from "lucide-react";

import { PendingLink } from "@/app/_components/pending-link";
import { formatCount } from "@/app/_lib/format";
import { pageRange } from "@/app/_lib/list-view";
import { type ListLinkContext, pageHref } from "@/app/_lib/sort";
import { cn } from "@/lib/utils-cn";

/**
 * Previous / Next around the rows this page shows ("1–50 of 60"). The `full`
 * pager sits under the table with worded ends; the `compact` one sits above it
 * with icon-only ends. Renders NOTHING when the scoped set fits on one page; an
 * end that does not exist (no previous on page 1, no next on the last page) is
 * shown dimmed instead of linked, so the line never changes width as you page.
 *
 * @example <ListPager page={view.page} pageCount={view.pageCount} rowCount={view.rowCount} links={links} />
 */
export function ListPager({
  page,
  pageCount,
  rowCount,
  links,
  variant = "full",
  className,
}: {
  /** The resolved (clamped) 1-based current page. */
  page: number;
  /** How many pages the scoped set spans. */
  pageCount: number;
  /** How many conversations the scoped set holds, across every page. */
  rowCount: number;
  /** The active view state, preserved by both ends. */
  links: ListLinkContext;
  variant?: "full" | "compact";
  className?: string;
}) {
  if (pageCount <= 1) return null;
  const { first, last } = pageRange(page, rowCount);
  const compact = variant === "compact";
  const prev = page > 1 ? `${pageHref(page - 1, links)}${TABLE_ANCHOR}` : undefined;
  const next = page < pageCount ? `${pageHref(page + 1, links)}${TABLE_ANCHOR}` : undefined;
  return (
    <nav
      aria-label={compact ? "Pagination, above the table" : "Pagination"}
      className={cn("flex items-center gap-1 text-sm", className)}
    >
      <PagerEnd href={prev} rel="prev" compact={compact}>
        <ChevronLeft className="size-4 shrink-0" aria-hidden />
        <span className={compact ? "sr-only" : undefined}>{compact ? "Previous page" : "Previous"}</span>
      </PagerEnd>
      <span className={cn("px-1.5 whitespace-nowrap text-muted-foreground", compact && "order-first")}>
        {formatCount(first)}–{formatCount(last)} of {formatCount(rowCount)}
      </span>
      <PagerEnd href={next} rel="next" compact={compact}>
        <span className={compact ? "sr-only" : undefined}>{compact ? "Next page" : "Next"}</span>
        <ChevronRight className="size-4 shrink-0" aria-hidden />
      </PagerEnd>
    </nav>
  );
}

/** The conversation table's id (set by the list page), where a new page opens. */
const TABLE_ANCHOR = "#conversations";

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
