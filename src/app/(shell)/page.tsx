// Conversation list — the app's single page (issue #3). A React Server
// Component: it reads the active scope + sort + expanded row from
// `searchParams`, fetches the rows (and the expanded row's detail) via the
// cached app-zone readers, and renders a sortable shadcn table with a
// grand-total footer. The persistent app shell (header + sidebar) lives in the
// root layout (PR #13); the page renders ONLY the table region. Sorting,
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

import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import { ConversationRow } from "@/app/_components/conversation-row";
import { OverviewBand } from "@/app/_components/overview-band";
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
import { formatDate, formatGrandTotalCost, formatTokens } from "@/app/_lib/format";
import { buildListView } from "@/app/_lib/list-view";
import {
  type ListLinkContext,
  type SortableField,
  errorsHref,
  expandHref,
  folderHref,
  resolveErrorsOnly,
  resolveExpanded,
  resolveSort,
  sortHref,
  sortIndicator,
} from "@/app/_lib/sort";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type PageSearchParams = {
  sortBy?: string | string[];
  dir?: string | string[];
  folder?: string | string[];
  expanded?: string | string[];
  range?: string | string[];
  errors?: string | string[];
};

/** First value of a `searchParams` entry (Next gives string | string[]). */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  return (
    <>
      {/* The overview band: this surface's headline analysis, above its table.
          Global (scope-independent), so it needs no `searchParams` and gets its
          own Suspense boundary — the request-time read is deferred out of
          prerendering (PPR) while the page shell prerenders. */}
      <Suspense fallback={null}>
        <Overview />
      </Suspense>

      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">Loading conversations…</p>
        }
      >
        <ConversationTable searchParams={searchParams} />
      </Suspense>
    </>
  );
}

/**
 * The overview band's data: the headline aggregate plus the cost-ranked top
 * Projects, both derived from ALL conversations (scope-independent). Split out
 * so the request-time read sits inside its own <Suspense> boundary. The
 * `loadConversations()` read is deduped with the sidebar/table via React
 * `cache()`, so the band adds no extra DB work.
 */
async function Overview() {
  const allRows = await loadConversations();
  // No sort intent -> scope-independent slice only; one `deriveFolders` pass
  // feeds both the overview aggregate and the cost-ranked top Projects.
  const { overview, topProjects } = buildListView(allRows);
  return <OverviewBand overview={overview} topProjects={topProjects} />;
}

/**
 * Reads the active sort + scope from `searchParams` and the rows from the cached
 * app-zone reader, then renders the table (or the empty state). Kept separate
 * from {@link Page} so the request-time data fetch sits inside the page's
 * <Suspense> boundary (PPR).
 */
async function ConversationTable({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
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
  // The one view-state value every link on this page carries forward, so the
  // axes compose instead of clobbering each other (see `ListLinkContext`).
  const links: ListLinkContext = { sort, folder: activeFolder, range, errorsOnly };
  // Fetch ALL rows once (deduped with the layout's sidebar read via React
  // cache()); the seam owns the order-dependent pipeline (filter BEFORE sort,
  // one `deriveFolders` derive feeding the table breadcrumb + scope).
  const allRows = await loadConversations();
  const { rows, scoped: isScoped, selectedFolder, grandTotal: total } =
    buildListView(allRows, { folder: activeFolder, sort, errorsOnly });

  // Continuation-family size per conversation, walked ONCE over the same rows
  // (issue #46). Sizes come from the UNSCOPED set on purpose: a family spanning
  // two Projects still reports its true size while the list is scoped to one.
  const familySize = await loadFamilySizes();

  // Fetch the expanded row's panel detail server-side — only when that row is
  // actually visible in the current view (a stale/foreign `?expanded=` is
  // ignored). `null` detail still renders the panel with a graceful note.
  const expandedRow = expandedId
    ? rows.find((row) => row.id === expandedId)
    : undefined;
  const expandedDetail = expandedRow
    ? await loadConversationDetail(expandedRow.id)
    : null;

  // The expanded row's failed turns, shaped for the panel's error list. Read
  // only for the open row — a collapsed table costs nothing.
  const expandedErrors = expandedRow
    ? errorsView(expandedRow.id, await loadConversationErrors(expandedRow.id))
    : null;

  // Format every row's relative Date label against ONE request-time `now` so
  // all rows agree on what "5m ago" means, and hand each row the resulting
  // strings as plain props.
  const now = new Date();

  // The expanded row's continuation family, shaped for the panel's tree (member
  // links preserve the active sort/scope/range — see `familyView`).
  const expandedFamily = expandedRow
    ? await loadFamily(expandedRow.id)
    : null;
  const expandedFamilyView = expandedFamily
    ? familyView(expandedFamily, links, now)
    : null;

  // Empty when there are genuinely no conversations OR when the active scope
  // matched nothing (unknown/stale `?folder=`, or a folder with zero rows).
  if (rows.length === 0) {
    return (
      <>
        <ListControls folder={selectedFolder} links={links} />
        <EmptyState scoped={isScoped} links={links} />
      </>
    );
  }

  return (
    <>
      <ListControls folder={selectedFolder} links={links} />

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead
                field="date"
                links={links}
              >
                Date
              </SortableHead>
              {/* The Folder column is hidden when scoped (redundant — see breadcrumb). */}
              {!isScoped && (
                <SortableHead
                  field="folder"
                  links={links}
                >
                  Folder
                </SortableHead>
              )}
              <SortableHead
                field="title"
                links={links}
              >
                Title
              </SortableHead>
              <SortableHead
                field="model"
                links={links}
              >
                Model(s)
              </SortableHead>
              <SortableHead
                field="total"
                links={links}
                className="text-right"
              >
                Total
              </SortableHead>
              <SortableHead
                field="cost"
                links={links}
                className="text-right"
              >
                Cost
              </SortableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((row) => (
              // `scoped` lets slice 3 hide the Folder column when a single
              // Project is selected; presentation (two-line cell / breadcrumb)
              // is slice 3's job — this only threads the flag through.
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
              />
            ))}
          </TableBody>

          <TableFooter>
            <TableRow>
              <TableCell colSpan={footerLabelColSpan(isScoped)} className="font-medium">
                {rows.length} conversation{rows.length === 1 ? "" : "s"}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatTokens(total.tokens.total)}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums text-cost">
                {total.hasUnpriced ? (
                  <span
                    title="Includes unpriced model usage — this total is a lower bound."
                  >
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
    </>
  );
}

/**
 * The strip above the table: the Project breadcrumb when scoped (left) and the
 * "only with errors" toggle (right). Rendered in BOTH states — with rows and
 * empty — so the toggle never disappears at the moment you want to turn it off.
 */
function ListControls({
  folder,
  links,
}: {
  /** The selected Project, when a `?folder=` scope is active. */
  folder: FolderEntry | undefined;
  links: ListLinkContext;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      {folder ? <FolderBreadcrumb folder={folder} links={links} /> : <span />}
      <ErrorsFilterToggle links={links} />
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
    <Link
      href={errorsHref(links)}
      scroll={false}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${
        active
          ? "border-destructive/30 bg-destructive/10 text-destructive dark:bg-destructive/20"
          : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      <AlertTriangle className="size-3.5" aria-hidden />
      Only with errors
    </Link>
  );
}

/**
 * The table-region empty state. When scoped, the `?folder=` matched nothing
 * (unknown/stale key or an empty Project) so we offer a clear-filter link back
 * to "All folders" (preserving sort). When unscoped, there are simply no
 * conversations yet.
 */
function EmptyState({
  scoped,
  links,
}: {
  scoped: boolean;
  /** The active view state, preserved by the clear-filter link. */
  links: ListLinkContext;
}) {
  return (
    <div className="rounded-xl border border-dashed bg-card p-16 text-center">
      {links.errorsOnly ? (
        <>
          <p className="text-sm text-muted-foreground">
            No conversations with API errors{scoped ? " in this folder" : ""}.
          </p>
          <Link
            href={errorsHref(links)}
            className="mt-3 inline-block text-sm font-medium hover:underline"
          >
            Show all conversations
          </Link>
        </>
      ) : scoped ? (
        <>
          <p className="text-sm text-muted-foreground">
            No conversations in this folder.
          </p>
          <Link
            href={folderHref(undefined, links)}
            className="mt-3 inline-block text-sm font-medium hover:underline"
          >
            Clear filter — show all folders
          </Link>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          No conversations yet. Click Refresh to scan your conversations.
        </p>
      )}
    </div>
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
    <nav
      aria-label="Folder scope"
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <Link
        href={folderHref(undefined, links)}
        className="text-muted-foreground hover:underline"
      >
        All folders
      </Link>
      <span aria-hidden className="text-muted-foreground">
        /
      </span>
      <span className="font-medium" title={folder.path}>
        {folder.label}
      </span>
    </nav>
  );
}

/** A header cell that links to the toggled sort + shows the active arrow. */
function SortableHead({
  field,
  links,
  className,
  children,
}: {
  field: SortableField;
  /** The active view state, threaded so re-sorting keeps every other axis. */
  links: ListLinkContext;
  className?: string;
  children: React.ReactNode;
}) {
  const sort = links.sort;
  const indicator = sortIndicator(field, sort);
  const isActive = sort.sortBy === field;
  const ariaSort = isActive
    ? sort.dir === "asc"
      ? "ascending"
      : "descending"
    : "none";
  return (
    <TableHead className={className} aria-sort={ariaSort}>
      {/* Quiet uppercase labels echo the overview band's stat-card captions. The
          active sort column lifts to full foreground; the rest stay muted. */}
      <Link
        href={sortHref(field, links)}
        className={`inline-flex items-center gap-1 text-xs font-medium tracking-wide uppercase transition-colors hover:text-foreground ${
          isActive ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        {children}
        {indicator !== "" && <span aria-hidden>{indicator}</span>}
      </Link>
    </TableHead>
  );
}
