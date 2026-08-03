// Pure URL-view-state (sort, folder scope, expanded row), comparator, and
// label helpers for the conversation list table.
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

import type { ConversationSummary } from "@/core/read";

import { firstParam } from "@/app/_lib/search-params";

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

/** The single `?errors=` value that means "only conversations with errors". */
const ERRORS_ON = "1";

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

/**
 * The list view state EVERY link on this page has to carry forward, so the axes
 * compose: a sort link keeps the active folder scope, a folder link keeps the
 * active sort, and both keep the Trends range the user arrived with. Passed as
 * one value rather than a growing tail of positional arguments — each new list
 * axis then reaches every link by extending this type, not every signature.
 */
export type ListLinkContext = {
  /** The resolved sort state. */
  sort: SortState;
  /** The active `?folder=` scope, or `undefined`/empty for "All folders". */
  folder?: string;
  /** The active Trends range, carried verbatim so Trends keeps its selection. */
  range?: string;
  /** True when the list is filtered to conversations WITH API errors (`?errors=1`). */
  errorsOnly?: boolean;
};

/**
 * Build the page's query string from a link context and an optional expanded
 * row. Empty/`undefined` axes are omitted (i.e. cleared). `URLSearchParams`
 * handles value encoding.
 */
function buildHref(ctx: ListLinkContext, expanded?: string): string {
  const params = new URLSearchParams({
    sortBy: ctx.sort.sortBy,
    dir: ctx.sort.dir,
  });
  if (ctx.folder) params.set("folder", ctx.folder);
  if (expanded) params.set("expanded", expanded);
  if (ctx.range) params.set("range", ctx.range);
  if (ctx.errorsOnly) params.set("errors", ERRORS_ON);
  return `?${params.toString()}`;
}

/**
 * Query-string href for a sortable header link (toggles via {@link toggleSort}),
 * preserving every other axis of {@link ListLinkContext}.
 */
export function sortHref(field: SortableField, ctx: ListLinkContext): string {
  return buildHref({ ...ctx, sort: toggleSort(field, ctx.sort) });
}

/**
 * Query-string href for a sidebar folder link: scopes to `folder` (or clears
 * the scope, "All folders", when `undefined`/empty) while PRESERVING every other
 * axis, so changing folder composes with the current sort — and, since the
 * sidebar is shared with Trends, never resets the selected range.
 */
export function folderHref(
  folder: string | undefined,
  ctx: ListLinkContext,
): string {
  return buildHref({ ...ctx, folder });
}

/**
 * Query-string href for a row's expand/collapse toggle link. Clicking a
 * collapsed row expands it (`?expanded=<id>`); clicking the already-expanded
 * row collapses it (the param is dropped). Every other axis is preserved in
 * both directions so toggling a panel never changes the view.
 */
export function expandHref(
  rowId: string,
  expanded: string | undefined,
  ctx: ListLinkContext,
): string {
  return buildHref(ctx, rowId === expanded ? undefined : rowId);
}

/**
 * Query-string href for the "only with errors" toggle: flips the filter and
 * keeps every other axis. `?expanded=` is deliberately NOT carried — the open
 * row may not be in the filtered set, and an expanded panel for an invisible row
 * means nothing.
 */
export function errorsHref(ctx: ListLinkContext): string {
  return buildHref({ ...ctx, errorsOnly: !ctx.errorsOnly });
}

/**
 * Resolve the "only with errors" filter from the raw `?errors=` search param.
 * ONLY the canonical {@link ERRORS_ON} value switches it on: anything else — an
 * absent param, an empty value, a hand-edited `errors=yes` — leaves the list
 * unfiltered, so a URL is never read as "hide rows" by accident.
 */
export function resolveErrorsOnly(raw: string | string[] | undefined): boolean {
  return firstParam(raw) === ERRORS_ON;
}

/**
 * Resolve the expanded-row id from the raw `?expanded=` search param. Mirrors
 * {@link resolveSort}: first value when the param repeats, and an absent/empty
 * value means "no row expanded" (`undefined`).
 */
export function resolveExpanded(
  raw: string | string[] | undefined,
): string | undefined {
  return firstParam(raw) || undefined;
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
