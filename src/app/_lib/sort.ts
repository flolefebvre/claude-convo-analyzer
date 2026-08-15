import type { ConversationSummary } from "@/core/read";

import { firstParam } from "@/app/_lib/search-params";

export type SortDir = "asc" | "desc";

export type SortState = {
  sortBy: SortableField;
  dir: SortDir;
};

type SortKind = "string" | "number";

type ColumnSpec = {
  kind: SortKind;
  defaultDir: SortDir;
  value: (row: ConversationSummary) => string | number | null;
};

function startedAtEpoch(startedAt: string): number | null {
  if (startedAt === "") return null;
  const epoch = Date.parse(startedAt);
  return Number.isNaN(epoch) ? null : epoch;
}

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

const ERRORS_ON = "1";

export const DEFAULT_SORT: SortState = { sortBy: "date", dir: "desc" };

export function isSortableField(field: string): field is SortableField {
  return field in COLUMNS;
}

function defaultDirFor(field: SortableField): SortDir {
  return COLUMNS[field].defaultDir;
}

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

export function toggleSort(field: SortableField, current: SortState): SortState {
  if (current.sortBy === field) {
    return { sortBy: field, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { sortBy: field, dir: defaultDirFor(field) };
}

export type ListLinkContext = {
  sort: SortState;
  folder?: string;
  range?: string;
  errorsOnly?: boolean;
};

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

export function sortHref(field: SortableField, ctx: ListLinkContext): string {
  return buildHref({ ...ctx, sort: toggleSort(field, ctx.sort) });
}

export function folderHref(folder: string | undefined, ctx: ListLinkContext): string {
  return buildHref({ ...ctx, folder });
}

export function expandHref(rowId: string, expanded: string | undefined, ctx: ListLinkContext): string {
  return buildHref(ctx, rowId === expanded ? undefined : rowId);
}

export function errorsHref(ctx: ListLinkContext): string {
  return buildHref({ ...ctx, errorsOnly: !ctx.errorsOnly });
}

export function resolveErrorsOnly(raw: string | string[] | undefined): boolean {
  return firstParam(raw) === ERRORS_ON;
}

export function resolveExpanded(raw: string | string[] | undefined): string | undefined {
  return firstParam(raw) || undefined;
}

export function sortIndicator(field: SortableField, current: SortState): string {
  if (current.sortBy !== field) return "";
  return current.dir === "asc" ? "↑" : "↓";
}

function compareValues(a: string | number | null, b: string | number | null, kind: SortKind): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;

  if (kind === "number") return (a as number) - (b as number);
  return String(a).localeCompare(String(b), undefined, {
    sensitivity: "base",
  });
}

export function sortConversations(rows: readonly ConversationSummary[], sort: SortState): ConversationSummary[] {
  const column = COLUMNS[sort.sortBy];
  const sign = sort.dir === "asc" ? 1 : -1;

  return [...rows].sort((a, b) => {
    const av = column.value(a);
    const bv = column.value(b);
    const primary =
      av === null || bv === null ? compareValues(av, bv, column.kind) : sign * compareValues(av, bv, column.kind);
    if (primary !== 0) return primary;
    return a.id.localeCompare(b.id);
  });
}

export function modelLabel(models: ConversationSummary["models"]): {
  dominant: string;
  extra: number;
} {
  return {
    dominant: models.dominant,
    extra: Math.max(0, models.distinctCount - 1),
  };
}
