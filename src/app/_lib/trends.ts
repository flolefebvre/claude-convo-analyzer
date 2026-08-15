import type { Tokens } from "@/core/cost";
import type { DailySpend } from "@/core/read";
import { formatDayKey } from "@/app/_lib/format";

export type TrendsBand = {
  model: string;
  color: string;
  costUsd: number;
  tokensTotal: number;
  share: number;
};

export type TrendsPoint = {
  date: string;
  label: string;
  costUsd: number;
  tokens: Tokens;
  models: Record<string, number>;
};

export type TrendsView = {
  bands: TrendsBand[];
  points: TrendsPoint[];
  totalCostUsd: number;
  totalTokens: Tokens;
  hasUnpriced: boolean;
  isApproximate: boolean;
  isEmpty: boolean;
};

const BAND_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"] as const;

export function buildTrendsView(spend: DailySpend): TrendsView {
  const bands: TrendsBand[] = spend.models.map((m, i) => ({
    model: m.model,
    color: BAND_COLORS[i % BAND_COLORS.length],
    costUsd: m.costUsd,
    tokensTotal: m.tokens.total,
    share: spend.totalCostUsd === 0 ? 0 : m.costUsd / spend.totalCostUsd,
  }));

  const points: TrendsPoint[] = spend.days.map((day) => {
    const models: Record<string, number> = {};
    for (const band of bands) models[band.model] = 0;
    for (const entry of day.perModel) models[entry.model] = entry.costUsd;
    return {
      date: day.date,
      label: formatDayKey(day.date),
      costUsd: day.costUsd,
      tokens: day.tokens,
      models,
    };
  });

  return {
    bands,
    points,
    totalCostUsd: spend.totalCostUsd,
    totalTokens: spend.totalTokens,
    hasUnpriced: spend.hasUnpriced,
    isApproximate: spend.hasUnpriced || spend.hasApproximate,
    isEmpty: bands.length === 0,
  };
}
