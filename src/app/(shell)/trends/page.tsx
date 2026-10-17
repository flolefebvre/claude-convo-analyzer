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
// wrapped in <Suspense>: the header prerenders, the range picker and the chart
// stream in behind their skeletons.

import { ChartNoAxesColumn } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { CostBar } from "@/app/_components/cost-bar";
import { EmptyState, EmptyStateLink } from "@/app/_components/empty-state";
import { LoadingRegion } from "@/app/_components/loading-region";
import { PageHeader } from "@/app/_components/page-header";
import { RangePicker, RangePickerFallback } from "@/app/_components/range-picker";
import { RefreshButton } from "@/app/_components/refresh-button";
import { Stat, StatSkeleton, StatStrip } from "@/app/_components/stat-strip";
import { TrendsChart } from "@/app/_components/trends-chart";
import { loadDailySpend } from "@/app/_lib/conversations";
import {
  formatCompactTokens,
  formatCost,
  formatGrandTotalCost,
  formatModelName,
  formatTokens,
} from "@/app/_lib/format";
import { type RangeKey, rangeDays, rangeHref, rangePhrase, resolveRange } from "@/app/_lib/range";
import { type ViewSearchParams, firstParam } from "@/app/_lib/search-params";
import { type TrendsView, buildTrendsView } from "@/app/_lib/trends";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Trends" };

export default function Page({ searchParams }: { searchParams: Promise<ViewSearchParams> }) {
  return (
    <div className="flex flex-col gap-5">
      {/* The header is static; the range picker builds its hrefs from the URL,
          so it streams in its own boundary, ahead of the data. */}
      <PageHeader title="Trends" description="What Claude Code cost per day, split by model.">
        <Suspense fallback={<RangePickerFallback />}>
          <TrendsRangePicker searchParams={searchParams} />
        </Suspense>
      </PageHeader>
      <Suspense fallback={<TrendsFallback />}>
        <TrendsSurface searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

/**
 * URL → resolved intent at the page edge; the seam takes intent, never raw
 * searchParams. Both default safely (30 days, all Projects).
 */
async function resolveTrendsState(
  searchParams: Promise<ViewSearchParams>,
): Promise<{ range: RangeKey; folder: string | undefined }> {
  const params = await searchParams;
  return { range: resolveRange(params.range), folder: firstParam(params.folder) || undefined };
}

/** The range presets, each keeping the folder scope. */
async function TrendsRangePicker({ searchParams }: { searchParams: Promise<ViewSearchParams> }) {
  const { range, folder } = await resolveTrendsState(searchParams);
  return <RangePicker active={range} hrefFor={(preset) => rangeHref(preset, folder)} />;
}

/** The legend rows its skeleton draws: about as many models as a typical range has. */
const SKELETON_MODELS = 3;

/**
 * The surface's skeleton: the two-cell stat strip beside the model legend,
 * then the chart card at the chart's height.
 */
function TrendsFallback() {
  return (
    <LoadingRegion label="Loading trends" className="flex flex-col gap-5">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-1">
          <StatSkeleton />
          <StatSkeleton />
        </div>
        <div className="rounded-xl border bg-card px-4 py-3">
          <div className="mb-2.5 flex h-5 items-center">
            <Skeleton className="h-3.5 w-16" />
          </div>
          <div className="flex flex-col gap-2.5">
            {Array.from({ length: SKELETON_MODELS }, (_, index) => (
              <div key={index}>
                <div className="flex h-5 items-center justify-between">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3.5 w-14" />
                </div>
                <Skeleton className="mt-1.5 h-1.5 w-full rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="mb-3 flex h-5 items-center">
          <Skeleton className="h-3.5 w-24" />
        </div>
        <Skeleton className="h-[320px] w-full" />
      </div>
    </LoadingRegion>
  );
}

/**
 * Reads the active range + scope from `searchParams` and the daily rollup from
 * the cached app-zone reader, then renders the surface. Kept separate from
 * {@link Page} so the request-time fetch sits inside the page's <Suspense>
 * boundary (PPR).
 */
async function TrendsSurface({ searchParams }: { searchParams: Promise<ViewSearchParams> }) {
  const { range, folder } = await resolveTrendsState(searchParams);

  const view = buildTrendsView(await loadDailySpend(folder, rangeDays(range)));

  return (
    <div className="flex flex-col gap-5">
      {view.isEmpty ? (
        <EmptyTrends range={range} folder={folder} />
      ) : (
        <>
          <StatsRow view={view} />
          <SpendFigure view={view} />
        </>
      )}
    </div>
  );
}

/**
 * Nothing priced in the range, and the widest way out: a longer range, then
 * every folder, then — with no usage at all — the first scan.
 */
function EmptyTrends({ range, folder }: { range: RangeKey; folder: string | undefined }) {
  const [description, action] =
    range !== "all"
      ? [
          "Try a longer range.",
          <EmptyStateLink key="all" href={rangeHref("all", folder)}>
            Show all time
          </EmptyStateLink>,
        ]
      : folder
        ? [
            "This folder has no priced usage.",
            <EmptyStateLink key="folders" href={rangeHref("all")}>
              Show all folders
            </EmptyStateLink>,
          ]
        : ["Scan your Claude Code logs to see what they cost.", <RefreshButton key="refresh" />];
  return (
    <EmptyState icon={ChartNoAxesColumn} title={`No priced usage ${rangePhrase(range)}`} action={action}>
      {description}
    </EmptyState>
  );
}

/**
 * The range stats: total cost and tokens beside the per-model breakdown, which
 * IS the chart legend (same colors, same order), so the chart needs none of its
 * own. An inexact total carries the `~` and the line under the row explains it.
 */
function StatsRow({ view }: { view: TrendsView }) {
  const cost = formatGrandTotalCost(view.totalCostUsd);
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Side by side on a phone, stacked beside the legend from `lg`. */}
        <StatStrip className="grid-cols-2 lg:grid-cols-1">
          <Stat
            label="Range cost"
            hint={view.hasUnpriced ? "Lower bound" : view.isApproximate ? "Estimate" : "At API list prices"}
          >
            <span className="text-cost-foreground">{view.isApproximate ? `~${cost}` : cost}</span>
          </Stat>
          <Stat label="Tokens" hint={`${formatTokens(view.totalTokens.total)} total`}>
            {formatCompactTokens(view.totalTokens.total)}
          </Stat>
        </StatStrip>
        <ModelLegend view={view} />
      </div>
      {view.isApproximate && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">~</span>{" "}
          {view.hasUnpriced
            ? "marks a lower bound: some usage is on a model without a known price, counted as $0."
            : "marks an estimate: some usage is on a bare model alias, priced at its family's rate."}
        </p>
      )}
    </div>
  );
}

/** Per-model totals for the range — the chart's legend, cost-ranked. */
function ModelLegend({ view }: { view: TrendsView }) {
  return (
    <section aria-labelledby="by-model" className="rounded-xl border bg-card px-4 py-3">
      <h2 id="by-model" className="mb-2.5 text-sm font-medium text-muted-foreground">
        By model
      </h2>
      {/* Each model's swatch and share bar wear its band's color; the short
          name wraps rather than clips, the full id is in its title. */}
      <ul className="flex flex-col gap-2.5">
        {view.bands.map((band) => (
          <li key={band.model} className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-baseline gap-2">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 translate-y-px rounded-[2px]"
                  style={{ backgroundColor: band.color }}
                />
                <span className="[overflow-wrap:anywhere]" title={band.model}>
                  {formatModelName(band.model)}
                </span>
              </span>
              <span className="shrink-0 text-muted-foreground">{formatGrandTotalCost(band.costUsd)}</span>
            </div>
            <CostBar value={band.costUsd} max={view.totalCostUsd} color={band.color} className="mt-1.5" />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The chart in its card, named by a visible caption, with the same figures as
 * a screen-reader table (days with spend only) for anyone who cannot see it.
 */
function SpendFigure({ view }: { view: TrendsView }) {
  const spendDays = view.points.filter((point) => point.costUsd > 0);
  const description = `${view.points.length} days, ${formatGrandTotalCost(view.totalCostUsd)} in total. A table of each day's spend follows the chart.`;
  return (
    <figure className="rounded-xl border bg-card p-4 sm:p-5">
      <figcaption className="mb-3 text-sm font-medium text-foreground">Spend per day</figcaption>
      <TrendsChart bands={view.bands} points={view.points} description={description} />
      {/* The wrapper is the clip: a table's own sr-only box does not clip its
          cells, which would widen the page on a phone. */}
      <div className="sr-only">
        <table>
          <caption>Spend per day and model, for the days with any spend</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Total</th>
              {view.bands.map((band) => (
                <th key={band.model} scope="col">
                  {formatModelName(band.model)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spendDays.map((point) => (
              <tr key={point.date}>
                <th scope="row">{point.label}</th>
                <td>{formatCost(point.costUsd)}</td>
                {view.bands.map((band) => (
                  <td key={band.model}>{formatCost(point.models[band.model] ?? 0)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
