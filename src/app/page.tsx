// Conversation list — the app's single page (issue #3). A React Server
// Component: it reads the core read API (`listConversations`) at request time
// and renders a sortable shadcn table with a grand-total footer. Sorting is
// server-side via search-param links (no client JS); the pure sort/label logic
// lives in `@/app/_lib/sort` and is unit-tested there.
//
// ADR-0002 boundary: core is imported ONLY here (a server component). The
// shadcn Table/Button are client components but receive plain serializable
// props/children — they never import core.
//
// `cacheComponents` (PPR) is on, so the request-time `searchParams` read is
// wrapped in <Suspense>: the page shell prerenders, the data table streams in.

import { connection } from "next/server";
import { Suspense } from "react";

import { listConversations } from "@/core/refresh";
import { ConversationRow } from "@/app/_components/conversation-row";
import { FolderSidebar } from "@/app/_components/folder-sidebar";
import { RefreshButton } from "@/app/_components/refresh-button";
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
    <main className="mx-auto w-full max-w-7xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Claude Conversation Analyzer
          </h1>
          <p className="text-sm text-muted-foreground">
            Every conversation from your local Claude Code logs, with token and
            cost rollups.
          </p>
        </div>
        {/* Slice 3: the Refresh control. A client component that calls the
            refreshConversations server action; the page stays a server component. */}
        <div data-slot="refresh-action">
          <RefreshButton />
        </div>
      </header>

      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading conversations…</p>}>
        <ConversationTable searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

/**
 * Reads the active sort from `searchParams` and the rows from the core, then
 * renders the table (or the empty state). Kept separate from {@link Page} so the
 * request-time data fetch sits inside the page's <Suspense> boundary (PPR).
 */
async function ConversationTable({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  const params = await searchParams;
  const sort = resolveSort(params.sortBy, params.dir);
  const folderParam = firstParam(params.folder);
  // Exclude the synchronous better-sqlite3 query from prerendering: with Cache
  // Components on, sync DB drivers otherwise complete at build time. connection()
  // stops prerendering here so the read runs only on a real request (Next 16
  // docs). Core itself is a top-level import — loading it opens no DB (see
  // `import-side-effects.test.ts`); connection() is what defers the actual read.
  await connection();
  // Pipeline order matters: fetch ALL rows once, derive the sidebar's folder
  // list from the unscoped set, THEN scope to the active folder, THEN sort.
  // Filtering BEFORE sorting lets scope compose with sort. The APP is the source
  // of truth for ordering (core's comparator only handles top-level scalars).
  const allRows = await listConversations();
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
    return (
      <Layout sidebar={
        <FolderSidebar
          folders={folders}
          activeFolder={activeFolder}
          sort={sort}
          totalCount={allRows.length}
        />
      }>
        <EmptyState scoped={activeFolder !== undefined} sort={sort} />
      </Layout>
    );
  }

  const total = grandTotal(rows);

  return (
    <Layout sidebar={
      <FolderSidebar
        folders={folders}
        activeFolder={activeFolder}
        sort={sort}
        totalCount={allRows.length}
      />
    }>
      {/* When scoped, every row shares one Project: show its full path once as a
          breadcrumb (with a way back to all folders) instead of a Folder column. */}
      {selectedFolder && (
        <FolderBreadcrumb folder={selectedFolder} sort={sort} />
      )}

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
    </Layout>
  );
}

/** Two-column shell: a left folder sidebar + the main table region. */
function Layout({
  sidebar,
  children,
}: {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start">
      <aside className="w-full shrink-0 md:w-64">{sidebar}</aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
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
          <a
            href={folderHref(undefined, sort)}
            className="mt-3 inline-block text-sm font-medium hover:underline"
          >
            Clear filter — show all folders
          </a>
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
      <a
        href={folderHref(undefined, sort)}
        className="text-muted-foreground hover:underline"
      >
        All folders
      </a>
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
      <a
        href={sortHref(field, sort, folder)}
        className="inline-flex items-center gap-1 hover:underline"
      >
        {children}
        {indicator !== "" && (
          <span aria-hidden className="text-muted-foreground">
            {indicator}
          </span>
        )}
      </a>
    </TableHead>
  );
}

