// Conversation list — the app's single page (issue #3). A React Server
// Component: it reads the active scope + sort from `searchParams`, fetches the
// rows via the cached app-zone reader, and renders a sortable shadcn table with
// a grand-total footer. The persistent app shell (header + sidebar) lives in the
// root layout (PR #13); the page renders ONLY the table region. Sorting and
// scoping are server-side via search-param links (no front-end data filtering —
// ADR-0004); the pure sort/label logic lives in `@/app/_lib/sort`.
//
// ADR-0002 boundary: the core read is reached through `loadConversations`
// (app-zone), not a direct core import. The shadcn Table/Button + `next/link`
// `<Link>` are client components but receive plain serializable props/children.
//
// `cacheComponents` (PPR) is on, so the request-time `searchParams` read is
// wrapped in <Suspense>: the page shell prerenders, the data table streams in.
// `loadConversations` defers the DB read out of prerendering (connection()).

import Link from "next/link";
import { Suspense } from "react";

import { ConversationRow } from "@/app/_components/conversation-row";
import { loadConversations } from "@/app/_lib/conversations";
import { footerLabelColSpan } from "@/app/_lib/columns";
import {
  type FolderEntry,
  deriveFolders,
  filterByFolder,
} from "@/app/_lib/folders";
import {
  formatGrandTotalCost,
  formatTokens,
  grandTotal,
} from "@/app/_lib/format";
import {
  type SortableField,
  type SortState,
  folderHref,
  resolveSort,
  sortConversations,
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
    <Suspense
      fallback={
        <p className="text-sm text-muted-foreground">Loading conversations…</p>
      }
    >
      <ConversationTable searchParams={searchParams} />
    </Suspense>
  );
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
  const sort = resolveSort(params.sortBy, params.dir);
  const folderParam = firstParam(params.folder);
  // Pipeline order matters: fetch ALL rows once (deduped with the layout's
  // sidebar read via React cache()), derive the folder set, THEN scope to the
  // active folder, THEN sort. Filtering BEFORE sorting lets scope compose with
  // sort. The APP is the source of truth for ordering (core's comparator only
  // handles top-level scalars).
  const allRows = await loadConversations();
  const folders = deriveFolders(allRows);
  // The active scope, if any. A non-empty but unknown/stale key yields no rows
  // (handled by the empty state below); `undefined`/empty means "All folders".
  const activeFolder = folderParam ? folderParam : undefined;
  const scopedRows = filterByFolder(allRows, activeFolder);
  const rows = sortConversations(scopedRows, sort);
  const isScoped = activeFolder !== undefined;
  // The selected Project for the breadcrumb (its full path / label). Reuse the
  // already-derived sidebar entries rather than re-deriving; a stale/unknown
  // `?folder=` yields no entry (and no rows, so the empty state handles it).
  const selectedFolder = activeFolder
    ? folders.find((f) => f.folder === activeFolder)
    : undefined;

  // Empty when there are genuinely no conversations OR when the active scope
  // matched nothing (unknown/stale `?folder=`, or a folder with zero rows).
  if (rows.length === 0) {
    return <EmptyState scoped={isScoped} sort={sort} />;
  }

  const total = grandTotal(rows);

  return (
    <>
      {/* When scoped, every row shares one Project: show its full path once as a
          breadcrumb (with a way back to all folders) instead of a Folder column. */}
      {selectedFolder && <FolderBreadcrumb folder={selectedFolder} sort={sort} />}

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <SortableHead field="date" sort={sort} folder={activeFolder}>
                Date
              </SortableHead>
              {/* The Folder column is hidden when scoped (redundant — see breadcrumb). */}
              {!isScoped && (
                <SortableHead field="folder" sort={sort} folder={activeFolder}>
                  Folder
                </SortableHead>
              )}
              <SortableHead field="title" sort={sort} folder={activeFolder}>
                Title
              </SortableHead>
              <SortableHead field="model" sort={sort} folder={activeFolder}>
                Model(s)
              </SortableHead>
              <SortableHead
                field="total"
                sort={sort}
                folder={activeFolder}
                className="text-right"
              >
                Total
              </SortableHead>
              <SortableHead
                field="cost"
                sort={sort}
                folder={activeFolder}
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
              <ConversationRow key={row.id} row={row} scoped={isScoped} />
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
              <TableCell className="text-right font-medium tabular-nums">
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
 * The table-region empty state. When scoped, the `?folder=` matched nothing
 * (unknown/stale key or an empty Project) so we offer a clear-filter link back
 * to "All folders" (preserving sort). When unscoped, there are simply no
 * conversations yet.
 */
function EmptyState({ scoped, sort }: { scoped: boolean; sort: SortState }) {
  return (
    <div className="rounded-lg border border-dashed p-12 text-center">
      {scoped ? (
        <>
          <p className="text-sm text-muted-foreground">
            No conversations in this folder.
          </p>
          <Link
            href={folderHref(undefined, sort)}
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
  sort,
}: {
  folder: FolderEntry;
  sort: SortState;
}) {
  return (
    <nav
      aria-label="Folder scope"
      className="mb-3 flex flex-wrap items-center gap-2 text-sm"
    >
      <Link
        href={folderHref(undefined, sort)}
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
      <span className="text-muted-foreground" title={folder.path}>
        {folder.path}
      </span>
    </nav>
  );
}

/** A header cell that links to the toggled sort + shows the active arrow. */
function SortableHead({
  field,
  sort,
  folder,
  className,
  children,
}: {
  field: SortableField;
  sort: SortState;
  /** The active `?folder=` scope, threaded so re-sorting keeps the folder. */
  folder?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const indicator = sortIndicator(field, sort);
  const ariaSort =
    sort.sortBy === field
      ? sort.dir === "asc"
        ? "ascending"
        : "descending"
      : "none";
  return (
    <TableHead className={className} aria-sort={ariaSort}>
      <Link
        href={sortHref(field, sort, folder)}
        className="inline-flex items-center gap-1 hover:underline"
      >
        {children}
        {indicator !== "" && (
          <span aria-hidden className="text-muted-foreground">
            {indicator}
          </span>
        )}
      </Link>
    </TableHead>
  );
}
