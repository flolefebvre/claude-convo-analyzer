import { describe, expect, it } from "vitest";

import type { Tokens } from "@/core/cost";

import { PAGE_SIZE, buildListView, clampPage } from "@/app/_lib/list-view";
import type { SortState } from "@/app/_lib/sort";

import { summary } from "./helpers/summaries";

const ASC_COST: SortState = { sortBy: "cost", dir: "asc" };
const DESC_COST: SortState = { sortBy: "cost", dir: "desc" };

/** Three Projects with distinct costs: beta ($30) > gamma ($12) > alpha ($5). */
const THREE_PROJECTS = [
  summary({ id: "a", folder: "fA", path: "/p/alpha", costUsd: 5 }),
  summary({ id: "b", folder: "fB", path: "/p/beta", costUsd: 30 }),
  summary({ id: "c", folder: "fC", path: "/p/gamma", costUsd: 12 }),
];

describe("buildListView — scope-independent slice (no sort)", () => {
  it("returns folders/overview/topProjects/totals but NO table slice when no sort is given", () => {
    const rows = [
      summary({ id: "a", folder: "fA", path: "/p/alpha", costUsd: 5 }),
      summary({ id: "b", folder: "fB", path: "/p/beta", costUsd: 30 }),
    ];
    const view = buildListView(rows);

    expect(view.folders.map((f) => f.folder).sort()).toEqual(["fA", "fB"]);
    expect(view.overview.conversationCount).toBe(2);
    expect(view.topProjects.length).toBeGreaterThan(0);
    expect(view.totals).toEqual({ count: 2, costUsd: 35, unpriced: false });

    // The table slice is skipped — no wasted sort/filter work.
    expect("rows" in view).toBe(false);
    expect("scoped" in view).toBe(false);
    expect("selectedFolder" in view).toBe(false);
    expect("grandTotal" in view).toBe(false);
  });

  it("totals sum cost across folders and flag unpriced when any Project is unpriced", () => {
    const view = buildListView([
      summary({ id: "a", folder: "fA", costUsd: 10 }),
      summary({ id: "b", folder: "fB", costUsd: 5, unpriced: true }),
    ]);
    expect(view.totals.count).toBe(2);
    expect(view.totals.costUsd).toBeCloseTo(15);
    expect(view.totals.unpriced).toBe(true);
  });

  it("derives folders ONCE and feeds both topProjects and folders (topProjects ⊆ folders)", () => {
    const view = buildListView(THREE_PROJECTS);
    // Every topProjects entry is the SAME object derived for the folder list.
    for (const top of view.topProjects) {
      expect(view.folders).toContain(top);
    }
  });
});

describe("buildListView — overview aggregate (migrated from deriveOverview)", () => {
  it("counts conversations and distinct Projects", () => {
    const { overview } = buildListView([
      summary({ id: "a", folder: "fA" }),
      summary({ id: "b", folder: "fA" }),
      summary({ id: "c", folder: "fB" }),
    ]);
    expect(overview.conversationCount).toBe(3);
    expect(overview.projectCount).toBe(2);
  });

  it("sums cost and total tokens, flagging hasUnpriced if any row is unpriced", () => {
    const { overview } = buildListView([
      summary({ id: "a", costUsd: 10, tokens: { total: 100 } }),
      summary({ id: "b", costUsd: 5, tokens: { total: 50 }, unpriced: true }),
    ]);
    expect(overview.totalCost).toBeCloseTo(15);
    expect(overview.tokens.total).toBe(150);
    expect(overview.hasUnpriced).toBe(true);
  });

  it("computes the cache-read ratio as cacheRead / total tokens", () => {
    const { overview } = buildListView([
      summary({ id: "a", tokens: { total: 100, cacheRead: 60 } }),
      summary({ id: "b", tokens: { total: 100, cacheRead: 20 } }),
    ]);
    expect(overview.cacheReadRatio).toBeCloseTo(0.4);
  });

  it("returns a zero cache-read ratio when there are no tokens (no divide by zero)", () => {
    const { overview } = buildListView([summary({ id: "a", tokens: { total: 0, cacheRead: 0 } })]);
    expect(overview.cacheReadRatio).toBe(0);
  });

  it("reports the earliest start and the latest activity across all rows", () => {
    const { overview } = buildListView([
      summary({
        id: "a",
        startedAt: "2026-03-01T00:00:00.000Z",
        endedAt: "2026-03-02T00:00:00.000Z",
      }),
      summary({
        id: "b",
        startedAt: "2026-01-15T00:00:00.000Z",
        endedAt: "2026-01-16T00:00:00.000Z",
      }),
    ]);
    expect(overview.earliest).toBe("2026-01-15T00:00:00.000Z");
    expect(overview.latest).toBe("2026-03-02T00:00:00.000Z");
  });

  it("ignores empty timestamps in the date range, falling back to startedAt for latest", () => {
    const { overview } = buildListView([
      summary({ id: "a", startedAt: "2026-05-01T00:00:00.000Z", endedAt: "" }),
      summary({ id: "b", startedAt: "", endedAt: "" }),
    ]);
    expect(overview.earliest).toBe("2026-05-01T00:00:00.000Z");
    expect(overview.latest).toBe("2026-05-01T00:00:00.000Z");
  });

  it("yields empty range and zeroed totals for no conversations", () => {
    const { overview } = buildListView([]);
    expect(overview.conversationCount).toBe(0);
    expect(overview.projectCount).toBe(0);
    expect(overview.totalCost).toBe(0);
    expect(overview.tokens.total).toBe(0);
    expect(overview.hasUnpriced).toBe(false);
    expect(overview.cacheReadRatio).toBe(0);
    expect(overview.earliest).toBe("");
    expect(overview.latest).toBe("");
  });
});

describe("buildListView — topProjects (migrated from topProjectsByCost)", () => {
  it("orders Projects by cost descending, limited to the top 5", () => {
    const { topProjects } = buildListView(THREE_PROJECTS);
    expect(topProjects.map((e) => e.label)).toEqual(["beta", "gamma", "alpha"]);
  });

  it("does not reorder the sidebar folder list (folders keep newest-first ordering)", () => {
    const at = "2026-05-01T00:00:00.000Z";
    const ordered = [
      summary({ id: "a", folder: "fOld", path: "/p/old", endedAt: "2026-01-01T00:00:00.000Z", costUsd: 99 }),
      summary({ id: "b", folder: "fNew", path: "/p/new", endedAt: at, costUsd: 1 }),
    ];
    const { folders, topProjects } = buildListView(ordered);
    // Sidebar: newest-first regardless of cost.
    expect(folders.map((f) => f.folder)).toEqual(["fNew", "fOld"]);
    // topProjects: highest cost first.
    expect(topProjects.map((f) => f.folder)).toEqual(["fOld", "fNew"]);
  });
});

describe("buildListView — table slice (with sort)", () => {
  it("filters BEFORE sorting: scoped rows come back in sorted order", () => {
    const rows = [
      summary({ id: "a", folder: "fA", costUsd: 9 }),
      summary({ id: "b", folder: "fB", costUsd: 100 }),
      summary({ id: "c", folder: "fA", costUsd: 1 }),
      summary({ id: "d", folder: "fA", costUsd: 5 }),
    ];
    const view = buildListView(rows, { folder: "fA", sort: ASC_COST });
    // Only fA rows, ordered by cost ascending: c(1), d(5), a(9).
    expect(view.rows.map((r) => r.id)).toEqual(["c", "d", "a"]);
    expect(view.scoped).toBe(true);
  });

  it("grandTotal reflects the SCOPED rows only, not all rows", () => {
    const rows = [
      summary({ id: "a", folder: "fA", costUsd: 9, tokens: { total: 90 } }),
      summary({ id: "b", folder: "fB", costUsd: 100, tokens: { total: 1000 } }),
      summary({ id: "c", folder: "fA", costUsd: 1, tokens: { total: 10 } }),
    ];
    const view = buildListView(rows, { folder: "fA", sort: DESC_COST });
    expect(view.grandTotal.costUsd).toBeCloseTo(10);
    expect(view.grandTotal.tokens.total).toBe(100);
    expect(view.grandTotal.hasUnpriced).toBe(false);
  });

  it("returns rows: [] and scoped: true for a stale ?folder= (folder no longer present)", () => {
    const rows = [summary({ id: "a", folder: "fA", costUsd: 9 }), summary({ id: "b", folder: "fB", costUsd: 100 })];
    const view = buildListView(rows, { folder: "fGhost", sort: DESC_COST });
    expect(view.rows).toEqual([]);
    expect(view.scoped).toBe(true);
    expect(view.selectedFolder).toBeUndefined();
  });

  it("treats an empty/undefined folder as 'All folders' (unscoped)", () => {
    const rows = [summary({ id: "a", folder: "fA", costUsd: 9 }), summary({ id: "b", folder: "fB", costUsd: 100 })];
    const view = buildListView(rows, { sort: DESC_COST });
    expect(view.rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(view.scoped).toBe(false);
    expect(view.selectedFolder).toBeUndefined();
  });

  it("an unpriced-in-scope conversation propagates to BOTH the scoped grandTotal and the overview", () => {
    const rows = [
      summary({ id: "a", folder: "fA", costUsd: 9, unpriced: true }),
      summary({ id: "b", folder: "fB", costUsd: 100, unpriced: false }),
    ];
    const view = buildListView(rows, { folder: "fA", sort: DESC_COST });
    expect(view.grandTotal.hasUnpriced).toBe(true);
    // Overview is scope-independent: it still flags unpriced from row a.
    expect(view.overview.hasUnpriced).toBe(true);
  });

  it("exposes the selected FolderEntry for the breadcrumb when the folder is known", () => {
    const rows = [
      summary({ id: "a", folder: "fA", path: "/p/alpha", costUsd: 9 }),
      summary({ id: "b", folder: "fB", path: "/p/beta", costUsd: 100 }),
    ];
    const view = buildListView(rows, { folder: "fA", sort: DESC_COST });
    expect(view.selectedFolder?.folder).toBe("fA");
    expect(view.selectedFolder?.label).toBe("alpha");
    // The selected entry is the SAME object as in the folder list.
    expect(view.folders).toContain(view.selectedFolder);
  });

  it("does not mutate the input rows array", () => {
    const rows = [summary({ id: "a", folder: "fA", costUsd: 9 }), summary({ id: "b", folder: "fA", costUsd: 1 })];
    const before = rows.map((r) => r.id);
    buildListView(rows, { folder: "fA", sort: ASC_COST });
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

// grandTotal bucket-summing behavior, migrated from format.test.ts, exercised
// through the scoped table slice (unscoped here so all rows count).
describe("buildListView — grandTotal bucket sums (migrated from grandTotal)", () => {
  // A row whose `total` defaults to the sum of its buckets, the way the core
  // writes it — so the bucket sums here are asserted against a coherent row.
  function withTokens(id: string, t: Partial<Tokens>, costUsd: number, unpriced = false) {
    const total = t.total ?? (t.input ?? 0) + (t.output ?? 0) + (t.cacheWrite ?? 0) + (t.cacheRead ?? 0);
    return summary({ id, costUsd, unpriced, tokens: { ...t, total } });
  }

  it("sums tokens by bucket and sums costUsd across rows", () => {
    const rows = [
      withTokens("a", { input: 10, output: 20, cacheWrite: 1, cacheRead: 2 }, 1.5),
      withTokens("b", { input: 5, output: 7, cacheWrite: 3, cacheRead: 4 }, 2.25),
    ];
    const view = buildListView(rows, { sort: DESC_COST });
    expect(view.grandTotal.tokens).toEqual({
      input: 15,
      output: 27,
      cacheWrite: 4,
      cacheRead: 6,
      total: 52,
    });
    expect(view.grandTotal.costUsd).toBe(3.75);
    expect(view.grandTotal.hasUnpriced).toBe(false);
  });

  it("returns a zeroed grandTotal for an empty (no-rows) scope", () => {
    const view = buildListView([], { sort: DESC_COST });
    expect(view.grandTotal.tokens).toEqual({
      input: 0,
      output: 0,
      cacheWrite: 0,
      cacheRead: 0,
      total: 0,
    });
    expect(view.grandTotal.costUsd).toBe(0);
    expect(view.grandTotal.hasUnpriced).toBe(false);
  });
});

describe("buildListView — errors-only filter (issue #47)", () => {
  const rows = [
    summary({ id: "a", folder: "fA", costUsd: 9, errorCount: 2 }),
    summary({ id: "b", folder: "fB", costUsd: 100, errorCount: 1 }),
    summary({ id: "c", folder: "fA", costUsd: 1, errorCount: 0 }),
  ];

  it("shows every row when the filter is off (the default)", () => {
    expect(buildListView(rows, { sort: DESC_COST }).rows.map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(buildListView(rows, { sort: DESC_COST, errorsOnly: false }).rows.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  it("keeps only conversations with at least one API error", () => {
    const view = buildListView(rows, { sort: DESC_COST, errorsOnly: true });
    expect(view.rows.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("composes with folder scoping and sorting", () => {
    const view = buildListView(rows, {
      folder: "fA",
      sort: DESC_COST,
      errorsOnly: true,
    });
    expect(view.rows.map((r) => r.id)).toEqual(["a"]);
    expect(view.scoped).toBe(true);
  });

  it("sums the grandTotal over the FILTERED rows, like folder scoping does", () => {
    const view = buildListView(rows, { sort: DESC_COST, errorsOnly: true });
    expect(view.grandTotal.costUsd).toBeCloseTo(109);
  });

  it("leaves the overview band and sidebar totals global (never filtered)", () => {
    const view = buildListView(rows, { sort: DESC_COST, errorsOnly: true });
    expect(view.overview.conversationCount).toBe(3);
    expect(view.overview.totalCost).toBeCloseTo(110);
    expect(view.totals.count).toBe(3);
  });
});

describe("clampPage", () => {
  it("keeps a page that exists", () => {
    expect(clampPage(3, 5)).toBe(3);
  });

  it("clamps a page beyond the end down to the last page", () => {
    expect(clampPage(99, 5)).toBe(5);
  });

  it("clamps a page below the range up to page 1", () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(-3, 5)).toBe(1);
  });

  it("yields page 1 when there are no pages at all (an empty set is page 1 of 1)", () => {
    expect(clampPage(1, 0)).toBe(1);
    expect(clampPage(7, 0)).toBe(1);
  });
});

/** `count` rows with descending cost, so `DESC_COST` keeps them in id order. */
function costRankedRows(count: number) {
  return Array.from({ length: count }, (_, i) => summary({ id: `r${String(i).padStart(3, "0")}`, costUsd: count - i }));
}

describe("buildListView — pagination (issue #63)", () => {
  it("renders at most one page of rows, defaulting to the first page", () => {
    const view = buildListView(costRankedRows(60), { sort: DESC_COST });
    expect(view.rows).toHaveLength(PAGE_SIZE);
    expect(view.rows[0].id).toBe("r000");
    expect(view.page).toBe(1);
    expect(view.pageCount).toBe(2);
  });

  it("serves the next slice, in sorted order, on page 2", () => {
    const view = buildListView(costRankedRows(60), { sort: DESC_COST, page: 2 });
    expect(view.rows.map((r) => r.id)).toEqual(
      costRankedRows(60)
        .slice(50)
        .map((r) => r.id),
    );
  });

  it("serves only the remainder on the last, partial page", () => {
    const view = buildListView(costRankedRows(51), { sort: DESC_COST, page: 2 });
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].id).toBe("r050");
    expect(view.pageCount).toBe(2);
  });

  it("keeps a full last page whole when the count divides exactly", () => {
    const view = buildListView(costRankedRows(100), { sort: DESC_COST, page: 2 });
    expect(view.rows).toHaveLength(PAGE_SIZE);
    expect(view.pageCount).toBe(2);
  });

  it("clamps a page beyond the end to the last page instead of rendering nothing", () => {
    const view = buildListView(costRankedRows(60), { sort: DESC_COST, page: 99 });
    expect(view.page).toBe(2);
    expect(view.rows).toHaveLength(10);
  });

  it("clamps a page below the range to the first page", () => {
    const view = buildListView(costRankedRows(60), { sort: DESC_COST, page: 0 });
    expect(view.page).toBe(1);
    expect(view.rows).toHaveLength(PAGE_SIZE);
  });

  it("counts and totals the WHOLE scoped set, not the visible page", () => {
    const view = buildListView(costRankedRows(60), { sort: DESC_COST });
    expect(view.rowCount).toBe(60);
    // 60 rows costing 60, 59, … 1.
    expect(view.grandTotal.costUsd).toBeCloseTo((60 * 61) / 2);
  });

  it("is page 1 of 1 with no rows when the scoped set is empty", () => {
    const view = buildListView([], { sort: DESC_COST, page: 3 });
    expect(view.rows).toEqual([]);
    expect(view.page).toBe(1);
    expect(view.pageCount).toBe(1);
    expect(view.rowCount).toBe(0);
  });

  it("paginates what the folder scope and the errors filter left, not the raw set", () => {
    const rows = [
      ...costRankedRows(60),
      ...Array.from({ length: 5 }, (_, i) => summary({ id: `x${i}`, folder: "fOther", errorCount: 1 })),
    ];
    const scoped = buildListView(rows, { sort: DESC_COST, folder: "fOther" });
    expect(scoped.rowCount).toBe(5);
    expect(scoped.pageCount).toBe(1);
    expect(scoped.rows).toHaveLength(5);

    const failing = buildListView(rows, { sort: DESC_COST, errorsOnly: true });
    expect(failing.rowCount).toBe(5);
    expect(failing.rows).toHaveLength(5);
  });
});
