// The app-zone view-model seam for the conversation list. ONE pure function,
// `buildListView`, composes the whole order-dependent render pipeline that used
// to be wired inline across three RSC sites (the layout's Sidebar + Overview and
// the page's ConversationTable):
//
//   deriveFolders → filterByFolder → sortConversations → grandTotal
//                 → deriveOverview → topProjectsByCost
//
// Collapsing it here guarantees the pipeline order (filter BEFORE sort, scope
// composes with sort) and derives the folder set ONCE per call (it used to run
// three times per request). `deriveFolders` / `disambiguateLabels` and
// `sortConversations` keep their own homes + unit tests (their complexity is
// real, not glue); the four glue helpers below are module-private here.
//
// Pure CPU: NOT wrapped in React.cache() (that stays on `loadConversations`, the
// single read boundary). React-free + I/O-free so it unit-tests in the node
// vitest environment, exactly like its sibling `_lib` modules. The only core
// touch is type-only imports, erased at compile time (ADR-0002). URL→intent
// parsing stays at the page edge — this takes already-resolved `{ folder, sort }`
// intent, never raw searchParams (ADR-0004).

import type { Tokens } from "@/core/cost";
import type { ConversationSummary } from "@/core/refresh";

import { deriveFolders, type FolderEntry } from "@/app/_lib/folders";
import { sortConversations, type SortState } from "@/app/_lib/sort";
import type { Overview } from "@/app/_lib/overview";

/** Already-resolved scope + sort intent (parsed from the URL at the page edge). */
export type ListViewIntent = {
  /** The active `?folder=` scope, or `undefined`/empty for "All folders". */
  folder?: string;
  /** The resolved sort state. Its PRESENCE switches on the table slice. */
  sort: SortState;
};

/** The "All folders" anchor aggregate the sidebar shows, summed from the
 *  already-derived per-folder entries (no extra core touch). */
export type ListTotals = {
  /** Total number of conversations across all Projects. */
  count: number;
  /** Total cost (USD); a lower bound when {@link unpriced} is true. */
  costUsd: number;
  /** True when ANY Project has unpriced usage (the total is a lower bound). */
  unpriced: boolean;
};

/** The scope-independent slice, always built (used by both layout regions). */
export type ListViewBase = {
  /** The left-sidebar folder list, newest-Project-first. */
  folders: FolderEntry[];
  /** The headline overview-band aggregate. */
  overview: Overview;
  /** The cost-ranked top Projects for the overview band (a subset of `folders`). */
  topProjects: FolderEntry[];
  /** The "All folders" anchor totals for the sidebar. */
  totals: ListTotals;
};

/** The scope-dependent table slice, built ONLY when `sort` intent is provided. */
export type ListViewTable = {
  /** The scoped + sorted rows for the table body. */
  rows: ConversationSummary[];
  /** True when a (non-empty) `?folder=` scope is active. */
  scoped: boolean;
  /** The selected Project's entry for the breadcrumb, or `undefined` when
   *  unscoped or the key is unknown/stale. */
  selectedFolder: FolderEntry | undefined;
  /** Aggregate of the SCOPED rows for the table footer. */
  grandTotal: GrandTotal;
};

/** Aggregate of a set of conversation rows for the table's footer. */
export type GrandTotal = {
  tokens: Tokens;
  costUsd: number;
  hasUnpriced: boolean;
};

const TOP_PROJECTS_LIMIT = 5;

/**
 * Build the conversation-list view model from ALL rows + already-resolved intent.
 *
 * Always returns the scope-independent base (`folders`, `overview`,
 * `topProjects`, `totals`) — derived from one `deriveFolders` pass. When `intent`
 * (with a `sort`) is given, ALSO returns the table slice (`rows`, `scoped`,
 * `selectedFolder`, `grandTotal`), filtering by folder BEFORE sorting so scope
 * composes with sort. With no intent the table slice is skipped (no wasted
 * filter/sort work) — the layout's scope-independent regions call it that way.
 *
 * Pure: no mutation of `rows`.
 */
export function buildListView(rows: ConversationSummary[]): ListViewBase;
export function buildListView(
  rows: ConversationSummary[],
  intent: ListViewIntent,
): ListViewBase & ListViewTable;
export function buildListView(
  rows: ConversationSummary[],
  intent?: ListViewIntent,
): ListViewBase | (ListViewBase & ListViewTable) {
  // The single folder derive that feeds the sidebar, the top-Projects ranking,
  // the sidebar totals, AND the table breadcrumb lookup.
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
  const scopedRows = filterByFolder(rows, activeFolder);
  const sortedRows = sortConversations(scopedRows, intent.sort);
  return {
    ...base,
    rows: sortedRows,
    scoped: activeFolder !== undefined,
    selectedFolder: activeFolder
      ? folders.find((f) => f.folder === activeFolder)
      : undefined,
    grandTotal: grandTotal(sortedRows),
  };
}

// ── module-private pipeline helpers (folded in from folders/format/overview) ──

/**
 * Scope conversations to a single Project by its `?folder=` key, WITHOUT sorting
 * — input order is preserved so the caller sorts afterward (scope composes with
 * sort). All rows when `folder` is `undefined`/empty (no scope); the matching
 * rows for a known key; an empty array for a non-empty but unknown/stale key.
 */
function filterByFolder(
  summaries: ConversationSummary[],
  folder: string | undefined,
): ConversationSummary[] {
  if (!folder) return summaries;
  return summaries.filter((s) => s.project.folder === folder);
}

/** The minimal row shape {@link grandTotal} needs — a structural subset of the
 *  core `ConversationSummary`, so callers can pass full summaries. */
type GrandTotalRow = {
  tokens: Tokens;
  costUsd: number;
  unpriced: boolean;
};

/**
 * Sum tokens by bucket and costUsd across rows, flagging `hasUnpriced` if ANY
 * row is unpriced (so the UI can mark the total as a lower bound). Pure: no
 * mutation of inputs.
 */
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

/**
 * Aggregate the headline analysis of `summaries`: counts, summed cost + tokens,
 * cache-read share, and the activity date range. Pure — no mutation of inputs.
 * Empty input yields zeroed totals and an empty (`""`) date range.
 */
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

    // ISO8601 strings sort lexically in chronological order, so plain string
    // comparison gives the min/max moment. "" (the core's "unknown" sentinel)
    // is skipped on both ends.
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

/**
 * The `limit` highest-cost Projects, cost descending. Returns a new array — the
 * input order is preserved (the sidebar keeps its own newest-first ordering).
 */
function topProjectsByCost(
  entries: FolderEntry[],
  limit: number,
): FolderEntry[] {
  return [...entries].sort((a, b) => b.costUsd - a.costUsd).slice(0, limit);
}
