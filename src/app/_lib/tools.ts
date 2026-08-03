// Pure app-zone seam for the Tools view (issue #42): the table's URL view state
// (sort column + direction, folder scope, range preset, expanded row), the
// comparator behind it, and the MCP name split. Built ON TOP of the core read —
// the only core touch is a type-only import, erased at compile time (ADR-0002).
//
// Sorting is done SERVER-SIDE BY THE APP, exactly as on the conversation list:
// the core returns one deterministic ranking (calls descending) and the app
// re-orders it per the URL. The `?sortBy=`/`?dir=` param names are shared with
// the list, but the COLUMNS are this table's own — a list column arriving from
// a shared sidebar link resolves to this table's default rather than breaking it.
//
// React-free + I/O-free so it unit-tests in the node vitest environment; the
// page is a thin shell over these.

import type { ToolStat } from "@/core/tool-stats";
import type { RangeKey } from "@/app/_lib/range";
import type { SortDir } from "@/app/_lib/sort";

/** Per-column spec: the comparable value and the direction a fresh click starts at. */
type ToolColumnSpec = {
  defaultDir: SortDir;
  value: (tool: ToolStat) => number;
};

/**
 * The table's sortable columns, keyed by their URL `sortBy` value: how often a
 * tool runs, how often it fails, and how much context it costs.
 */
const TOOL_COLUMNS = {
  calls: { defaultDir: "desc", value: (t) => t.calls },
  errorRate: { defaultDir: "desc", value: (t) => t.errorRate },
  volume: { defaultDir: "desc", value: (t) => t.totalSize },
} as const satisfies Record<string, ToolColumnSpec>;

export type ToolSortField = keyof typeof TOOL_COLUMNS;

/** A sortable Tools column + its resolved direction. */
export type ToolSortState = {
  sortBy: ToolSortField;
  dir: SortDir;
};

/** Default when the URL carries no (valid) Tools sort. */
export const DEFAULT_TOOL_SORT: ToolSortState = { sortBy: "calls", dir: "desc" };

/** The whole Tools URL view state — every link is built from one of these. */
export type ToolsViewState = {
  sort: ToolSortState;
  /** The active `?folder=` scope; absent/empty means all Projects. */
  folder?: string;
  /** The active `?range=` preset. */
  range: RangeKey;
  /** The expanded row's tool name (`?expanded=`), when a row is open. */
  expanded?: string;
};

/** True when `field` is one of the Tools table's columns. */
function isToolSortField(field: string): field is ToolSortField {
  return field in TOOL_COLUMNS;
}

/** First value of a `searchParams` entry (Next gives string | string[]). */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Resolve the active sort from raw `searchParams` values. Never trusts the URL
 * blindly: an unknown column (including a conversation-list column carried in
 * by the shared sidebar) falls back to {@link DEFAULT_TOOL_SORT}, and an
 * invalid direction falls back to the column's own default.
 */
export function resolveToolSort(
  rawSortBy: string | string[] | undefined,
  rawDir: string | string[] | undefined,
): ToolSortState {
  const field = firstParam(rawSortBy);
  if (field === undefined || !isToolSortField(field)) return DEFAULT_TOOL_SORT;

  const dir = firstParam(rawDir);
  return {
    sortBy: field,
    dir: dir === "asc" || dir === "desc" ? dir : TOOL_COLUMNS[field].defaultDir,
  };
}

/**
 * The sort produced by clicking `field`'s header: flip direction if it is
 * already active, otherwise start at that column's default direction.
 */
export function toggleToolSort(
  field: ToolSortField,
  current: ToolSortState,
): ToolSortState {
  if (current.sortBy === field) {
    return { sortBy: field, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { sortBy: field, dir: TOOL_COLUMNS[field].defaultDir };
}

/**
 * Order tools by the resolved sort, returning a NEW array (input untouched).
 * Equal values fall back to the tool name (always ascending) so the order is
 * deterministic.
 */
export function sortTools(
  tools: readonly ToolStat[],
  sort: ToolSortState,
): ToolStat[] {
  const column = TOOL_COLUMNS[sort.sortBy];
  const sign = sort.dir === "asc" ? 1 : -1;

  return [...tools].sort((a, b) => {
    const primary = sign * (column.value(a) - column.value(b));
    if (primary !== 0) return primary;
    return a.name.localeCompare(b.name);
  });
}

/** Active-sort arrow for a header, or "" when the column is not the active sort. */
export function toolSortIndicator(
  field: ToolSortField,
  current: ToolSortState,
): string {
  if (current.sortBy !== field) return "";
  return current.dir === "asc" ? "↑" : "↓";
}

/**
 * Build the page's query string from a view state, so every axis composes: a
 * sort link keeps the scope, range and expanded row; a range link keeps the
 * sort; expanding keeps everything. Empty values are omitted.
 */
function toolsHref(state: ToolsViewState): string {
  const params = new URLSearchParams({
    sortBy: state.sort.sortBy,
    dir: state.sort.dir,
  });
  if (state.folder) params.set("folder", state.folder);
  params.set("range", state.range);
  if (state.expanded) params.set("expanded", state.expanded);
  return `?${params.toString()}`;
}

/** Href for a sortable header link (toggles via {@link toggleToolSort}). */
export function toolSortHref(
  field: ToolSortField,
  state: ToolsViewState,
): string {
  return toolsHref({ ...state, sort: toggleToolSort(field, state.sort) });
}

/** Href for a range preset button — the sort, scope and open row all survive. */
export function toolRangeHref(range: RangeKey, state: ToolsViewState): string {
  return toolsHref({ ...state, range });
}

/**
 * Href for a row's expand/collapse toggle: opening `name` sets `?expanded=`,
 * clicking the already-open row drops it. The tool name IS the row key (one row
 * per tool name).
 */
export function toolExpandHref(name: string, state: ToolsViewState): string {
  return toolsHref({
    ...state,
    expanded: state.expanded === name ? undefined : name,
  });
}

/** A tool name split for display: an MCP server and its tool, or just a tool. */
export type ToolLabel = {
  /** The MCP server the tool belongs to, or `null` for a built-in tool. */
  server: string | null;
  /** The tool half — the whole name when there is no server. */
  tool: string;
};

/** The `mcp__<server>__<tool>` prefix Claude Code logs MCP tools under. */
const MCP_PREFIX = "mcp__";

/**
 * Split an MCP tool name (`mcp__<server>__<tool>`) into "server · tool" halves,
 * so a misbehaving server is spottable by eye without grouping the table. A
 * built-in tool — or a malformed MCP name with no tool half — is returned
 * verbatim rather than mangled.
 */
export function toolLabel(name: string): ToolLabel {
  if (!name.startsWith(MCP_PREFIX)) return { server: null, tool: name };
  const rest = name.slice(MCP_PREFIX.length);
  const separator = rest.indexOf("__");
  // Everything after the FIRST separator is the tool, so a tool name that
  // itself contains `__` survives intact.
  if (separator <= 0 || separator + 2 >= rest.length) {
    return { server: null, tool: name };
  }
  return { server: rest.slice(0, separator), tool: rest.slice(separator + 2) };
}
