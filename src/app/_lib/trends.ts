// Pure app-zone seam for the Trends view: the URL range presets and the shaping
// of the core's `DailySpend` into what the chart + stats row render (bands with
// colors, one point per day, share-of-total). Built ON TOP of the core read —
// the only core touch is a type-only import, erased at compile time (ADR-0002).
//
// React-free + I/O-free so it unit-tests in the node vitest environment; the
// page and the chart component are thin shells over these.

import type { Tokens } from "@/core/cost";
import type { DailySpend } from "@/core/read";
import { formatDayKey } from "@/app/_lib/format";

/** The selectable ranges — preset buttons only, no free date inputs. */
export type TrendsRange = "7" | "30" | "90" | "all";

/** The presets in display order, with their button labels. */
export const RANGE_PRESETS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All time" },
] as const satisfies readonly { value: TrendsRange; label: string }[];

/** The range used when the URL carries none (or an unknown one). */
export const DEFAULT_RANGE: TrendsRange = "30";

/** First value of a `searchParams` entry (Next gives string | string[]). */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Resolve the active range from the raw `?range=` search param. Mirrors
 * `resolveSort`: never trusts the URL blindly — anything that is not a preset
 * falls back to {@link DEFAULT_RANGE}.
 */
export function resolveRange(
  raw: string | string[] | undefined,
): TrendsRange {
  const value = firstParam(raw);
  const preset = RANGE_PRESETS.find((p) => p.value === value);
  return preset === undefined ? DEFAULT_RANGE : preset.value;
}

/** The core's `days` option for a range — `undefined` (all time) for "all". */
export function rangeDays(range: TrendsRange): number | undefined {
  return range === "all" ? undefined : Number(range);
}

/**
 * Query-string href for a range preset button, PRESERVING the active folder
 * scope so the two axes compose (the mirror of `folderHref`, which preserves
 * the range coming the other way). A missing/empty folder means "all Projects".
 */
export function rangeHref(range: TrendsRange, folder?: string): string {
  const params = new URLSearchParams({ range });
  if (folder) params.set("folder", folder);
  return `?${params.toString()}`;
}

/** One model's band of the stack — also one entry of the stats-row legend. */
export type TrendsBand = {
  /** The model as logged; the band's dataKey and its legend label. */
  model: string;
  /** Theme-aware CSS color for the band + its legend swatch. */
  color: string;
  /** The model's cost across the whole range. */
  costUsd: number;
  /** The model's total tokens across the whole range. */
  tokensTotal: number;
  /** Share of the range's total cost, in `[0, 1]` (`0` when nothing is priced). */
  share: number;
};

/** One day of the chart: its bands' costs plus the day's token split. */
export type TrendsPoint = {
  /** Local calendar day, `YYYY-MM-DD` — the stable key. */
  date: string;
  /** Short axis label, e.g. "Jun 10". */
  label: string;
  /** The day's total cost across all bands. */
  costUsd: number;
  /** The day's token split across ALL models, unpriced usage included. */
  tokens: Tokens;
  /** Cost per band — EVERY band is present, zero where it did not run. */
  models: Record<string, number>;
};

/** Everything the Trends page renders, derived from one `DailySpend` read. */
export type TrendsView = {
  /** Bands in stack + legend order (cost descending, from the core). */
  bands: TrendsBand[];
  /** One point per day of the range, ascending and contiguous. */
  points: TrendsPoint[];
  totalCostUsd: number;
  totalTokens: Tokens;
  /** True when the range contains unpriced (unknown/`<synthetic>`) usage. */
  hasUnpriced: boolean;
  /** True when the total is not exact — unpriced OR bare-alias usage in range. */
  isApproximate: boolean;
  /** True when nothing in the range is priced: the chart shows its empty state. */
  isEmpty: boolean;
};

/**
 * The shadcn chart palette, cycled when a range holds more models than colors.
 * CSS variables (not literal colors) so both themes resolve at render time.
 */
const BAND_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/**
 * Shape one `DailySpend` into the Trends view. Band order is the core's cost
 * ranking (never re-sorted here), and every point carries EVERY band — zero
 * where that model did not run — so the stack stays continuous across the range.
 */
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
