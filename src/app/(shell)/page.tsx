// Conversation list — the app's single page (issue #3). A React Server
// Component: it reads the active scope + sort + expanded row from
// `searchParams`, fetches the rows (and the expanded row's detail) via the
// cached app-zone readers, and renders a sortable shadcn table with a
// grand-total footer. The app bar and the folder sidebar live in the layouts
// (PR #13); the page renders its title, the overview band and the table. Sorting,
// scoping, and row expansion are all server-side via search-param links (no
// front-end data filtering); the pure URL-state logic lives in `@/app/_lib/sort`.
//
// ADR-0002 boundary: the core read is reached through `loadConversations`
// (app-zone), not a direct core import. The shadcn Table/Button + `next/link`
// `<Link>` are client components but receive plain serializable props/children.
//
// `cacheComponents` (PPR) is on, so the request-time `searchParams` read is
// wrapped in <Suspense>: the page shell prerenders, the data table streams in.
// `loadConversations` defers the DB read out of prerendering (connection()).

import { AlertTriangle, FolderOpen, Inbox } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { CONVERSATION_COLUMNS, ConversationRow } from "@/app/_components/conversation-row";
import { EmptyState, EmptyStateLink } from "@/app/_components/empty-state";
import { ListPager } from "@/app/_components/list-pager";
import { LoadingRegion } from "@/app/_components/loading-region";
import { OverviewBand } from "@/app/_components/overview-band";
import { PageHeader } from "@/app/_components/page-header";
import { PendingLink } from "@/app/_components/pending-link";
import { RefreshButton } from "@/app/_components/refresh-button";
import { SortableHead } from "@/app/_components/sortable-head";
import { StatSkeleton } from "@/app/_components/stat-strip";
import {
  loadConversationDetail,
  loadConversationErrors,
  loadConversations,
  loadFamily,
  loadFamilySizes,
} from "@/app/_lib/conversations";
import { footerLabelColSpan } from "@/app/_lib/columns";
import { errorsView } from "@/app/_lib/errors-view";
import { familyView } from "@/app/_lib/family-view";
import { type FolderEntry } from "@/app/_lib/folders";
import { formatCount, formatDate, formatGrandTotalCost, formatTokens } from "@/app/_lib/format";
import { buildListView } from "@/app/_lib/list-view";
import { type ViewSearchParams, firstParam } from "@/app/_lib/search-params";
import {
  type ListLinkContext,
  type SortableField,
  errorsHref,
  expandHref,
  folderHref,
  listReturnQuery,
  resolveErrorsOnly,
  resolveExpanded,
  resolvePage,
  resolveSort,
  sortHref,
} from "@/app/_lib/sort";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = { title: "Conversations" };

export default function Page({ searchParams }: { searchParams: Promise<ViewSearchParams> }) {
  return (
    <>
      <PageHeader
        title="Conversations"
        description="Every conversation from your local Claude Code logs, with token and cost rollups."
        className="mb-6"
      />

      {/* The overview band: this surface's headline analysis, above its table.
          Global (scope-independent) figures; it reads `searchParams` only to
          say so when a folder is selected. Its own Suspense boundary defers the
          request-time read out of prerendering (PPR). */}
      <Suspense fallback={<OverviewFallback />}>
        <Overview searchParams={searchParams} />
      </Suspense>

      {/* The table's controls (breadcrumb, pager, errors toggle) build their
          hrefs from `searchParams`, so they stream in with the table and its
          skeleton draws their strip. */}
      <Suspense fallback={<ConversationTableFallback />}>
        <ConversationTable searchParams={searchParams} />
      </Suspense>
    </>
  );
}

/** The overview band's skeleton: the heading line over the four-cell strip. */
function OverviewFallback() {
  return (
    <LoadingRegion label="Loading overview" className="mb-6">
      <div className="mb-2 flex h-5 items-center">
        <Skeleton className="h-3.5 w-56" />
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <StatSkeleton key={index} />
        ))}
      </div>
    </LoadingRegion>
  );
}

/** The table rows its skeleton draws: enough to fill the first screen. */
const SKELETON_ROWS = 8;

/**
 * The conversation table's skeleton: the controls strip, then the table card
 * with its header row and a handful of rows, at the real rows' heights.
 */
function ConversationTableFallback() {
  return (
    <LoadingRegion label="Loading conversations">
      <div className="mb-3 flex h-8 items-center justify-end gap-3">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="@container overflow-hidden rounded-xl border bg-card">
        <div className="flex h-[41px] items-center gap-4 border-b bg-muted/30 px-4">
          <Skeleton className="h-3.5 w-6 @xl:w-12" />
          <Skeleton className="h-3.5 w-12" />
          <Skeleton className="ml-auto h-3.5 w-10" />
        </div>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div key={index} className="flex h-[41px] items-center gap-4 border-b px-4 last:border-0">
            <Skeleton className="size-5 shrink-0 @xl:w-24" />
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="hidden h-3.5 w-16 @xl:block" />
            <Skeleton className="h-3.5 w-14" />
          </div>
        ))}
      </div>
    </LoadingRegion>
  );
}

/**
 * The overview band's data: the headline aggregate, derived from ALL
 * conversations (scope-independent), plus the selected folder's label so the
 * band can say its figures are not filtered. Split out so the request-time read
 * sits inside its own <Suspense> boundary. The `loadConversations()` read is
 * deduped with the sidebar/table via React `cache()`, so the band adds no extra
 * DB work.
 */
async function Overview({ searchParams }: { searchParams: Promise<ViewSearchParams> }) {
  const params = await searchParams;
  const allRows = await loadConversations();
  // No sort intent -> scope-independent slice only.
  const { overview, folders } = buildListView(allRows);
  // Before the first scan there is nothing to sum: the table's empty state
  // says what to do, and a row of zero cards would only look broken.
  if (overview.conversationCount === 0) return null;
  const activeFolder = firstParam(params.folder) || undefined;
  const selected = activeFolder ? folders.find((entry) => entry.folder === activeFolder) : undefined;
  return <OverviewBand overview={overview} selectedFolderLabel={selected?.label} />;
}

/**
 * Reads the active sort + scope from `searchParams` and the rows from the cached
 * app-zone reader, then renders the table (or the empty state). Kept separate
 * from {@link Page} so the request-time data fetch sits inside the page's
 * <Suspense> boundary (PPR).
 */
async function ConversationTable({ searchParams }: { searchParams: Promise<ViewSearchParams> }) {
  const params = await searchParams;
  // URL → resolved intent at the page edge; the seam takes intent, never raw
  // searchParams.
  const sort = resolveSort(params.sortBy, params.dir);
  // The active scope, normalized: a non-empty key, or `undefined`/empty for
  // "All folders". Threaded onto the header links so re-sorting keeps the scope.
  const activeFolder = firstParam(params.folder) || undefined;
  // The expanded row's id, if any (`?expanded=<id>`). Row expansion is URL view
  // state like sort/folder, so expanded panels are shareable and survive reload.
  const expandedId = resolveExpanded(params.expanded);
  // The Trends range, carried verbatim through every link this page builds, so
  // sorting/expanding here never resets the range the user picked on Trends.
  const range = firstParam(params.range) || undefined;
  // The "only with errors" filter (`?errors=1`), off by default (issue #47).
  const errorsOnly = resolveErrorsOnly(params.errors);
  // The page the URL explicitly asked for (`?page=`, 1-based), or `undefined`
  // when it asked for none — the seam then places the page on the expanded row
  // and clamps it to the pages the scoped set actually has (issue #63).
  const requestedPage = resolvePage(params.page);
  // Fetch ALL rows once (deduped with the layout's sidebar read via React
  // cache()); the seam owns the order-dependent pipeline (filter BEFORE sort,
  // one `deriveFolders` derive feeding the table breadcrumb + scope, paginate
  // LAST so the footer still totals the whole scoped set).
  const allRows = await loadConversations();
  const {
    rows,
    page,
    pageCount,
    rowCount,
    scoped: isScoped,
    selectedFolder,
    grandTotal: total,
  } = buildListView(allRows, {
    folder: activeFolder,
    sort,
    errorsOnly,
    page: requestedPage,
    expanded: expandedId,
  });
  // The one view-state value every link on this page carries forward, so the
  // axes compose instead of clobbering each other (see `ListLinkContext`). It
  // carries the CLAMPED page, so a link never propagates a page that does not
  // exist.
  const links: ListLinkContext = { sort, folder: activeFolder, range, errorsOnly, page };

  // Continuation-family size per conversation, walked ONCE over the same rows
  // (issue #46). Sizes come from the UNSCOPED set on purpose: a family spanning
  // two Projects still reports its true size while the list is scoped to one.
  const familySize = await loadFamilySizes();

  // Fetch the expanded row's panel detail server-side — only when that row is
  // actually visible in the current view. `rows` is the current PAGE, but a bare
  // `?expanded=` (no `?page=`) opened the page holding it, so only a genuinely
  // stale/foreign id — or one pinned to another page — misses. `null` detail
  // still renders the panel with a graceful note.
  const expandedRow = expandedId ? rows.find((row) => row.id === expandedId) : undefined;
  const expandedDetail = expandedRow ? await loadConversationDetail(expandedRow.id) : null;

  // The expanded row's failed turns, shaped for the panel's error list. Read
  // only for the open row — a collapsed table costs nothing.
  const expandedErrors = expandedRow ? errorsView(expandedRow.id, await loadConversationErrors(expandedRow.id)) : null;

  // Format every row's relative Date label against ONE request-time `now` so
  // all rows agree on what "5m ago" means, and hand each row the resulting
  // strings as plain props.
  const now = new Date();

  // The expanded row's continuation family, shaped for the panel's tree (member
  // links preserve the active sort/scope/range — see `familyView`).
  const expandedFamily = expandedRow ? await loadFamily(expandedRow.id) : null;
  const expandedFamilyView = expandedFamily ? familyView(expandedFamily, links, now) : null;

  // This exact view — open row included — for the transcript links to carry
  // back (`?from=`), so "All conversations" there returns here.
  const listReturn = listReturnQuery(links, expandedRow?.id);

  const conversations = `${formatCount(rowCount)} conversation${rowCount === 1 ? "" : "s"}`;
  const footerLabel = pageCount > 1 ? `All ${conversations}` : conversations;

  // Empty when there are genuinely no conversations OR when the active scope
  // matched nothing (unknown/stale `?folder=`, or a folder with zero rows).
  if (rows.length === 0) {
    // No filter in play: the database is simply empty — the first run.
    if (!isScoped && !errorsOnly) return <EmptyList scoped={false} links={links} />;
    return (
      <>
        <ListControls folder={selectedFolder} links={links} pager={null} />
        <EmptyList scoped={isScoped} links={links} />
      </>
    );
  }

  return (
    <>
      <ListControls
        folder={selectedFolder}
        links={links}
        pager={<ListPager variant="compact" page={page} pageCount={pageCount} rowCount={rowCount} links={links} />}
      />

      {/* The pager lands here (`#conversations`), not at the page top. The
          wrapper is the `@container` the columns respond to: the table's
          width, not the viewport's, decides which columns fit. */}
      <div id="conversations" className="@container scroll-mt-4 overflow-hidden rounded-xl border bg-card">
        <Table className="table-fixed">
          <TableHeader className="bg-muted/30">
            <TableRow className="hover:bg-transparent">
              <ListSortableHead
                field="date"
                links={links}
                className={`${CONVERSATION_COLUMNS.date} pl-2`}
                labelClassName="sr-only @xl:not-sr-only"
              >
                Date
              </ListSortableHead>
              {/* The Folder column is hidden when scoped (redundant — see breadcrumb). */}
              {!isScoped && (
                <ListSortableHead field="folder" links={links} className={CONVERSATION_COLUMNS.folder}>
                  Folder
                </ListSortableHead>
              )}
              <ListSortableHead field="title" links={links} className={CONVERSATION_COLUMNS.title}>
                Title
              </ListSortableHead>
              <ListSortableHead field="model" links={links} className={CONVERSATION_COLUMNS.model}>
                Model(s)
              </ListSortableHead>
              <ListSortableHead field="total" links={links} align="right" className={CONVERSATION_COLUMNS.total}>
                Total
              </ListSortableHead>
              <ListSortableHead
                field="cost"
                links={links}
                align="right"
                className={`${CONVERSATION_COLUMNS.cost} pr-2`}
              >
                Cost
              </ListSortableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((row) => (
              <ConversationRow
                key={row.id}
                row={row}
                date={formatDate(row.startedAt, now)}
                scoped={isScoped}
                expanded={row.id === expandedRow?.id}
                detail={row.id === expandedRow?.id ? expandedDetail : null}
                familySize={familySize.get(row.id) ?? 1}
                family={row.id === expandedRow?.id ? expandedFamilyView : null}
                errors={row.id === expandedRow?.id ? expandedErrors : null}
                toggleHref={expandHref(row.id, expandedId, links)}
                listReturn={listReturn}
              />
            ))}
          </TableBody>

          {/* The footer totals the whole scoped set, every page of it — its
              label says so once the set spans pages. The label cell exists in
              two spans, one per layout, since a hidden column must not be
              spanned (the compact layout hides Folder and Model(s)). */}
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={footerLabelColSpan(isScoped, { compact: true })}
                className="pl-4 font-medium @4xl:hidden"
              >
                {footerLabel}
              </TableCell>
              <TableCell colSpan={footerLabelColSpan(isScoped)} className="hidden pl-4 font-medium @4xl:table-cell">
                {footerLabel}
              </TableCell>
              <TableCell className={`${CONVERSATION_COLUMNS.total} text-right`}>
                {formatTokens(total.tokens.total)}
              </TableCell>
              <TableCell className={`${CONVERSATION_COLUMNS.cost} text-right font-semibold text-cost-foreground`}>
                {total.hasUnpriced ? (
                  <span title="Includes unpriced model usage — this total is a lower bound.">
                    {"~"}
                    {formatGrandTotalCost(total.costUsd)}
                  </span>
                ) : (
                  formatGrandTotalCost(total.costUsd)
                )}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {(total.hasUnpriced || pageCount > 1) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          {/* The "~" is explained where people can see it, not only in a
              hover title: once, under the table, whenever the totals carry it. */}
          {total.hasUnpriced ? (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">~</span> marks a lower bound: some usage is on a model
              without a known price, counted as $0.
            </p>
          ) : (
            <span />
          )}
          <ListPager page={page} pageCount={pageCount} rowCount={rowCount} links={links} />
        </div>
      )}
    </>
  );
}

/**
 * The strip above the table: the Project breadcrumb when scoped (left), then
 * the compact pager and the "only with errors" toggle (right). Rendered in BOTH
 * states — with rows and empty — so the toggle never disappears at the moment
 * you want to turn it off.
 */
function ListControls({
  folder,
  links,
  pager,
}: {
  /** The selected Project, when a `?folder=` scope is active. */
  folder: FolderEntry | undefined;
  links: ListLinkContext;
  /** The compact pager, or `null` when there are no rows to page. */
  pager: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      {folder ? <FolderBreadcrumb folder={folder} links={links} /> : <span />}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {pager}
        <ErrorsFilterToggle links={links} />
      </div>
    </div>
  );
}

/**
 * The "only with errors" filter, a server-side link like every other list
 * control (`?errors=1`). Pressed state is the URL's, so it is shareable and
 * survives a reload; `aria-pressed` carries it to assistive tech.
 */
function ErrorsFilterToggle({ links }: { links: ListLinkContext }) {
  const active = links.errorsOnly === true;
  return (
    <PendingLink
      href={errorsHref(links)}
      scroll={false}
      aria-pressed={active}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors ${
        active
          ? "border-destructive/30 bg-destructive/10 text-destructive-foreground dark:bg-destructive/20"
          : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      <AlertTriangle className="size-3.5" aria-hidden />
      Only with errors
    </PendingLink>
  );
}

/**
 * The table-region empty state, with the way out: a filter that matched
 * nothing offers to drop it (keeping the rest of the view state); an empty
 * database offers the first scan.
 */
function EmptyList({
  scoped,
  links,
}: {
  scoped: boolean;
  /** The active view state, preserved by the clear-filter link. */
  links: ListLinkContext;
}) {
  if (links.errorsOnly) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="No conversations with API errors"
        action={<EmptyStateLink href={errorsHref(links)}>Show all conversations</EmptyStateLink>}
      >
        {scoped ? "Nothing in this folder hit an API error." : "None of your conversations hit an API error."}
      </EmptyState>
    );
  }
  if (scoped) {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No conversations in this folder"
        action={<EmptyStateLink href={folderHref(undefined, links)}>Show all folders</EmptyStateLink>}
      >
        The folder may have been removed since the last scan.
      </EmptyState>
    );
  }
  return (
    <EmptyState icon={Inbox} title="No conversations yet" action={<RefreshButton />}>
      Scan your Claude Code logs to see your conversations here.
    </EmptyState>
  );
}

/**
 * The scope breadcrumb shown above the table when a single Project is selected.
 * Shows the Project's full path once (replacing the now-hidden Folder column)
 * with a link back to "All folders" that preserves the active sort.
 */
function FolderBreadcrumb({
  folder,
  links,
}: {
  folder: FolderEntry;
  /** The active view state, preserved by the "All folders" link. */
  links: ListLinkContext;
}) {
  return (
    <nav aria-label="Folder scope" className="flex flex-wrap items-center gap-2 text-sm">
      <PendingLink href={folderHref(undefined, links)} scroll={false} className="text-muted-foreground hover:underline">
        All folders
      </PendingLink>
      <span aria-hidden className="text-muted-foreground">
        /
      </span>
      <span className="font-medium" title={folder.path}>
        {folder.label}
      </span>
    </nav>
  );
}

/** A list column header: the shared {@link SortableHead} pointed at this list's sort links. */
function ListSortableHead({
  field,
  links,
  ...props
}: {
  field: SortableField;
  /** The active view state, threaded so re-sorting keeps every other axis. */
  links: ListLinkContext;
} & Omit<React.ComponentProps<typeof SortableHead>, "href" | "sort">) {
  return (
    <SortableHead href={sortHref(field, links)} sort={links.sort.sortBy === field ? links.sort.dir : null} {...props} />
  );
}
