// Pure sort-state, comparator, and label helpers for the conversation list
// table.
//
// Sorting is done SERVER-SIDE BY THE APP, not by the core. The core's
// `listConversations` comparator only handles top-level scalar
// `keyof ConversationSummary` fields, so nested columns (folder, model, each
// token bucket) could never be sorted through it. Instead the page fetches all
// rows and orders them with {@link sortConversations} here. That frees the URL
// `sortBy` keys from `keyof ConversationSummary`: they are now app column keys
// (e.g. `cost`, `input`, `model`) that map to value extractors below.
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

/** How a column's values compare: text reads A→Z, numbers high→low. */
type SortKind = "string" | "number";

/** Per-column spec: extract a comparable value, its kind, and the direction a
 *  fresh click starts at (numbers newest/biggest-first = desc; text A→Z = asc). */
type ColumnSpec = {
  kind: SortKind;
  defaultDir: SortDir;
  /** The comparable value; `null` (e.g. a missing title) always sorts last. */
  value: (row: ConversationSummary) => string | number | null;
};

/**
 * Parse an ISO8601 `startedAt` to epoch milliseconds for chronological
 * comparison. Empty string (the core's "unknown" sentinel) or any value
 * `Date.parse` cannot read yields `null`, so those rows sort LAST in both
 * directions via the comparator's nulls-last rule.
 */
function startedAtEpoch(startedAt: string): number | null {
  if (startedAt === "") return null;
  const epoch = Date.parse(startedAt);
  return Number.isNaN(epoch) ? null : epoch;
}

/**
 * Every sortable column, keyed by its URL `sortBy` value. These are app column
 * keys, deliberately NOT `keyof ConversationSummary` — the app sorts, so the
 * keys describe the table's columns, not the core's field names.
 */
const COLUMNS = {
  folder: {
    kind: "string",
    defaultDir: "asc",
    value: (r) => r.project.folder,
  },
  title: {
    kind: "string",
    defaultDir: "asc",
    value: (r) => r.title,
  },
  model: {
    kind: "string",
    defaultDir: "asc",
    value: (r) => r.models.dominant,
  },
  date: {
    kind: "number",
    defaultDir: "desc",
    value: (r) => startedAtEpoch(r.startedAt),
  },
  total: {
    kind: "number",
    defaultDir: "desc",
    value: (r) => r.tokens.total,
  },
  cost: {
    kind: "number",
    defaultDir: "desc",
    value: (r) => r.costUsd,
  },
} as const satisfies Record<string, ColumnSpec>;

export type SortableField = keyof typeof COLUMNS;

/** Default when the URL carries no (valid) sort params. */
export const DEFAULT_SORT: SortState = { sortBy: "date", dir: "desc" };

/** True when `field` is one of the table's sortable columns. */
export function isSortableField(field: string): field is SortableField {
  return field in COLUMNS;
}

/** The direction a fresh (inactive) click on `field` should start at. */
function defaultDirFor(field: SortableField): SortDir {
  return COLUMNS[field].defaultDir;
}

/** First value of a `searchParams` entry (Next gives string | string[]). */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Resolve the active sort from raw `searchParams` values, defaulting unknown
 * fields and invalid directions. Never trusts the URL blindly — an unknown
 * `sortBy` falls back to {@link DEFAULT_SORT}.
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
 * Compare two column values for the primary sort. `null` (a missing title)
 * always sorts LAST regardless of direction. Strings compare
 * case-insensitively via `localeCompare`; numbers compare numerically. Returns
 * the asc-ordered comparison; {@link sortConversations} negates it for desc.
 */
function compareValues(
  a: string | number | null,
  b: string | number | null,
  kind: SortKind,
): number {
  // Nulls last, in both directions (the caller never negates a null result).
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  if (kind === "number") return (a as number) - (b as number);
  return String(a).localeCompare(String(b), undefined, {
    sensitivity: "base",
  });
}

/**
 * Order conversations by the resolved sort, returning a NEW array (input is not
 * mutated). Equal primary values fall back to a stable tiebreak on `id`
 * (always ascending) so the order is deterministic. `null` values sort last in
 * both directions; the direction only flips non-null comparisons.
 */
export function sortConversations(
  rows: readonly ConversationSummary[],
  sort: SortState,
): ConversationSummary[] {
  const column = COLUMNS[sort.sortBy];
  const sign = sort.dir === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const av = column.value(a);
    const bv = column.value(b);
    // Nulls are anchored last: only direction-flip a comparison of two non-nulls.
    const primary =
      av === null || bv === null
        ? compareValues(av, bv, column.kind)
        : sign * compareValues(av, bv, column.kind);
    if (primary !== 0) return primary;
    return a.id.localeCompare(b.id);
  });
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
