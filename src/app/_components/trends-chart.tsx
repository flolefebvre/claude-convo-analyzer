"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { formatCompactTokens, formatCost, formatTokens } from "@/app/_lib/format";
import type { TrendsBand, TrendsPoint } from "@/app/_lib/trends";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

export function TrendsChart({ bands, points }: { bands: TrendsBand[]; points: TrendsPoint[] }) {
  const config: ChartConfig = Object.fromEntries(bands.map((band) => [band.model, { label: band.model }]));

  return (
    <ChartContainer config={config} className="h-[320px] w-full">
      <AreaChart data={points} accessibilityLayer margin={{ left: 4, right: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} />
        <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(value: number) => formatCost(value)} />
        <ChartTooltip content={<TrendsTooltip bands={bands} />} />
        {bands.map((band) => (
          <Area
            key={band.model}
            dataKey={(point: TrendsPoint) => point.models[band.model] ?? 0}
            name={band.model}
            stackId="cost"
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

function TrendsTooltip({
  active,
  payload,
  bands,
}: React.ComponentProps<typeof ChartTooltipContent> & { bands: TrendsBand[] }) {
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
              <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: band.color }} />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{band.model}</span>
              <span className="font-medium tabular-nums">{formatCost(costUsd)}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 border-t pt-1">
            <span className="flex-1">Total</span>
            <span className="font-semibold text-cost tabular-nums">{formatCost(point.costUsd)}</span>
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
          {formatCompactTokens(point.tokens.input)} in · {formatCompactTokens(point.tokens.output)} out ·{" "}
          {formatCompactTokens(point.tokens.cacheWrite)} write · {formatCompactTokens(point.tokens.cacheRead)} read
        </p>
      </div>
    </div>
  );
}
