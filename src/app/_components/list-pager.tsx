// The conversation list's pager (issue #63): one quiet line under the table,
// `← Previous · Page 3 of 18 · Next →`. Previous/Next only — no page-number
// widget — because the list is a scan surface, not an index.
//
// A SERVER component: paging is URL view state like sort, scope and the errors
// filter, so each end is a plain `<Link>` to a `?page=` href built by
// `pageHref` (which carries every other axis forward). Scrolling is left to
// Next's default: the pager sits at the bottom, so the top of the page is out
// of the viewport and the new page opens at its first row.
//
// ADR-0002 boundary: no core import — it takes plain numbers and the link
// context.

import Link from "next/link";

import { type ListLinkContext, pageHref } from "@/app/_lib/sort";

/**
 * The Previous / Next line under the conversation table. Renders NOTHING when
 * the scoped set fits on one page; an end that does not exist (no previous on
 * page 1, no next on the last page) is shown dimmed instead of linked, so the
 * line never changes width as you page.
 *
 * @example <ListPager page={view.page} pageCount={view.pageCount} links={links} />
 */
export function ListPager({
  page,
  pageCount,
  links,
}: {
  /** The resolved (clamped) 1-based current page. */
  page: number;
  /** How many pages the scoped set spans. */
  pageCount: number;
  /** The active view state, preserved by both ends. */
  links: ListLinkContext;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-3 flex items-center justify-center gap-3 text-sm">
      <PagerEnd href={page > 1 ? pageHref(page - 1, links) : undefined} rel="prev">
        ← Previous
      </PagerEnd>
      <PagerSeparator />
      <span className="text-muted-foreground tabular-nums">
        Page {page} of {pageCount}
      </span>
      <PagerSeparator />
      <PagerEnd href={page < pageCount ? pageHref(page + 1, links) : undefined} rel="next">
        Next →
      </PagerEnd>
    </nav>
  );
}

/** The faint middot between the pager's three parts. */
function PagerSeparator() {
  return (
    <span aria-hidden className="text-muted-foreground/40">
      ·
    </span>
  );
}

/** One end of the pager: a link, or — with no `href` — the same label dimmed
 *  and marked disabled for assistive tech. */
function PagerEnd({
  href,
  rel,
  children,
}: {
  /** The target page's href, or `undefined` when this end does not exist. */
  href: string | undefined;
  rel: "prev" | "next";
  children: React.ReactNode;
}) {
  if (href === undefined) {
    return (
      <span aria-disabled="true" className="text-muted-foreground/40">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} rel={rel} className="font-medium text-muted-foreground transition-colors hover:text-foreground">
      {children}
    </Link>
  );
}
