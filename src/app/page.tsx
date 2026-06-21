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

import { ConversationRow } from "@/app/_components/conversation-row";
import { RefreshButton } from "@/app/_components/refresh-button";
import {
  formatGrandTotalCost,
  formatTokens,
  grandTotal,
} from "@/app/_lib/format";
import {
  type SortableField,
  type SortState,
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
};

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
  // Exclude the synchronous better-sqlite3 query from prerendering: with Cache
  // Components on, sync DB drivers otherwise complete at build time (where the
  // core's import.meta.dirname-based paths are unresolved). connection() stops
  // prerendering here so the read runs only on a real request (Next 16 docs).
  await connection();
  // Dynamic import so the core module (which evaluates import.meta.dirname-based
  // paths at load) is only loaded at request time, never during the build-time
  // page-config collection that would otherwise crash on undefined dirname.
  const { listConversations } = await import("@/core/refresh");
  // The APP is the source of truth for ordering (core's comparator only handles
  // top-level scalar fields). Fetch all rows, then sort with the app-zone
  // comparator so every column — including nested folder/model/token ones — is
  // sortable. We don't pass sortBy/dir to core (its keys differ from ours).
  const rows = sortConversations(await listConversations(), sort);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <p className="text-sm text-muted-foreground">
          No conversations yet. Click Refresh to scan your conversations.
        </p>
      </div>
    );
  }

  const total = grandTotal(rows);

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead field="folder" sort={sort}>
              Folder
            </SortableHead>
            <SortableHead field="title" sort={sort}>
              Title
            </SortableHead>
            <SortableHead field="model" sort={sort}>
              Model(s)
            </SortableHead>
            <SortableHead field="input" sort={sort} className="text-right">
              Input
            </SortableHead>
            <SortableHead field="output" sort={sort} className="text-right">
              Output
            </SortableHead>
            <SortableHead field="cacheWrite" sort={sort} className="text-right">
              Cache-write
            </SortableHead>
            <SortableHead field="cacheRead" sort={sort} className="text-right">
              Cache-read
            </SortableHead>
            <SortableHead field="total" sort={sort} className="text-right">
              Total
            </SortableHead>
            <SortableHead field="cost" sort={sort} className="text-right">
              Cost
            </SortableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.map((row) => (
            <ConversationRow key={row.id} row={row} />
          ))}
        </TableBody>

        <TableFooter>
          <TableRow>
            <TableCell colSpan={3} className="font-medium">
              {rows.length} conversation{rows.length === 1 ? "" : "s"}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatTokens(total.tokens.input)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatTokens(total.tokens.output)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatTokens(total.tokens.cacheWrite)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatTokens(total.tokens.cacheRead)}
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
  );
}

/** A header cell that links to the toggled sort + shows the active arrow. */
function SortableHead({
  field,
  sort,
  className,
  children,
}: {
  field: SortableField;
  sort: SortState;
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
        href={sortHref(field, sort)}
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

