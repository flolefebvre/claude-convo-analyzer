"use client";

// The daily-spend chart (issue #41): one stacked area band per priced model,
// over the selected range. A client component because Recharts renders in the
// browser — but a LEAF one: it receives the already-shaped `TrendsView` pieces
// as plain serializable props and computes nothing about the data itself
// (ADR-0002: no core import, no fetching, no filtering here).
//
// Bands come in cost order, so the biggest spender sits at the bottom of the
// stack; each band's color is fixed per model by the view (shadcn chart CSS
// variables, which resolve per theme — dark mode needs no branch here).

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { formatCompactTokens, formatCost, formatCount, formatModelName, formatTokens } from "@/app/_lib/format";
import type { TrendsBand, TrendsPoint } from "@/app/_lib/trends";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

/**
 * The stacked daily-spend area chart. Keyboard: Tab focuses it, the arrow keys
 * walk the days and show each day's tooltip.
 *
 * @example <TrendsChart bands={view.bands} points={view.points} description="30 days, $84.87 in total." />
 */
export function TrendsChart({
  bands,
  points,
  description,
}: {
  /** Bands in stack order (cost descending) — the first one sits at the bottom. */
  bands: TrendsBand[];
  /** One point per day of the range, ascending and contiguous. */
  points: TrendsPoint[];
  /** The chart's accessible description (its SVG `<desc>`). */
  description: string;
}) {
  // Labels ONLY — deliberately no `color` here. A config entry that carries a
  // color makes `ChartContainer` emit a `--color-<key>` custom property, and
  // the key would be a model string: external input, dash-only on the Anthropic
  // API but `anthropic.claude-…-v1:0` on Bedrock/Vertex, whose dots and colons
  // are invalid in a CSS identifier — those bands would render colorless. Each
  // band's color is applied directly from `band.color` below instead.
  const config: ChartConfig = Object.fromEntries(bands.map((band) => [band.model, { label: band.model }]));

  // Above a few dollars a day the ticks land on whole dollars, so their cents
  // would only ever read ".00".
  const wholeDollars = Math.max(0, ...points.map((point) => point.costUsd)) >= 4;

  return (
    <ChartContainer config={config} className="h-[320px] w-full">
      {/* The points go to Recharts as they are — each band reads its own cost
          through a `dataKey` accessor, so the row keeps its typed shape (and
          the tooltip gets the whole point, token split included). */}
      <AreaChart
        data={points}
        accessibilityLayer
        title="Daily spend by model"
        desc={description}
        margin={{ left: 0, right: 8 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={wholeDollars ? 44 : 56}
          allowDecimals={!wholeDollars}
          tickFormatter={(value: number) => (wholeDollars ? `$${formatCount(value)}` : formatCost(value))}
        />
        <ChartTooltip content={<TrendsTooltip bands={bands} />} />
        {bands.map((band) => (
          <Area
            key={band.model}
            dataKey={(point: TrendsPoint) => point.models[band.model] ?? 0}
            name={formatModelName(band.model)}
            stackId="cost"
            // Straight segments between days: a spline would bow through the
            // zero-filled days and imply spend that never happened.
            type="linear"
            stroke={band.color}
            fill={band.color}
            fillOpacity={0.28}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}

/**
 * The day tooltip: every band that ran that day with its cost (descending),
 * the day's total, and the day's token split across ALL models — including
 * unpriced usage, which has no band but did consume tokens.
 */
function TrendsTooltip({
  active,
  payload,
  bands,
}: React.ComponentProps<typeof ChartTooltipContent> & { bands: TrendsBand[] }) {
  // Every payload entry carries the same source point; one read is enough.
  const point = payload?.[0]?.payload as TrendsPoint | undefined;
  if (active !== true || point === undefined) return null;

  const spent = bands
    .map((band) => ({ band, costUsd: point.models[band.model] ?? 0 }))
    .filter((entry) => entry.costUsd > 0)
    .sort((a, b) => b.costUsd - a.costUsd);

  const { input, output, cacheWrite, cacheRead, total } = point.tokens;

  return (
    <div className="grid min-w-52 gap-1.5 rounded-lg border bg-background px-2.5 py-2 text-xs shadow-xl">
      <p className="font-medium">{point.label}</p>

      {spent.length === 0 ? (
        <p className="text-muted-foreground">No priced usage</p>
      ) : (
        <div className="grid gap-1">
          {spent.map(({ band, costUsd }) => (
            <div key={band.model} className="flex items-center gap-2">
              <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: band.color }} />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{formatModelName(band.model)}</span>
              <span className="font-medium">{formatCost(costUsd)}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 border-t pt-1">
            <span className="flex-1">Total</span>
            <span className="font-semibold text-cost-foreground">{formatCost(point.costUsd)}</span>
          </div>
        </div>
      )}

      <div className="border-t pt-1 text-muted-foreground">
        {total === 0 ? (
          <p>No usage</p>
        ) : (
          /* The day's total, then its split: one label/value pair per line, values right-aligned. */
          <dl className="grid grid-cols-[1fr_auto] gap-x-4">
            <dt>Tokens</dt>
            <dd className="text-right text-foreground" title={formatTokens(total)}>
              {formatCompactTokens(total)}
            </dd>
            <TokenSplit label="Input" value={input} />
            <TokenSplit label="Output" value={output} />
            <TokenSplit label="Cache write" value={cacheWrite} />
            <TokenSplit label="Cache read" value={cacheRead} />
          </dl>
        )}
      </div>
    </div>
  );
}

/** One label/value pair of the tooltip's token split. */
function TokenSplit({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="pl-2">{label}</dt>
      <dd className="text-right">{formatCompactTokens(value)}</dd>
    </>
  );
}
