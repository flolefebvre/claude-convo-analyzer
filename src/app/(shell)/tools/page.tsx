// Tools — per-tool call analytics (issue #42). A React Server Component: it
// reads the active range + folder scope + sort + expanded row from
// `searchParams`, fetches the per-tool rollup through the cached app-zone
// reader, and renders a sortable table. "Which tools do I use, which ones fail,
// and which ones flood my context?" — one row per tool name, sub-agent calls
// included.
//
// Range, scope, sort and row expansion are all URL state via links — no
// front-end filtering, exactly like the conversation list and Trends. The pure
// URL-state logic lives in `@/app/_lib/tools`.
//
// ADR-0002 boundary: the core reads are reached through `loadToolStats` /
// `loadToolCallSamples` (app-zone), never a direct core import.
//
// `cacheComponents` (PPR) is on, so the request-time `searchParams` read is
// wrapped in <Suspense>: the page shell prerenders, the table streams in.

import Link from "next/link";
import { Suspense } from "react";

import { RangePicker } from "@/app/_components/range-picker";
import { ToolRow } from "@/app/_components/tool-row";
import { loadToolCallSamples, loadToolStats } from "@/app/_lib/conversations";
import { formatChars } from "@/app/_lib/format";
import { rangeDays, resolveRange } from "@/app/_lib/range";
import { firstParam } from "@/app/_lib/search-params";
import { resolveExpanded } from "@/app/_lib/sort";
import {
  type ToolSortField,
  type ToolsViewState,
  resolveToolSort,
  sortTools,
  toolExpandHref,
  toolRangeHref,
  toolSortHref,
  toolSortIndicator,
} from "@/app/_lib/tools";
import type { ToolStats } from "@/core/tool-stats";
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
};

export default function Page({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  return (
    <Suspense
      fallback={<p className="text-sm text-muted-foreground">Loading tools…</p>}
    >
      <ToolsSurface searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * Reads the active range/scope/sort/expanded row from `searchParams` and the
 * rollup from the cached app-zone reader, then renders the surface. Kept
 * separate from {@link Page} so the request-time fetch sits inside the page's
 * <Suspense> boundary (PPR).
 */
async function ToolsSurface({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  const params = await searchParams;
  // URL → resolved intent at the page edge; the seam takes intent, never raw
  // searchParams. Every axis defaults safely (30 days, all Projects, calls ↓).
  const state: ToolsViewState = {
    sort: resolveToolSort(params.sortBy, params.dir),
    folder: firstParam(params.folder) || undefined,
    range: resolveRange(params.range),
    expanded: resolveExpanded(params.expanded),
  };

  const days = rangeDays(state.range);
  const stats = await loadToolStats(state.folder, days);
  const rows = sortTools(stats.tools, state.sort);

  // Fetch the expanded tool's drill-down server-side — only when that row is
  // actually visible in the current view (a stale `?expanded=` is ignored).
  const expandedRow = state.expanded
    ? rows.find((row) => row.name === state.expanded)
    : undefined;
  const expandedSamples = expandedRow
    ? await loadToolCallSamples(expandedRow.name, state.folder, days)
    : null;

  return (
    <section aria-label="Tool calls" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Tool calls</h2>
          <p className="text-sm text-muted-foreground">
            Which tools you use, which ones fail, and which ones flood your
            context.
          </p>
        </div>
        <RangePicker
          active={state.range}
          hrefFor={(preset) => toolRangeHref(preset, state)}
        />
      </div>

      <StatsRow stats={stats} />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-16 text-center">
          <p className="text-sm text-muted-foreground">
            No tool calls in this range.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Tool
                  </span>
                </TableHead>
                <SortableHead field="calls" state={state}>
                  Calls
                </SortableHead>
                <SortableHead field="errorRate" state={state}>
                  Errors
                </SortableHead>
                <PlainHead>Mean</PlainHead>
                <PlainHead>p50</PlainHead>
                <PlainHead>p95</PlainHead>
                <PlainHead>Largest</PlainHead>
                <SortableHead field="volume" state={state}>
                  Volume
                </SortableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {rows.map((tool) => (
                <ToolRow
                  key={tool.name}
                  tool={tool}
                  expanded={tool.name === expandedRow?.name}
                  samples={
                    tool.name === expandedRow?.name ? expandedSamples : null
                  }
                  toggleHref={toolExpandHref(tool.name, state)}
                />
              ))}
            </TableBody>

            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">
                  {rows.length} tool{rows.length === 1 ? "" : "s"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {stats.totalCalls}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {stats.totalErrors}
                </TableCell>
                <TableCell colSpan={4} />
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatChars(stats.totalSize)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </section>
  );
}

/**
 * The range headline: how much tool work ran, how much of it failed, and how
 * many characters it poured into the context. Echoes the Trends stat cards.
 */
function StatsRow({ stats }: { stats: ToolStats }) {
  const errorRate =
    stats.totalCalls === 0 ? 0 : (stats.totalErrors / stats.totalCalls) * 100;
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <StatCard label="Tool calls" value={stats.totalCalls.toLocaleString()}>
        {stats.tools.length} distinct tool{stats.tools.length === 1 ? "" : "s"}
      </StatCard>
      <StatCard
        label="Errors"
        value={stats.totalErrors.toLocaleString()}
        tone={stats.totalErrors > 0 ? "error" : undefined}
      >
        {errorRate.toFixed(1)}% of calls
      </StatCard>
      <StatCard label="Result volume" value={formatChars(stats.totalSize)}>
        characters returned to the context
      </StatCard>
    </div>
  );
}

/** One stat card of the headline row. */
function StatCard({
  label,
  value,
  tone,
  children,
}: {
  label: string;
  value: string;
  /** `error` paints the number in the destructive hue. */
  tone?: "error";
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={`mt-2 text-3xl font-semibold tabular-nums ${
          tone === "error" ? "text-destructive" : ""
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{children}</p>
    </div>
  );
}

/** A right-aligned header cell for a column that is not sortable. */
function PlainHead({ children }: { children: React.ReactNode }) {
  return (
    <TableHead className="text-right">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {children}
      </span>
    </TableHead>
  );
}

/** A header cell that links to the toggled sort + shows the active arrow. */
function SortableHead({
  field,
  state,
  children,
}: {
  field: ToolSortField;
  state: ToolsViewState;
  children: React.ReactNode;
}) {
  const indicator = toolSortIndicator(field, state.sort);
  const isActive = state.sort.sortBy === field;
  const ariaSort = isActive
    ? state.sort.dir === "asc"
      ? "ascending"
      : "descending"
    : "none";
  return (
    <TableHead className="text-right" aria-sort={ariaSort}>
      <Link
        href={toolSortHref(field, state)}
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
