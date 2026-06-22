import { describe, expect, it } from "vitest";

import type { Tokens } from "@/core/cost";
import type { ConversationSummary } from "@/core/read";

import { buildListView } from "@/app/_lib/list-view";
import type { SortState } from "@/app/_lib/sort";

// Minimal ConversationSummary factory — each test sets only what it asserts on.
// Mirrors the inline `summary()` helper the folders/overview tests use.
function summary(over: {
  id: string;
  folder?: string;
  path?: string;
  startedAt?: string;
  endedAt?: string;
  costUsd?: number;
  cacheRead?: number;
  total?: number;
  unpriced?: boolean;
}): ConversationSummary {
  const path = over.path ?? "/Users/me/dev/demo";
  const folder = over.folder ?? path.replace(/\//g, "-");
  const total = over.total ?? 0;
  return {
    id: over.id,
    title: `t-${over.id}`,
    project: { folder, path },
    startedAt: over.startedAt ?? "2026-01-01T00:00:00.000Z",
    endedAt: over.endedAt ?? "2026-01-01T01:00:00.000Z",
    models: { dominant: "opus", distinctCount: 1 },
    tokens: {
      input: 0,
      output: 0,
      cacheWrite: 0,
      cacheRead: over.cacheRead ?? 0,
      total,
    },
    costUsd: over.costUsd ?? 0,
    unpriced: over.unpriced ?? false,
    subAgentCount: 0,
    continuedFromId: null,
  };
}

const ASC_COST: SortState = { sortBy: "cost", dir: "asc" };
const DESC_COST: SortState = { sortBy: "cost", dir: "desc" };

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
    const rows = [
      summary({ id: "a", folder: "fA", path: "/p/alpha", costUsd: 5 }),
      summary({ id: "b", folder: "fB", path: "/p/beta", costUsd: 30 }),
      summary({ id: "c", folder: "fC", path: "/p/gamma", costUsd: 12 }),
    ];
    const view = buildListView(rows);
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
      summary({ id: "a", costUsd: 10, total: 100 }),
      summary({ id: "b", costUsd: 5, total: 50, unpriced: true }),
    ]);
    expect(overview.totalCost).toBeCloseTo(15);
    expect(overview.tokens.total).toBe(150);
    expect(overview.hasUnpriced).toBe(true);
  });

  it("computes the cache-read ratio as cacheRead / total tokens", () => {
    const { overview } = buildListView([
      summary({ id: "a", total: 100, cacheRead: 60 }),
      summary({ id: "b", total: 100, cacheRead: 20 }),
    ]);
    expect(overview.cacheReadRatio).toBeCloseTo(0.4);
  });

  it("returns a zero cache-read ratio when there are no tokens (no divide by zero)", () => {
    const { overview } = buildListView([
      summary({ id: "a", total: 0, cacheRead: 0 }),
    ]);
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
  const rows = [
    summary({ id: "a", folder: "fA", path: "/p/alpha", costUsd: 5 }),
    summary({ id: "b", folder: "fB", path: "/p/beta", costUsd: 30 }),
    summary({ id: "c", folder: "fC", path: "/p/gamma", costUsd: 12 }),
  ];

  it("orders Projects by cost descending, limited to the top 5", () => {
    const { topProjects } = buildListView(rows);
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
      summary({ id: "a", folder: "fA", costUsd: 9, total: 90 }),
      summary({ id: "b", folder: "fB", costUsd: 100, total: 1000 }),
      summary({ id: "c", folder: "fA", costUsd: 1, total: 10 }),
    ];
    const view = buildListView(rows, { folder: "fA", sort: DESC_COST });
    expect(view.grandTotal.costUsd).toBeCloseTo(10);
    expect(view.grandTotal.tokens.total).toBe(100);
    expect(view.grandTotal.hasUnpriced).toBe(false);
  });

  it("returns rows: [] and scoped: true for a stale ?folder= (folder no longer present)", () => {
    const rows = [
      summary({ id: "a", folder: "fA", costUsd: 9 }),
      summary({ id: "b", folder: "fB", costUsd: 100 }),
    ];
    const view = buildListView(rows, { folder: "fGhost", sort: DESC_COST });
    expect(view.rows).toEqual([]);
    expect(view.scoped).toBe(true);
    expect(view.selectedFolder).toBeUndefined();
  });

  it("treats an empty/undefined folder as 'All folders' (unscoped)", () => {
    const rows = [
      summary({ id: "a", folder: "fA", costUsd: 9 }),
      summary({ id: "b", folder: "fB", costUsd: 100 }),
    ];
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
    const rows = [
      summary({ id: "a", folder: "fA", costUsd: 9 }),
      summary({ id: "b", folder: "fA", costUsd: 1 }),
    ];
    const before = rows.map((r) => r.id);
    buildListView(rows, { folder: "fA", sort: ASC_COST });
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

// grandTotal bucket-summing behavior, migrated from format.test.ts, exercised
// through the scoped table slice (unscoped here so all rows count).
describe("buildListView — grandTotal bucket sums (migrated from grandTotal)", () => {
  function withTokens(id: string, t: Partial<Tokens>, costUsd: number, unpriced = false) {
    const tokens: Tokens = {
      input: t.input ?? 0,
      output: t.output ?? 0,
      cacheWrite: t.cacheWrite ?? 0,
      cacheRead: t.cacheRead ?? 0,
      total:
        t.total ??
        (t.input ?? 0) + (t.output ?? 0) + (t.cacheWrite ?? 0) + (t.cacheRead ?? 0),
    };
    const base = summary({ id, costUsd, unpriced });
    return { ...base, tokens };
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
