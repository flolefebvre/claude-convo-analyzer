import type { ToolStat } from "@/core/tool-stats";
import type { RangeKey } from "@/app/_lib/range";
import type { SortDir } from "@/app/_lib/sort";

import { firstParam } from "@/app/_lib/search-params";

type ToolColumnSpec = {
  defaultDir: SortDir;
  value: (tool: ToolStat) => number;
};

const TOOL_COLUMNS = {
  calls: { defaultDir: "desc", value: (t) => t.calls },
  errorRate: { defaultDir: "desc", value: (t) => t.errorRate },
  volume: { defaultDir: "desc", value: (t) => t.totalSize },
} as const satisfies Record<string, ToolColumnSpec>;

export type ToolSortField = keyof typeof TOOL_COLUMNS;

export type ToolSortState = {
  sortBy: ToolSortField;
  dir: SortDir;
};

export const DEFAULT_TOOL_SORT: ToolSortState = { sortBy: "calls", dir: "desc" };

export type ToolsViewState = {
  sort: ToolSortState;
  folder?: string;
  range: RangeKey;
  expanded?: string;
};

function isToolSortField(field: string): field is ToolSortField {
  return field in TOOL_COLUMNS;
}

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

export function toggleToolSort(field: ToolSortField, current: ToolSortState): ToolSortState {
  if (current.sortBy === field) {
    return { sortBy: field, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { sortBy: field, dir: TOOL_COLUMNS[field].defaultDir };
}

export function sortTools(tools: readonly ToolStat[], sort: ToolSortState): ToolStat[] {
  const column = TOOL_COLUMNS[sort.sortBy];
  const sign = sort.dir === "asc" ? 1 : -1;

  return [...tools].sort((a, b) => {
    const primary = sign * (column.value(a) - column.value(b));
    if (primary !== 0) return primary;
    return a.name.localeCompare(b.name);
  });
}

export function toolSortIndicator(field: ToolSortField, current: ToolSortState): string {
  if (current.sortBy !== field) return "";
  return current.dir === "asc" ? "↑" : "↓";
}

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

export function toolSortHref(field: ToolSortField, state: ToolsViewState): string {
  return toolsHref({ ...state, sort: toggleToolSort(field, state.sort) });
}

export function toolRangeHref(range: RangeKey, state: ToolsViewState): string {
  return toolsHref({ ...state, range });
}

export function toolExpandHref(name: string, state: ToolsViewState): string {
  return toolsHref({
    ...state,
    expanded: state.expanded === name ? undefined : name,
  });
}

export type ToolLabel = {
  server: string | null;
  tool: string;
};

const MCP_PREFIX = "mcp__";

export function toolLabel(name: string): ToolLabel {
  if (!name.startsWith(MCP_PREFIX)) return { server: null, tool: name };
  const rest = name.slice(MCP_PREFIX.length);
  const separator = rest.indexOf("__");
  if (separator <= 0 || separator + 2 >= rest.length) {
    return { server: null, tool: name };
  }
  return { server: rest.slice(0, separator), tool: rest.slice(separator + 2) };
}
