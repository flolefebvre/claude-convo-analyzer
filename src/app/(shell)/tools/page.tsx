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
// wrapped in <Suspense>: the header prerenders, the range picker and the table
// stream in behind their skeletons.

import { Wrench } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EmptyState, EmptyStateLink } from "@/app/_components/empty-state";
import { LoadingRegion } from "@/app/_components/loading-region";
import { PageHeader } from "@/app/_components/page-header";
import { RangePicker, RangePickerFallback } from "@/app/_components/range-picker";
import { LiveRefreshButton } from "@/app/_components/live-refresh-button";
import { SortableHead } from "@/app/_components/sortable-head";
import { Stat, StatSkeleton, StatStrip } from "@/app/_components/stat-strip";
import { TOOL_COLUMNS, ToolRow } from "@/app/_components/tool-row";
import { loadToolCallSamples, loadToolStats } from "@/app/_lib/conversations";
import { formatChars, formatCount, formatRate } from "@/app/_lib/format";
import { rangeDays, rangePhrase, resolveRange } from "@/app/_lib/range";
import { type ViewSearchParams, firstParam } from "@/app/_lib/search-params";
import { resolveExpanded } from "@/app/_lib/sort";
import {
  type ToolSortField,
  type ToolsViewState,
  resolveToolSort,
  sortTools,
  toolExpandHref,
  toolRangeHref,
  toolSortHref,
} from "@/app/_lib/tools";
import type { ToolCallSamples, ToolStat, ToolStats } from "@/core/tool-stats";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils-cn";

export const metadata: Metadata = { title: "Tools" };

export default function Page({ searchParams }: { searchParams: Promise<ViewSearchParams> }) {
  return (
    <div className="flex flex-col gap-5">
      {/* The header is static; the range picker builds its hrefs from the URL,
          so it streams in its own boundary, ahead of the data. */}
      <PageHeader title="Tools" description="Which tools you use, which ones fail, and which ones flood your context.">
        <Suspense fallback={<RangePickerFallback />}>
          <ToolsRangePicker searchParams={searchParams} />
        </Suspense>
      </PageHeader>
      <Suspense fallback={<ToolsFallback />}>
        <ToolsSurface searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/**
 * URL → resolved intent at the page edge; the seam takes intent, never raw
 * searchParams. Every axis defaults safely (30 days, all Projects, calls ↓).
 */
async function resolveToolsState(searchParams: Promise<ViewSearchParams>): Promise<ToolsViewState> {
  const params = await searchParams;
  return {
    sort: resolveToolSort(params.sortBy, params.dir),
    folder: firstParam(params.folder) || undefined,
    range: resolveRange(params.range),
    expanded: resolveExpanded(params.expanded),
  };
}

/** The range presets, each keeping the folder, sort and expanded row. */
async function ToolsRangePicker({ searchParams }: { searchParams: Promise<ViewSearchParams> }) {
  const state = await resolveToolsState(searchParams);
  return <RangePicker active={state.range} hrefFor={(preset) => toolRangeHref(preset, state)} />;
}

/** The table rows its skeleton draws: about as many tools as a typical range has. */
const SKELETON_ROWS = 8;

/**
 * The surface's skeleton: the three-cell stat strip, then the table card with
 * its two-row header, a handful of rows and the footer, then the legend line.
 */
function ToolsFallback() {
  return (
    <LoadingRegion label="Loading tools" className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <StatSkeleton key={index} />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <div className="@container overflow-hidden rounded-xl border bg-card">
          <div className="flex h-[73px] items-end gap-4 border-b bg-muted/30 px-4 pb-3.5">
            <Skeleton className="h-3.5 w-10" />
            <Skeleton className="ml-auto h-3.5 w-12" />
            <Skeleton className="h-3.5 w-14" />
            <Skeleton className="h-3.5 w-14" />
          </div>
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <div key={index} className="flex h-[42px] items-center gap-4 border-b px-4">
              <Skeleton className="size-6 shrink-0" />
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="ml-auto h-3.5 w-10" />
              <Skeleton className="h-3.5 w-12" />
              <Skeleton className="h-3.5 w-14" />
            </div>
          ))}
          <div className="flex h-[37px] items-center gap-4 bg-muted/50 px-4">
            <Skeleton className="h-3.5 w-16" />
            <Skeleton className="ml-auto h-3.5 w-14" />
          </div>
        </div>
        <div className="flex h-4 items-center">
          <Skeleton className="h-3 w-72" />
        </div>
      </div>
    </LoadingRegion>
  );
}

/**
 * Reads the active range/scope/sort/expanded row from `searchParams` and the
 * rollup from the cached app-zone reader, then renders the surface. Kept
 * separate from {@link Page} so the request-time fetch sits inside the page's
 * <Suspense> boundary (PPR).
 */
async function ToolsSurface({ searchParams }: { searchParams: Promise<ViewSearchParams> }) {
  const state = await resolveToolsState(searchParams);

  const days = rangeDays(state.range);
  const stats = await loadToolStats(state.folder, days);
  const rows = sortTools(stats.tools, state.sort);

  // Fetch the expanded tool's drill-down server-side — only when that row is
  // actually visible in the current view (a stale `?expanded=` is ignored).
  const expandedRow = state.expanded ? rows.find((row) => row.name === state.expanded) : undefined;
  const expandedSamples = expandedRow ? await loadToolCallSamples(expandedRow.name, state.folder, days) : null;

  return (
    <div className="flex flex-col gap-5">
      {rows.length === 0 ? (
        <EmptyTools state={state} />
      ) : (
        <>
          <StatsRow stats={stats} />
          {/* The `@container` the columns respond to (see TOOL_COLUMNS), and
              the legend with them: it explains p95 only where that column shows. */}
          <div className="@container flex flex-col gap-2">
            <div className="overflow-hidden rounded-xl border bg-card">
              <ToolsTable rows={rows} stats={stats} state={state} expandedRow={expandedRow} samples={expandedSamples} />
            </div>
            <p className="text-xs text-muted-foreground">
              Sizes count the characters a call returned to the context.
              <span className="hidden @xl:inline">
                {" "}
                <span className="font-medium text-foreground">p95</span> is the size 95% of a tool&apos;s calls stay
                under.
              </span>
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The per-tool table: a two-row header groups the result-size columns under
 * their unit, the rows, and the range totals in the footer.
 */
function ToolsTable({
  rows,
  stats,
  state,
  expandedRow,
  samples,
}: {
  rows: ToolStat[];
  stats: ToolStats;
  state: ToolsViewState;
  expandedRow: ToolStat | undefined;
  samples: ToolCallSamples | null;
}) {
  // One request-time `now` for every relative date in the drill-down.
  const now = new Date();
  const sortOf = (field: ToolSortField) => (state.sort.sortBy === field ? state.sort.dir : null);
  const totalRate = stats.totalCalls === 0 ? 0 : stats.totalErrors / stats.totalCalls;
  const groupHead = "h-8 pt-2 pr-4 pb-0 text-right align-bottom";

  return (
    <Table className="table-fixed">
      <TableHeader className="bg-muted/30">
        <TableRow className="hover:bg-transparent">
          <TableHead rowSpan={2} className={cn(TOOL_COLUMNS.tool, "align-bottom")}>
            <span className="flex h-10 items-center micro-label text-muted-foreground">Tool</span>
          </TableHead>
          <SortableHead
            rowSpan={2}
            href={toolSortHref("calls", state)}
            sort={sortOf("calls")}
            align="right"
            className={cn(TOOL_COLUMNS.calls, "align-bottom")}
          >
            Calls
          </SortableHead>
          <TableHead rowSpan={2} className={cn(TOOL_COLUMNS.errors, "text-right align-bottom")}>
            <span className="flex h-10 items-center justify-end micro-label text-muted-foreground">Errors</span>
          </TableHead>
          <SortableHead
            rowSpan={2}
            href={toolSortHref("errorRate", state)}
            sort={sortOf("errorRate")}
            align="right"
            className={cn(TOOL_COLUMNS.errorRate, "align-bottom")}
          >
            {/* The count column is hidden in a narrow table, so the rate is "the" errors column there. */}
            <span className="@xl:hidden">Errors</span>
            <span className="hidden @xl:inline">Error rate</span>
          </SortableHead>
          {/* The size columns' unit, over as many of them as the width shows
              (a span must never cover a hidden cell, so one variant per layout).
              A fixed table sizes its columns from this first row, so each
              variant carries the summed width of the columns it spans. */}
          <TableHead colSpan={5} className={cn("hidden w-[26rem] @3xl:table-cell", groupHead)}>
            <GroupLabel>Result size, chars</GroupLabel>
          </TableHead>
          <TableHead colSpan={2} className={cn("hidden w-44 @xl:table-cell @3xl:hidden", groupHead)}>
            <GroupLabel>Result size, chars</GroupLabel>
          </TableHead>
          <TableHead className={cn("w-20 @xl:hidden", groupHead)}>
            <GroupLabel>Chars</GroupLabel>
          </TableHead>
        </TableRow>
        <TableRow className="hover:bg-transparent">
          <SizeHead className={TOOL_COLUMNS.mean}>Mean</SizeHead>
          <SizeHead className={TOOL_COLUMNS.p50}>p50</SizeHead>
          <SizeHead className={TOOL_COLUMNS.p95} emphasis>
            p95
          </SizeHead>
          <SizeHead className={TOOL_COLUMNS.largest}>Largest</SizeHead>
          {/* The th's inset plus the link's own px-2 make the card's inset. */}
          <SortableHead
            href={toolSortHref("volume", state)}
            sort={sortOf("volume")}
            align="right"
            className={cn(TOOL_COLUMNS.volume, "pr-2")}
          >
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
            samples={tool.name === expandedRow?.name ? samples : null}
            toggleHref={toolExpandHref(tool.name, state)}
            now={now}
          />
        ))}
      </TableBody>

      <TableFooter>
        <TableRow className="hover:bg-transparent">
          <TableCell className={TOOL_COLUMNS.tool}>
            {rows.length} tool{rows.length === 1 ? "" : "s"}
          </TableCell>
          <TableCell className={cn(TOOL_COLUMNS.calls, "text-right")}>{formatCount(stats.totalCalls)}</TableCell>
          <TableCell className={cn(TOOL_COLUMNS.errors, "text-right")}>{formatCount(stats.totalErrors)}</TableCell>
          <TableCell className={cn(TOOL_COLUMNS.errorRate, "text-right")}>{formatRate(totalRate)}</TableCell>
          <TableCell className={TOOL_COLUMNS.mean} />
          <TableCell className={TOOL_COLUMNS.p50} />
          <TableCell className={TOOL_COLUMNS.p95} />
          <TableCell className={TOOL_COLUMNS.largest} />
          <TableCell className={cn(TOOL_COLUMNS.volume, "text-right font-semibold")}>
            {formatChars(stats.totalSize, { fixed: true })}
          </TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

/** The unit over the size columns, ruled off from the labels under it. */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return <span className="block border-b pb-1 micro-label text-muted-foreground">{children}</span>;
}

/** A right-aligned header for a size column that is not sortable; p95 carries the emphasis its figures do. */
function SizeHead({
  className,
  emphasis = false,
  children,
}: {
  className: string;
  emphasis?: boolean;
  children: React.ReactNode;
}) {
  return (
    <TableHead className={cn(className, "text-right")}>
      <span className={cn("micro-label", emphasis ? "text-foreground" : "text-muted-foreground")}>{children}</span>
    </TableHead>
  );
}

/**
 * No tool calls in the range, and the widest way out: a longer range, then
 * every folder, then — with nothing recorded at all — the first scan.
 */
function EmptyTools({ state }: { state: ToolsViewState }) {
  const [description, action] =
    state.range !== "all"
      ? [
          "Try a longer range.",
          <EmptyStateLink key="all" href={toolRangeHref("all", state)}>
            Show all time
          </EmptyStateLink>,
        ]
      : state.folder
        ? [
            "No tool calls were recorded in this folder.",
            <EmptyStateLink key="folders" href={toolRangeHref("all", { ...state, folder: undefined })}>
              Show all folders
            </EmptyStateLink>,
          ]
        : ["Scan your Claude Code logs to see the tools Claude used.", <LiveRefreshButton key="refresh" />];
  return (
    <EmptyState icon={Wrench} title={`No tool calls ${rangePhrase(state.range)}`} action={action}>
      {description}
    </EmptyState>
  );
}

/**
 * The range headline: how much tool work ran, how much of it failed, and how
 * many characters it poured into the context.
 */
function StatsRow({ stats }: { stats: ToolStats }) {
  const errorRate = stats.totalCalls === 0 ? 0 : stats.totalErrors / stats.totalCalls;
  return (
    <StatStrip className="grid-cols-1 sm:grid-cols-3">
      <Stat label="Tool calls" hint={`${stats.tools.length} distinct tool${stats.tools.length === 1 ? "" : "s"}`}>
        {formatCount(stats.totalCalls)}
      </Stat>
      <Stat label="Errors" hint={`${formatRate(errorRate)} of calls`}>
        <span className={stats.totalErrors > 0 ? "text-destructive-foreground" : undefined}>
          {formatCount(stats.totalErrors)}
        </span>
      </Stat>
      <Stat label="Result volume" hint="Characters returned to the context">
        {formatChars(stats.totalSize)}
      </Stat>
    </StatStrip>
  );
}
