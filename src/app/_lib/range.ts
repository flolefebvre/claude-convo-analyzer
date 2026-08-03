// The date-range presets shared by every scoped analysis surface (Trends,
// Tools): the `?range=` URL vocabulary, its resolution, and the core's `days`
// option. Extracted from `trends.ts` when a second surface adopted the same
// presets (issue #42) — one picker, one set of semantics, one default.
//
// Day/local-time semantics live in the core (`getDailySpend`, `getToolStats`):
// a range of N days ends on today's LOCAL day and counts back N-1 days.
//
// React-free + I/O-free so it unit-tests in the node vitest environment.

/** The selectable ranges — preset buttons only, no free date inputs. */
export type RangeKey = "7" | "30" | "90" | "all";

/** The presets in display order, with their button labels. */
export const RANGE_PRESETS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All time" },
] as const satisfies readonly { value: RangeKey; label: string }[];

/** The range used when the URL carries none (or an unknown one). */
export const DEFAULT_RANGE: RangeKey = "30";

/** First value of a `searchParams` entry (Next gives string | string[]). */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Resolve the active range from the raw `?range=` search param. Mirrors
 * `resolveSort`: never trusts the URL blindly — anything that is not a preset
 * falls back to {@link DEFAULT_RANGE}.
 */
export function resolveRange(raw: string | string[] | undefined): RangeKey {
  const value = firstParam(raw);
  const preset = RANGE_PRESETS.find((p) => p.value === value);
  return preset === undefined ? DEFAULT_RANGE : preset.value;
}

/** The core's `days` option for a range — `undefined` (all time) for "all". */
export function rangeDays(range: RangeKey): number | undefined {
  return range === "all" ? undefined : Number(range);
}

/**
 * Query-string href for a range preset button, PRESERVING the active folder
 * scope so the two axes compose (the mirror of `folderHref`, which preserves
 * the range coming the other way). A missing/empty folder means "all Projects".
 * Surfaces with more URL state than range+folder (the Tools table's sort and
 * expanded row) build their own href and hand it to the picker instead.
 */
export function rangeHref(range: RangeKey, folder?: string): string {
  const params = new URLSearchParams({ range });
  if (folder) params.set("folder", folder);
  return `?${params.toString()}`;
}
