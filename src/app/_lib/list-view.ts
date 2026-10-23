// The app-zone view-model seam for the conversation list. ONE pure function,
// `buildListView`, composes the whole order-dependent render pipeline that used
// to be wired inline across three RSC sites (the layout's Sidebar + Overview and
// the page's ConversationTable):
//
//   deriveFolders → filterByFolder → sortConversations → grandTotal → paginate
//                 → deriveOverview
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
// intent, never raw searchParams.

import type { Tokens } from "@/core/cost";
import type { ConversationSummary } from "@/core/read";

import { type FolderScope, isProjectInFolderScope } from "@/lib/project-path";
import { deriveFolderTree, findFolderNode, type FolderNode } from "@/app/_lib/folder-tree";
import { deriveFolders, type FolderEntry } from "@/app/_lib/folders";
import { FIRST_PAGE } from "@/app/_lib/search-params";
import { sortConversations, type SortState } from "@/app/_lib/sort";
import type { Overview } from "@/app/_lib/overview";

/** Already-resolved scope + sort intent (parsed from the URL at the page edge). */
export type ListViewIntent = FolderScope & {
  /** The resolved sort state. Its PRESENCE switches on the table slice. */
  sort: SortState;
  /**
   * True when the list is filtered to conversations that hit at least one API
   * error (`?errors=1`). Off (all rows) when absent — the default view never
   * hides anything.
   */
  errorsOnly?: boolean;
  /**
   * The 1-based page the URL explicitly asked for — trusted no further than
   * that: it is clamped to the pages that exist ({@link clampPage}). `undefined`
   * means NO page was requested, and then {@link ListViewIntent.expanded}
   * decides: an explicit `?page=` pins the page, while a bare `?expanded=<id>`
   * link always lands on the page holding its row.
   */
  page?: number;
  /**
   * The id of the row whose panel is open (`?expanded=`). Only used to place
   * the page when none was requested — a member link from the continuation
   * family drops the page precisely so its target cannot be paged away.
   */
  expanded?: string;
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
  /** One entry per Project, newest-Project-first. */
  folders: FolderEntry[];
  /** The sidebar's folder tree: its root rows, newest first. */
  folderTree: FolderNode[];
  /** The headline overview-band aggregate. */
  overview: Overview;
  /** The "All folders" anchor totals for the sidebar. */
  totals: ListTotals;
};

/** The scope-dependent table slice, built ONLY when `sort` intent is provided. */
export type ListViewTable = {
  /** The rows of the CURRENT page, scoped + sorted — what the table body shows. */
  rows: ConversationSummary[];
  /** The resolved (clamped) 1-based page these rows come from. */
  page: number;
  /** How many pages the scoped set spans; 1 for an empty set. */
  pageCount: number;
  /** How many rows the WHOLE scoped set holds — what the footer counts. */
  rowCount: number;
  /** True when a (non-empty) `?folder=` scope is active. */
  scoped: boolean;
  /** The selected Folder's tree row for the breadcrumb, or `undefined` when
   *  unscoped or the path names no row (unknown, stale, or inside a compacted chain). */
  selectedFolder: FolderNode | undefined;
  /** True when every row in scope comes from one Project — a leaf Folder, or
   *  this folder — so the table's Folder column would only repeat it. */
  isFolderColumnHidden: boolean;
  /** Aggregate of the SCOPED rows for the table footer. */
  grandTotal: GrandTotal;
};

/** Aggregate of a set of conversation rows for the table's footer. */
export type GrandTotal = {
  tokens: Tokens;
  costUsd: number;
  hasUnpriced: boolean;
};

/** How many conversations one page of the list shows. Fixed — there is no
 *  `?size=` param. */
export const PAGE_SIZE = 50;

/**
 * Clamp a requested (1-based) page into the pages that exist, so a hand-edited
 * or stale `?page=` never renders an empty table: below the range reads as page
 * 1, beyond the end as the last page, and an empty set is page 1 of 1.
 *
 * @example clampPage(99, 5) // 5
 */
export function clampPage(requested: number, pageCount: number): number {
  const lastPage = Math.max(FIRST_PAGE, pageCount);
  return Math.min(Math.max(FIRST_PAGE, requested), lastPage);
}

/**
 * The 1-based positions of the first and last row a (clamped) page of
 * `pageSize` rows shows within the whole set, for a pager's "51–60 of 60";
 * both 0 for an empty set.
 *
 * @example pageRange(2, 60, PAGE_SIZE) // { first: 51, last: 60 }
 */
export function pageRange(page: number, rowCount: number, pageSize: number): { first: number; last: number } {
  if (rowCount === 0) return { first: 0, last: 0 };
  const first = (page - 1) * pageSize + 1;
  return { first, last: Math.min(rowCount, first + pageSize - 1) };
}

/**
 * Build the conversation-list view model from ALL rows + already-resolved intent.
 *
 * Always returns the scope-independent base (`folders`, `folderTree`,
 * `overview`, `totals`) — derived from one `deriveFolders` pass,
 * the tree rooted at `home` (`~`). When `intent` (with a `sort`) is given, ALSO
 * returns the table slice (`rows`, `scoped`, `selectedFolder`,
 * `isFolderColumnHidden`, `grandTotal`, page metadata), filtering by folder BEFORE
 * sorting so scope composes with sort, and paginating LAST so the footer's
 * `rowCount`/`grandTotal` still cover the whole scoped set. With no intent the
 * table slice is skipped (no wasted filter/sort work) — the layout's
 * scope-independent regions call it that way.
 *
 * The page comes from `intent.page` when the URL pinned one; otherwise from the
 * row `intent.expanded` names, so a bare `?expanded=<id>` link always opens on
 * the page holding its row.
 *
 * Pure: no mutation of `rows`.
 */
export function buildListView(rows: ConversationSummary[], home: string): ListViewBase;
export function buildListView(
  rows: ConversationSummary[],
  home: string,
  intent: ListViewIntent,
): ListViewBase & ListViewTable;
export function buildListView(
  rows: ConversationSummary[],
  home: string,
  intent?: ListViewIntent,
): ListViewBase | (ListViewBase & ListViewTable) {
  // The single folder derive that feeds the sidebar tree, the sidebar totals,
  // AND the table breadcrumb lookup.
  const folders = deriveFolders(rows);
  const folderTree = deriveFolderTree(folders, home);
  const base: ListViewBase = {
    folders,
    folderTree,
    overview: deriveOverview(rows),
    totals: {
      count: rows.length,
      costUsd: folders.reduce((sum, f) => sum + f.costUsd, 0),
      unpriced: folders.some((f) => f.unpriced),
    },
  };

  if (!intent) return base;

  const activeFolder = intent.folder ? intent.folder : undefined;
  // Both filters run BEFORE the sort and compose: the Folder scope narrows to
  // the Projects at or below it, the errors filter to the conversations that
  // actually failed.
  const scopedRows = filterByErrors(filterByFolderScope(rows, intent), intent.errorsOnly);
  const sortedRows = sortConversations(scopedRows, intent.sort);
  // Paginate LAST: the footer's `rowCount` + `grandTotal` cover the whole
  // scoped set, only the rendered slice is bounded.
  const pageCount = Math.max(FIRST_PAGE, Math.ceil(sortedRows.length / PAGE_SIZE));
  const page = clampPage(intent.page ?? pageHolding(sortedRows, intent.expanded), pageCount);
  const start = (page - 1) * PAGE_SIZE;
  const selectedFolder = activeFolder ? findFolderNode(folderTree, activeFolder) : undefined;
  return {
    ...base,
    rows: sortedRows.slice(start, start + PAGE_SIZE),
    page,
    pageCount,
    rowCount: sortedRows.length,
    scoped: activeFolder !== undefined,
    selectedFolder,
    isFolderColumnHidden:
      activeFolder !== undefined &&
      (Boolean(intent.thisFolderOnly) || (selectedFolder !== undefined && selectedFolder.children.length === 0)),
    grandTotal: grandTotal(sortedRows),
  };
}

// ── module-private pipeline helpers (folded in from folders/format/overview) ──

/**
 * Scope conversations to a Folder (`?folder=`, `?thisFolder=`), WITHOUT sorting
 * — input order is preserved so the caller sorts afterward (scope composes with
 * sort). All rows when the scope names no Folder; the rows of the Projects in
 * scope otherwise — none for an unknown/stale path.
 */
function filterByFolderScope(summaries: ConversationSummary[], scope: FolderScope): ConversationSummary[] {
  if (!scope.folder) return summaries;
  return summaries.filter((s) => isProjectInFolderScope(s.project.path, scope));
}

/**
 * Keep only conversations with at least one API-error turn, WITHOUT sorting
 * (input order preserved, like {@link filterByFolderScope}). All rows when the filter
 * is off. The `errorCount` is the core's whole-conversation rollup, so a row
 * whose only failure happened inside a sub-agent survives the filter.
 */
function filterByErrors(summaries: ConversationSummary[], errorsOnly: boolean | undefined): ConversationSummary[] {
  if (!errorsOnly) return summaries;
  return summaries.filter((s) => s.errorCount > 0);
}

/**
 * The page that holds `expanded`, or {@link FIRST_PAGE} when no row is open (or
 * the id names none) — the fallback for a URL that requested no page.
 */
function pageHolding(rows: readonly ConversationSummary[], expanded: string | undefined): number {
  if (expanded === undefined) return FIRST_PAGE;
  const index = rows.findIndex((row) => row.id === expanded);
  return index === -1 ? FIRST_PAGE : pageOf(index);
}

/** The 1-based page a row's index falls on. */
function pageOf(index: number): number {
  return Math.floor(index / PAGE_SIZE) + 1;
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
    projects.add(s.project.path);
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
