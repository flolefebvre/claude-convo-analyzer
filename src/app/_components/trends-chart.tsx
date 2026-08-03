"use client";

// The daily-spend chart (issue #41): one stacked area band per priced model,
// over the selected range. A client component because Recharts renders in the
// browser — but a LEAF one: it receives the already-shaped `TrendsView` pieces
// as plain serializable props and computes nothing about the data itself
// (ADR-0002: no core import, no fetching, no filtering here).
//
// Bands come in cost order, so the biggest spender sits at the bottom of the
// stack; colors are the shadcn chart CSS variables, which resolve per theme —
// dark mode needs no branch here.

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { formatCompactTokens, formatCost, formatTokens } from "@/app/_lib/format";
import type { TrendsBand, TrendsPoint } from "@/app/_lib/trends";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

export function TrendsChart({
  bands,
  points,
}: {
  /** Bands in stack order (cost descending) — the first one sits at the bottom. */
  bands: TrendsBand[];
  /** One point per day of the range, ascending and contiguous. */
  points: TrendsPoint[];
}) {
  // `ChartContainer` turns each config entry into a `--color-<key>` variable.
  const config: ChartConfig = Object.fromEntries(
    bands.map((band) => [band.model, { label: band.model, color: band.color }]),
  );

  return (
    <ChartContainer config={config} className="h-[320px] w-full">
      {/* The points go to Recharts as they are — each band reads its own cost
          through a `dataKey` accessor, so the row keeps its typed shape (and
          the tooltip gets the whole point, token split included). */}
      <AreaChart data={points} accessibilityLayer margin={{ left: 4, right: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={28}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={64}
          tickFormatter={(value: number) => formatCost(value)}
        />
        <ChartTooltip content={<TrendsTooltip bands={bands} />} />
        {bands.map((band) => (
          <Area
            key={band.model}
            dataKey={(point: TrendsPoint) => point.models[band.model] ?? 0}
            name={band.model}
            stackId="cost"
            type="monotone"
            stroke={`var(--color-${band.model})`}
            fill={`var(--color-${band.model})`}
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

  return (
    <div className="grid min-w-48 gap-1.5 rounded-lg border bg-background px-2.5 py-2 text-xs shadow-xl">
      <p className="font-medium">{point.label}</p>

      {spent.length === 0 ? (
        <p className="text-muted-foreground">No priced usage</p>
      ) : (
        <div className="grid gap-1">
          {spent.map(({ band, costUsd }) => (
            <div key={band.model} className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: band.color }}
              />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {band.model}
              </span>
              <span className="tabular-nums font-medium">
                {formatCost(costUsd)}
              </span>
            </div>
          ))}
          <div className="flex items-center gap-2 border-t pt-1">
            <span className="flex-1">Total</span>
            <span className="tabular-nums font-semibold text-cost">
              {formatCost(point.costUsd)}
            </span>
          </div>
        </div>
      )}

      <div className="border-t pt-1 text-muted-foreground">
        <div className="flex items-center gap-2">
          <span className="flex-1">Tokens</span>
          <span className="tabular-nums" title={formatTokens(point.tokens.total)}>
            {formatCompactTokens(point.tokens.total)}
          </span>
        </div>
        <p className="tabular-nums">
          {formatCompactTokens(point.tokens.input)} in ·{" "}
          {formatCompactTokens(point.tokens.output)} out ·{" "}
          {formatCompactTokens(point.tokens.cacheWrite)} write ·{" "}
          {formatCompactTokens(point.tokens.cacheRead)} read
        </p>
      </div>
    </div>
  );
}
