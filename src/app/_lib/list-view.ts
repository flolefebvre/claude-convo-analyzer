import type { Tokens } from "@/core/cost";
import type { ConversationSummary } from "@/core/read";

import { deriveFolders, type FolderEntry } from "@/app/_lib/folders";
import { sortConversations, type SortState } from "@/app/_lib/sort";
import type { Overview } from "@/app/_lib/overview";

export type ListViewIntent = {
  folder?: string;
  sort: SortState;
  errorsOnly?: boolean;
};

export type ListTotals = {
  count: number;
  costUsd: number;
  unpriced: boolean;
};

export type ListViewBase = {
  folders: FolderEntry[];
  overview: Overview;
  topProjects: FolderEntry[];
  totals: ListTotals;
};

export type ListViewTable = {
  rows: ConversationSummary[];
  scoped: boolean;
  selectedFolder: FolderEntry | undefined;
  grandTotal: GrandTotal;
};

export type GrandTotal = {
  tokens: Tokens;
  costUsd: number;
  hasUnpriced: boolean;
};

const TOP_PROJECTS_LIMIT = 5;

export function buildListView(rows: ConversationSummary[]): ListViewBase;
export function buildListView(rows: ConversationSummary[], intent: ListViewIntent): ListViewBase & ListViewTable;
export function buildListView(
  rows: ConversationSummary[],
  intent?: ListViewIntent,
): ListViewBase | (ListViewBase & ListViewTable) {
  const folders = deriveFolders(rows);
  const base: ListViewBase = {
    folders,
    overview: deriveOverview(rows),
    topProjects: topProjectsByCost(folders, TOP_PROJECTS_LIMIT),
    totals: {
      count: rows.length,
      costUsd: folders.reduce((sum, f) => sum + f.costUsd, 0),
      unpriced: folders.some((f) => f.unpriced),
    },
  };

  if (!intent) return base;

  const activeFolder = intent.folder ? intent.folder : undefined;
  const scopedRows = filterByErrors(filterByFolder(rows, activeFolder), intent.errorsOnly);
  const sortedRows = sortConversations(scopedRows, intent.sort);
  return {
    ...base,
    rows: sortedRows,
    scoped: activeFolder !== undefined,
    selectedFolder: activeFolder ? folders.find((f) => f.folder === activeFolder) : undefined,
    grandTotal: grandTotal(sortedRows),
  };
}

function filterByFolder(summaries: ConversationSummary[], folder: string | undefined): ConversationSummary[] {
  if (!folder) return summaries;
  return summaries.filter((s) => s.project.folder === folder);
}

function filterByErrors(summaries: ConversationSummary[], errorsOnly: boolean | undefined): ConversationSummary[] {
  if (!errorsOnly) return summaries;
  return summaries.filter((s) => s.errorCount > 0);
}

type GrandTotalRow = {
  tokens: Tokens;
  costUsd: number;
  unpriced: boolean;
};

function grandTotal(rows: readonly GrandTotalRow[]): GrandTotal {
  const tokens: Tokens = {
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
    total: 0,
  };
  let costUsd = 0;
  let hasUnpriced = false;

  for (const row of rows) {
    tokens.input += row.tokens.input;
    tokens.output += row.tokens.output;
    tokens.cacheWrite += row.tokens.cacheWrite;
    tokens.cacheRead += row.tokens.cacheRead;
    tokens.total += row.tokens.total;
    costUsd += row.costUsd;
    if (row.unpriced) hasUnpriced = true;
  }

  return { tokens, costUsd, hasUnpriced };
}

function deriveOverview(summaries: ConversationSummary[]): Overview {
  const tokens: Tokens = {
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
    total: 0,
  };
  const projects = new Set<string>();
  let totalCost = 0;
  let hasUnpriced = false;
  let earliest = "";
  let latest = "";

  for (const s of summaries) {
    projects.add(s.project.folder);
    tokens.input += s.tokens.input;
    tokens.output += s.tokens.output;
    tokens.cacheWrite += s.tokens.cacheWrite;
    tokens.cacheRead += s.tokens.cacheRead;
    tokens.total += s.tokens.total;
    totalCost += s.costUsd;
    if (s.unpriced) hasUnpriced = true;

    if (s.startedAt !== "" && (earliest === "" || s.startedAt < earliest)) {
      earliest = s.startedAt;
    }
    const activity = s.endedAt !== "" ? s.endedAt : s.startedAt;
    if (activity !== "" && activity > latest) latest = activity;
  }

  return {
    conversationCount: summaries.length,
    projectCount: projects.size,
    totalCost,
    hasUnpriced,
    tokens,
    cacheReadRatio: tokens.total === 0 ? 0 : tokens.cacheRead / tokens.total,
    earliest,
    latest,
  };
}

function topProjectsByCost(entries: FolderEntry[], limit: number): FolderEntry[] {
  return [...entries].sort((a, b) => b.costUsd - a.costUsd).slice(0, limit);
}
