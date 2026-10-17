// Pure app-zone seam for the Trends view: the shaping of the core's
// `DailySpend` into what the chart + stats row render (bands with colors, one
// point per day, share-of-total). The `?range=` presets it used to own moved to
// `@/app/_lib/range` when Tools adopted them. Built ON TOP of the core read —
// the only core touch is a type-only import, erased at compile time (ADR-0002).
//
// React-free + I/O-free so it unit-tests in the node vitest environment; the
// page and the chart component are thin shells over these.

import type { Tokens } from "@/core/cost";
import type { DailySpend } from "@/core/read";
import { formatDayKey } from "@/app/_lib/format";

/** One model's band of the stack — also one entry of the stats-row legend. */
export type TrendsBand = {
  /** The model as logged; the band's dataKey and its legend label. */
  model: string;
  /** Theme-aware CSS color for the band + its legend swatch, stable per model. */
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

/** A model family, as far as its color is concerned. */
type Family = "opus" | "sonnet" | "haiku" | "other";

/**
 * Each family's colors from the shadcn chart palette (CSS variables, so both
 * themes resolve at render time): its own hue for its newest version, then a
 * spare hue no family owns for the next one down.
 */
const FAMILY_COLORS: Record<Family, { home: number; spare: number }> = {
  opus: { home: 1, spare: 2 },
  sonnet: { home: 3, spare: 5 },
  haiku: { home: 4, spare: 5 },
  other: { home: 5, spare: 2 },
};

const FAMILY_ORDER: readonly Family[] = ["opus", "sonnet", "haiku", "other"];

function familyOf(model: string): Family {
  return (/opus|sonnet|haiku/.exec(model.toLowerCase())?.[0] as Family | undefined) ?? "other";
}

/** The model's version numbers ("claude-opus-4-8" → [4, 8]); long runs (date stamps) are not versions. */
function versionOf(model: string): number[] {
  return (model.match(/\d+/g) ?? []).filter((run) => run.length <= 2).map(Number);
}

/** Newest version first; equal versions by name, so the order never depends on cost. */
function newestFirst(a: string, b: string): number {
  const va = versionOf(a);
  const vb = versionOf(b);
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const diff = (vb[i] ?? -1) - (va[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return a.localeCompare(b);
}

/**
 * The `k`-th shade (k ≥ 1) of a chart hue: mixed alternately toward the
 * foreground and the background, by a share that shrinks but never repeats.
 */
function shade(hue: number, k: number): string {
  const toward = k % 2 === 1 ? "var(--foreground)" : "var(--background)";
  const keep = 100 - Math.round(30 / Math.ceil(k / 2));
  return `color-mix(in oklch, var(--chart-${hue}) ${keep}%, ${toward})`;
}

/**
 * A color per model, keyed by the model itself rather than its cost rank, so a
 * model keeps its color when another range reorders the stack. The newest
 * version of each family wears the family's hue, the next takes the family's
 * spare hue while it is free, and the rest are shades of the family's hue — no
 * two models in the range ever share a color.
 */
function modelColors(models: readonly string[]): Map<string, string> {
  const colors = new Map<string, string>();
  const used = new Set<string>();
  const assign = (model: string, color: string) => {
    colors.set(model, color);
    used.add(color);
  };

  const byFamily = FAMILY_ORDER.map((family) => ({
    family,
    models: models.filter((m) => familyOf(m) === family).sort(newestFirst),
  }));

  // Every family's newest version first, so a family's own hue is never taken.
  for (const { family, models: versions } of byFamily) {
    if (versions[0] !== undefined) assign(versions[0], `var(--chart-${FAMILY_COLORS[family].home})`);
  }
  for (const { family, models: versions } of byFamily) {
    const { home, spare } = FAMILY_COLORS[family];
    let k = 0;
    for (const model of versions.slice(1)) {
      const spareColor = `var(--chart-${spare})`;
      if (!used.has(spareColor)) {
        assign(model, spareColor);
        continue;
      }
      let color: string;
      do color = shade(home, ++k);
      while (used.has(color));
      assign(model, color);
    }
  }
  return colors;
}

/**
 * Shape one `DailySpend` into the Trends view. Band order is the core's cost
 * ranking (never re-sorted here), band colors follow the model (see
 * `modelColors`), and every point carries EVERY band — zero
 * where that model did not run — so the stack stays continuous across the range.
 */
export function buildTrendsView(spend: DailySpend): TrendsView {
  const colors = modelColors(spend.models.map((m) => m.model));
  const bands: TrendsBand[] = spend.models.map((m) => ({
    model: m.model,
    color: colors.get(m.model) ?? "var(--chart-5)",
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
