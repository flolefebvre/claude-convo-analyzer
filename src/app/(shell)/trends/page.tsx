import { Suspense } from "react";

import { CostBar } from "@/app/_components/cost-bar";
import { RangePicker } from "@/app/_components/range-picker";
import { TrendsChart } from "@/app/_components/trends-chart";
import { loadDailySpend } from "@/app/_lib/conversations";
import { formatCompactTokens, formatGrandTotalCost, formatTokens } from "@/app/_lib/format";
import { rangeDays, rangeHref, resolveRange } from "@/app/_lib/range";
import { type ViewSearchParams, firstParam } from "@/app/_lib/search-params";
import { type TrendsView, buildTrendsView } from "@/app/_lib/trends";

export default function Page({ searchParams }: { searchParams: Promise<ViewSearchParams> }) {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading trends…</p>}>
      <TrendsSurface searchParams={searchParams} />
    </Suspense>
  );
}

async function TrendsSurface({ searchParams }: { searchParams: Promise<ViewSearchParams> }) {
  const params = await searchParams;
  const range = resolveRange(params.range);
  const folder = firstParam(params.folder) || undefined;

  const view = buildTrendsView(await loadDailySpend(folder, rangeDays(range)));

  return (
    <section aria-label="Daily spend" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Daily spend</h2>
          <p className="text-sm text-muted-foreground">What Claude Code cost per day, split by model.</p>
        </div>
        <RangePicker active={range} hrefFor={(preset) => rangeHref(preset, folder)} />
      </div>

      <StatsRow view={view} />

      <div className="rounded-xl border bg-card p-5">
        {view.isEmpty ? (
          <p className="py-16 text-center text-sm text-muted-foreground">No priced usage in this range.</p>
        ) : (
          <TrendsChart bands={view.bands} points={view.points} />
        )}
      </div>
    </section>
  );
}

function StatsRow({ view }: { view: TrendsView }) {
  const cost = formatGrandTotalCost(view.totalCostUsd);
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="rounded-xl border bg-card p-5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Range cost</p>
        <p className="mt-2 text-3xl font-semibold text-cost tabular-nums">
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
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Tokens</p>
        <p className="mt-2 text-3xl font-semibold tabular-nums">{formatCompactTokens(view.totalTokens.total)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{formatTokens(view.totalTokens.total)} total</p>
      </div>

      <ModelLegend view={view} />
    </div>
  );
}

function ModelLegend({ view }: { view: TrendsView }) {
  return (
    <div className="rounded-xl border bg-card p-5 lg:col-span-1">
      <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">By model</p>
      {view.bands.length === 0 ? (
        <p className="text-sm text-muted-foreground">No priced usage.</p>
      ) : (
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
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  {formatGrandTotalCost(band.costUsd)}
                </span>
              </div>
              <CostBar value={band.costUsd} max={view.totalCostUsd} className="mt-1.5" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
