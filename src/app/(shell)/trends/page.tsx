// Trends — daily spend, stacked by model (issue #41). A React Server Component:
// it reads the active range + folder scope from `searchParams`, fetches the
// per-day/per-model rollup through the cached app-zone reader, and renders the
// stats row (which doubles as the chart legend) above the chart. Range and
// scope are URL state via links — no front-end filtering, exactly like the
// conversation list.
//
// ADR-0002 boundary: the core read is reached through `loadDailySpend`
// (app-zone) and shaped by the pure `buildTrendsView`; the only client
// component here is the chart leaf, which receives plain serializable props.
//
// `cacheComponents` (PPR) is on, so the request-time `searchParams` read is
// wrapped in <Suspense>: the page shell prerenders, the chart streams in.

import Link from "next/link";
import { Suspense } from "react";

import { CostBar } from "@/app/_components/cost-bar";
import { TrendsChart } from "@/app/_components/trends-chart";
import { loadDailySpend } from "@/app/_lib/conversations";
import {
  formatCompactTokens,
  formatGrandTotalCost,
  formatTokens,
} from "@/app/_lib/format";
import {
  RANGE_PRESETS,
  type TrendsRange,
  type TrendsView,
  buildTrendsView,
  rangeDays,
  rangeHref,
  resolveRange,
} from "@/app/_lib/trends";
import { Button } from "@/components/ui/button";

type PageSearchParams = {
  range?: string | string[];
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
      fallback={<p className="text-sm text-muted-foreground">Loading trends…</p>}
    >
      <TrendsSurface searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * Reads the active range + scope from `searchParams` and the daily rollup from
 * the cached app-zone reader, then renders the surface. Kept separate from
 * {@link Page} so the request-time fetch sits inside the page's <Suspense>
 * boundary (PPR).
 */
async function TrendsSurface({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  const params = await searchParams;
  // URL → resolved intent at the page edge; the seam takes intent, never raw
  // searchParams. Both default safely (30 days, all Projects).
  const range = resolveRange(params.range);
  const folder = firstParam(params.folder) || undefined;

  const view = buildTrendsView(await loadDailySpend(folder, rangeDays(range)));

  return (
    <section aria-label="Daily spend" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Daily spend</h2>
          <p className="text-sm text-muted-foreground">
            What Claude Code cost per day, split by model.
          </p>
        </div>
        <RangePicker active={range} folder={folder} />
      </div>

      <StatsRow view={view} />

      <div className="rounded-xl border bg-card p-5">
        {view.isEmpty ? (
          <p className="py-16 text-center text-sm text-muted-foreground">
            No priced usage in this range.
          </p>
        ) : (
          <TrendsChart bands={view.bands} points={view.points} />
        )}
      </div>
    </section>
  );
}

/** The range presets, as scope-preserving links styled like a segmented control. */
function RangePicker({
  active,
  folder,
}: {
  active: TrendsRange;
  /** The active `?folder=` scope, threaded so changing range keeps the scope. */
  folder?: string;
}) {
  return (
    <nav aria-label="Range" className="flex items-center gap-1">
      {RANGE_PRESETS.map((preset) => (
        <Button
          key={preset.value}
          asChild
          size="sm"
          variant={preset.value === active ? "secondary" : "ghost"}
        >
          <Link
            href={rangeHref(preset.value, folder)}
            aria-current={preset.value === active ? "true" : undefined}
          >
            {preset.label}
          </Link>
        </Button>
      ))}
    </nav>
  );
}

/**
 * The range stats: total cost and tokens, then one row per model — which IS the
 * chart legend (same color, same order), so the chart needs none of its own.
 * Echoes the overview band's stat-card language, including how an inexact total
 * is flagged as a lower bound.
 */
function StatsRow({ view }: { view: TrendsView }) {
  const cost = formatGrandTotalCost(view.totalCostUsd);
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="rounded-xl border bg-card p-5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Range cost
        </p>
        <p className="mt-2 text-3xl font-semibold tabular-nums text-cost">
          {view.isApproximate ? (
            <span
              title={
                view.hasUnpriced
                  ? "Includes unpriced model usage — this total is a lower bound."
                  : "Includes usage on a bare model alias — priced at the family rate."
              }
            >
              ~{cost}
            </span>
          ) : (
            cost
          )}
        </p>
      </div>

      <div className="rounded-xl border bg-card p-5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Tokens
        </p>
        <p className="mt-2 text-3xl font-semibold tabular-nums">
          {formatCompactTokens(view.totalTokens.total)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatTokens(view.totalTokens.total)} total
        </p>
      </div>

      <ModelLegend view={view} />
    </div>
  );
}

/** Per-model totals for the range — the chart's legend, cost-ranked. */
function ModelLegend({ view }: { view: TrendsView }) {
  return (
    <div className="rounded-xl border bg-card p-5 lg:col-span-1">
      <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        By model
      </p>
      {view.bands.length === 0 ? (
        <p className="text-sm text-muted-foreground">No priced usage.</p>
      ) : (
        // Two lines per model — the full name never truncates, and the bar
        // reads as its share of the range, as in the sidebar and detail panel.
        <ul className="flex flex-col gap-2.5">
          {view.bands.map((band) => (
            <li key={band.model} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: band.color }}
                  />
                  <span className="truncate" title={band.model}>
                    {band.model}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {formatGrandTotalCost(band.costUsd)}
                </span>
              </div>
              <CostBar
                value={band.costUsd}
                max={view.totalCostUsd}
                className="mt-1.5"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
