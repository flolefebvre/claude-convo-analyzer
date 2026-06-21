// Pure sort-state + label helpers for the conversation list table.
//
// Sorting is done server-side by `listConversations({ sortBy, dir })`, whose
// `sortBy` is a `keyof ConversationSummary`. Its comparator only handles
// TOP-LEVEL scalar fields (it does `a[sortBy]` then compares numbers, else
// String()-compares): nested fields like `tokens` / `models` / `project` would
// stringify to "[object Object]" and sort meaninglessly. So we expose ONLY the
// fields the core can honestly honor as sortable, and the page renders plain
// (non-link) headers for the rest. See `src/core/refresh.ts` `sortSummaries`.
//
// React-free + I/O-free so it unit-tests in the node vitest environment; the
// page is a thin shell over these.

import type { ConversationSummary } from "@/core/refresh";

export type SortDir = "asc" | "desc";

/** A sortable column key + its resolved direction. */
export type SortState = {
  sortBy: SortableField;
  dir: SortDir;
};

/**
 * The fields the core comparator can honestly sort, each with the direction a
 * fresh click should start at (costs/counts/dates read best newest-first =
 * desc; text reads best A→Z = asc). Only `keyof ConversationSummary` scalars.
 */
const SORTABLE_DEFAULT_DIR = {
  costUsd: "desc",
  title: "asc",
  id: "asc",
  startedAt: "desc",
  endedAt: "desc",
  subAgentCount: "desc",
} as const satisfies Partial<Record<keyof ConversationSummary, SortDir>>;

export type SortableField = keyof typeof SORTABLE_DEFAULT_DIR;

/** Default when the URL carries no (valid) sort params. */
export const DEFAULT_SORT: SortState = { sortBy: "costUsd", dir: "desc" };

/** True when `field` is a column the core can actually sort by. */
export function isSortableField(field: string): field is SortableField {
  return field in SORTABLE_DEFAULT_DIR;
}

/** The direction a fresh (inactive) click on `field` should start at. */
function defaultDirFor(field: SortableField): SortDir {
  return SORTABLE_DEFAULT_DIR[field];
}

/** First value of a `searchParams` entry (Next gives string | string[]). */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Resolve the active sort from raw `searchParams` values, defaulting unknown /
 * unsortable fields and invalid directions. Never trusts the URL blindly — an
 * unsortable `sortBy` (e.g. `tokens`) would make the core stringify-compare
 * objects, so it falls back to {@link DEFAULT_SORT}.
 */
export function resolveSort(
  rawSortBy: string | string[] | undefined,
  rawDir: string | string[] | undefined,
): SortState {
  const field = firstParam(rawSortBy);
  if (field === undefined || !isSortableField(field)) return DEFAULT_SORT;

  const dir = firstParam(rawDir);
  return {
    sortBy: field,
    dir: dir === "asc" || dir === "desc" ? dir : defaultDirFor(field),
  };
}

/**
 * The sort state produced by clicking `field`'s header: flip direction if it is
 * already the active field, otherwise start at the field's own default dir.
 */
export function toggleSort(field: SortableField, current: SortState): SortState {
  if (current.sortBy === field) {
    return { sortBy: field, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { sortBy: field, dir: defaultDirFor(field) };
}

/** Query-string href for a sortable header link (toggles via {@link toggleSort}). */
export function sortHref(field: SortableField, current: SortState): string {
  const next = toggleSort(field, current);
  return `?sortBy=${next.sortBy}&dir=${next.dir}`;
}

/** Active-sort arrow for a header, or "" when the field is not the active sort. */
export function sortIndicator(field: SortableField, current: SortState): string {
  if (current.sortBy !== field) return "";
  return current.dir === "asc" ? "↑" : "↓";
}

/**
 * Derive the Model(s) cell label: the dominant model plus the count of OTHER
 * distinct models (`extra`), so the UI can render a `+N` badge. `extra` is
 * `distinctCount - 1` clamped at 0 (a 0/1-model conversation shows no badge).
 */
export function modelLabel(models: ConversationSummary["models"]): {
  dominant: string;
  extra: number;
} {
  return {
    dominant: models.dominant,
    extra: Math.max(0, models.distinctCount - 1),
  };
}
