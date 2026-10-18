// The conversation list's pager (issue #63): one quiet line under the table,
// `‹ Previous  51–100 of 180  Next ›`, and a compact copy above it.
//
// A SERVER component: paging is URL view state like sort, scope and the errors
// filter, so each end is a link to a `?page=` href built by `pageHref` (which
// carries every other axis forward). Each end targets the table's
// `#conversations` anchor, so the new page opens at its first row rather than
// at the top of the page, above the overview band. The line itself is the
// shared `Pager`.
//
// ADR-0002 boundary: no core import — it takes plain numbers and the link
// context.

import { Pager } from "@/app/_components/pager";
import { PAGE_SIZE, pageRange } from "@/app/_lib/list-view";
import { type ListLinkContext, pageHref } from "@/app/_lib/sort";

/**
 * The list's Previous / Next around the rows this page shows ("1–50 of 60").
 * The `full` pager sits under the table with worded ends; the `compact` one
 * sits above it with icon-only ends. Renders nothing when the scoped set fits
 * on one page.
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
  const { first, last } = pageRange(page, rowCount, PAGE_SIZE);
  return (
    <Pager
      prevHref={page > 1 ? `${pageHref(page - 1, links)}${TABLE_ANCHOR}` : undefined}
      nextHref={page < pageCount ? `${pageHref(page + 1, links)}${TABLE_ANCHOR}` : undefined}
      first={first}
      last={last}
      total={rowCount}
      label={variant === "compact" ? "Pagination, above the table" : "Pagination"}
      variant={variant}
      className={className}
    />
  );
}

/** The conversation table's id (set by the list page), where a new page opens. */
const TABLE_ANCHOR = "#conversations";
