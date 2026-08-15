import Link from "next/link";
import { Suspense } from "react";

import { RangePicker } from "@/app/_components/range-picker";
import { ToolRow } from "@/app/_components/tool-row";
import { loadToolCallSamples, loadToolStats } from "@/app/_lib/conversations";
import { formatChars } from "@/app/_lib/format";
import { rangeDays, resolveRange } from "@/app/_lib/range";
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
  toolSortIndicator,
} from "@/app/_lib/tools";
import type { ToolStats } from "@/core/tool-stats";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export default function Page({ searchParams }: { searchParams: Promise<ViewSearchParams> }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading tools…</p>}>
      <ToolsSurface searchParams={searchParams} />
    </Suspense>
  );
}

async function ToolsSurface({ searchParams }: { searchParams: Promise<ViewSearchParams> }) {
  const params = await searchParams;
  const state: ToolsViewState = {
    sort: resolveToolSort(params.sortBy, params.dir),
    folder: firstParam(params.folder) || undefined,
    range: resolveRange(params.range),
    expanded: resolveExpanded(params.expanded),
  };

  const days = rangeDays(state.range);
  const stats = await loadToolStats(state.folder, days);
  const rows = sortTools(stats.tools, state.sort);

  const expandedRow = state.expanded ? rows.find((row) => row.name === state.expanded) : undefined;
  const expandedSamples = expandedRow ? await loadToolCallSamples(expandedRow.name, state.folder, days) : null;

  return (
    <section aria-label="Tool calls" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Tool calls</h2>
          <p className="text-sm text-muted-foreground">
            Which tools you use, which ones fail, and which ones flood your context.
          </p>
        </div>
        <RangePicker active={state.range} hrefFor={(preset) => toolRangeHref(preset, state)} />
      </div>

      <StatsRow stats={stats} />

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-16 text-center">
          <p className="text-sm text-muted-foreground">No tool calls in this range.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Tool</span>
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
                  samples={tool.name === expandedRow?.name ? expandedSamples : null}
                  toggleHref={toolExpandHref(tool.name, state)}
                />
              ))}
            </TableBody>

            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">
                  {rows.length} tool{rows.length === 1 ? "" : "s"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{stats.totalCalls}</TableCell>
                <TableCell className="text-right tabular-nums">{stats.totalErrors}</TableCell>
                <TableCell colSpan={4} />
                <TableCell className="text-right font-semibold tabular-nums">{formatChars(stats.totalSize)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </section>
  );
}

function StatsRow({ stats }: { stats: ToolStats }) {
  const errorRate = stats.totalCalls === 0 ? 0 : (stats.totalErrors / stats.totalCalls) * 100;
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

function StatCard({
  label,
  value,
  tone,
  children,
}: {
  label: string;
  value: string;
  tone?: "error";
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={`mt-2 text-3xl font-semibold tabular-nums ${tone === "error" ? "text-destructive" : ""}`}>
        {value}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{children}</p>
    </div>
  );
}

function PlainHead({ children }: { children: React.ReactNode }) {
  return (
    <TableHead className="text-right">
      <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{children}</span>
    </TableHead>
  );
}

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
  const ariaSort = isActive ? (state.sort.dir === "asc" ? "ascending" : "descending") : "none";
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
