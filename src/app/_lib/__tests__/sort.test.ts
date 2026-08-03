import { describe, expect, it } from "vitest";

import type { ConversationSummary } from "@/core/read";

import {
  DEFAULT_SORT,
  expandHref,
  folderHref,
  isSortableField,
  modelLabel,
  resolveExpanded,
  resolveSort,
  sortConversations,
  sortHref,
  sortIndicator,
  toggleSort,
} from "@/app/_lib/sort";

describe("resolveSort", () => {
  it("defaults to date desc when no params are given", () => {
    expect(resolveSort(undefined, undefined)).toEqual(DEFAULT_SORT);
    expect(DEFAULT_SORT).toEqual({ sortBy: "date", dir: "desc" });
  });

  it("uses valid sortBy + dir from params", () => {
    expect(resolveSort("title", "asc")).toEqual({ sortBy: "title", dir: "asc" });
  });

  it("honors every sortable column", () => {
    for (const field of ["folder", "title", "model", "date", "total", "cost"]) {
      expect(resolveSort(field, "asc")).toEqual({ sortBy: field, dir: "asc" });
    }
  });

  it("ignores an unknown field and falls back to the default", () => {
    // `tokens` / `costUsd` are core field names, not app column keys — rejected.
    expect(resolveSort("tokens", "asc")).toEqual(DEFAULT_SORT);
    expect(resolveSort("costUsd", "asc")).toEqual(DEFAULT_SORT);
    expect(resolveSort("bogus", "asc")).toEqual(DEFAULT_SORT);
  });

  it("rejects the per-token columns, which are no longer sortable", () => {
    for (const field of ["input", "output", "cacheWrite", "cacheRead"]) {
      expect(resolveSort(field, "asc")).toEqual(DEFAULT_SORT);
    }
  });

  it("falls back to the field's default dir when dir is missing or invalid", () => {
    // cost defaults to desc.
    expect(resolveSort("cost", undefined)).toEqual({
      sortBy: "cost",
      dir: "desc",
    });
    // title defaults to asc.
    expect(resolveSort("title", "sideways")).toEqual({
      sortBy: "title",
      dir: "asc",
    });
  });

  it("reads the first value when a param arrives as an array", () => {
    expect(resolveSort(["title", "id"], ["asc", "desc"])).toEqual({
      sortBy: "title",
      dir: "asc",
    });
  });
});

describe("isSortableField", () => {
  it("accepts every app column key", () => {
    expect(isSortableField("folder")).toBe(true);
    expect(isSortableField("title")).toBe(true);
    expect(isSortableField("model")).toBe(true);
    expect(isSortableField("date")).toBe(true);
    expect(isSortableField("total")).toBe(true);
    expect(isSortableField("cost")).toBe(true);
  });

  it("rejects the per-token columns (no longer sortable)", () => {
    expect(isSortableField("input")).toBe(false);
    expect(isSortableField("output")).toBe(false);
    expect(isSortableField("cacheWrite")).toBe(false);
    expect(isSortableField("cacheRead")).toBe(false);
  });

  it("rejects core field names and unknown keys", () => {
    expect(isSortableField("tokens")).toBe(false);
    expect(isSortableField("costUsd")).toBe(false);
    expect(isSortableField("models")).toBe(false);
    expect(isSortableField("project")).toBe(false);
  });
});

describe("toggleSort", () => {
  it("toggles asc -> desc when clicking the active field", () => {
    expect(toggleSort("title", { sortBy: "title", dir: "asc" })).toEqual({
      sortBy: "title",
      dir: "desc",
    });
  });

  it("toggles desc -> asc when clicking the active field", () => {
    expect(toggleSort("cost", { sortBy: "cost", dir: "desc" })).toEqual({
      sortBy: "cost",
      dir: "asc",
    });
  });

  it("starts an inactive field at its own default dir", () => {
    // Active sort is title; clicking cost (default desc) starts at desc.
    expect(toggleSort("cost", { sortBy: "title", dir: "asc" })).toEqual({
      sortBy: "cost",
      dir: "desc",
    });
    // Active sort is cost; clicking title (default asc) starts at asc.
    expect(toggleSort("title", { sortBy: "cost", dir: "desc" })).toEqual({
      sortBy: "title",
      dir: "asc",
    });
  });

  it("starts an inactive numeric column at desc", () => {
    expect(toggleSort("total", { sortBy: "title", dir: "asc" })).toEqual({
      sortBy: "total",
      dir: "desc",
    });
  });

  it("starts an inactive string column at asc", () => {
    expect(toggleSort("folder", { sortBy: "cost", dir: "desc" })).toEqual({
      sortBy: "folder",
      dir: "asc",
    });
  });
});

describe("sortHref", () => {
  it("encodes the toggled sort as a query string", () => {
    expect(sortHref("title", { sort: { sortBy: "cost", dir: "desc" } })).toBe(
      "?sortBy=title&dir=asc",
    );
  });

  it("encodes the flipped dir when re-clicking the active field", () => {
    expect(sortHref("cost", { sort: { sortBy: "cost", dir: "desc" } })).toBe(
      "?sortBy=cost&dir=asc",
    );
  });

  it("preserves the active folder scope so sort composes with folder", () => {
    expect(
      sortHref("title", {
        sort: { sortBy: "cost", dir: "desc" },
        folder: "-Users-me-dev-demo",
      }),
    ).toBe("?sortBy=title&dir=asc&folder=-Users-me-dev-demo");
  });

  it("omits the folder param when there is no active scope", () => {
    expect(sortHref("title", { sort: { sortBy: "cost", dir: "desc" }, folder: undefined })).toBe(
      "?sortBy=title&dir=asc",
    );
  });

  it("url-encodes a folder value with special characters", () => {
    expect(sortHref("title", { sort: DEFAULT_SORT, folder: "a b&c" })).toBe(
      "?sortBy=title&dir=asc&folder=a+b%26c",
    );
  });
});

describe("range preservation across list links", () => {
  it("keeps an active trends range on a sort toggle", () => {
    expect(sortHref("cost", { sort: { sortBy: "date", dir: "desc" }, range: "90" })).toBe(
      "?sortBy=cost&dir=desc&range=90",
    );
  });

  it("keeps an active trends range on a row expand", () => {
    expect(expandHref("s1", undefined, {
      sort: DEFAULT_SORT,
      folder: "-Users-me-dev-demo",
      range: "7",
    })).toBe(
      "?sortBy=date&dir=desc&folder=-Users-me-dev-demo&expanded=s1&range=7",
    );
  });

  it("adds no range param when the URL carries none", () => {
    expect(sortHref("cost", { sort: DEFAULT_SORT })).toBe("?sortBy=cost&dir=desc");
    expect(expandHref("s1", undefined, { sort: DEFAULT_SORT })).toBe(
      "?sortBy=date&dir=desc&expanded=s1",
    );
  });
});

describe("folderHref", () => {
  it("sets the folder param while preserving the active sort", () => {
    expect(folderHref("-Users-me-dev-demo", { sort: { sortBy: "cost", dir: "desc" } })).toBe(
      "?sortBy=cost&dir=desc&folder=-Users-me-dev-demo",
    );
  });

  it("clears the folder param (All folders) but keeps the sort", () => {
    expect(folderHref(undefined, { sort: { sortBy: "title", dir: "asc" } })).toBe(
      "?sortBy=title&dir=asc",
    );
  });

  it("preserves an active trends range so folder and range compose", () => {
    expect(folderHref("-Users-me-dev-demo", { sort: DEFAULT_SORT, range: "90" })).toBe(
      "?sortBy=date&dir=desc&folder=-Users-me-dev-demo&range=90",
    );
    // No range in the URL (the conversation list) -> no range param.
    expect(folderHref("-Users-me-dev-demo", { sort: DEFAULT_SORT })).toBe(
      "?sortBy=date&dir=desc&folder=-Users-me-dev-demo",
    );
  });

  it("url-encodes a folder value with special characters", () => {
    expect(folderHref("a b&c", { sort: DEFAULT_SORT })).toBe(
      "?sortBy=date&dir=desc&folder=a+b%26c",
    );
  });
});

describe("resolveExpanded", () => {
  it("returns undefined when the param is absent", () => {
    expect(resolveExpanded(undefined)).toBeUndefined();
  });

  it("returns the conversation id from a string param", () => {
    expect(resolveExpanded("sess-basic")).toBe("sess-basic");
  });

  it("reads the first value when the param arrives as an array", () => {
    expect(resolveExpanded(["sess-a", "sess-b"])).toBe("sess-a");
  });

  it("treats an empty string as no expansion", () => {
    expect(resolveExpanded("")).toBeUndefined();
  });
});

describe("expandHref", () => {
  it("expands a collapsed row while preserving sort and folder", () => {
    expect(
      expandHref("sess-basic", undefined, {
        sort: { sortBy: "cost", dir: "desc" },
        folder: "-Users-me-dev-demo",
      }),
    ).toBe("?sortBy=cost&dir=desc&folder=-Users-me-dev-demo&expanded=sess-basic");
  });

  it("expands a collapsed row while ANOTHER row is expanded (replaces it)", () => {
    expect(expandHref("sess-b", "sess-a", { sort: DEFAULT_SORT })).toBe(
      "?sortBy=date&dir=desc&expanded=sess-b",
    );
  });

  it("collapses the already-expanded row (drops the param) keeping sort and folder", () => {
    expect(
      expandHref("sess-basic", "sess-basic", {
        sort: { sortBy: "cost", dir: "desc" },
        folder: "-Users-me-dev-demo",
      }),
    ).toBe("?sortBy=cost&dir=desc&folder=-Users-me-dev-demo");
  });

  it("omits the folder param when there is no active scope", () => {
    expect(expandHref("sess-basic", undefined, { sort: DEFAULT_SORT })).toBe(
      "?sortBy=date&dir=desc&expanded=sess-basic",
    );
  });

  it("url-encodes a row id with special characters", () => {
    expect(expandHref("a b&c", undefined, { sort: DEFAULT_SORT })).toBe(
      "?sortBy=date&dir=desc&expanded=a+b%26c",
    );
  });
});

describe("sortIndicator", () => {
  it("shows an up arrow for the active ascending field", () => {
    expect(sortIndicator("title", { sortBy: "title", dir: "asc" })).toBe("↑");
  });

  it("shows a down arrow for the active descending field", () => {
    expect(sortIndicator("cost", { sortBy: "cost", dir: "desc" })).toBe("↓");
  });

  it("shows nothing for an inactive field", () => {
    expect(sortIndicator("title", { sortBy: "cost", dir: "desc" })).toBe("");
  });
});

describe("modelLabel", () => {
  it("returns just the dominant model when there is a single model", () => {
    expect(modelLabel({ dominant: "opus", distinctCount: 1 })).toEqual({
      dominant: "opus",
      extra: 0,
    });
  });

  it("reports the count of OTHER models as `extra` when there are several", () => {
    // distinctCount 3 means the dominant + 2 others, so extra = 2 (+2 badge).
    expect(modelLabel({ dominant: "opus", distinctCount: 3 })).toEqual({
      dominant: "opus",
      extra: 2,
    });
  });

  it("never reports a negative extra", () => {
    expect(modelLabel({ dominant: "", distinctCount: 0 })).toEqual({
      dominant: "",
      extra: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// sortConversations — the app-zone comparator. Build minimal summaries via a
// factory so each test states only the field(s) under test.
// ---------------------------------------------------------------------------

function summary(over: {
  id: string;
  title?: string | null;
  folder?: string;
  dominant?: string;
  startedAt?: string;
  tokens?: Partial<ConversationSummary["tokens"]>;
  costUsd?: number;
}): ConversationSummary {
  return {
    id: over.id,
    title: over.title === undefined ? `t-${over.id}` : over.title,
    project: { folder: over.folder ?? "f", path: `/p/${over.folder ?? "f"}` },
    startedAt: over.startedAt ?? "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T01:00:00.000Z",
    models: { dominant: over.dominant ?? "opus", distinctCount: 1 },
    tokens: {
      input: 0,
      output: 0,
      cacheWrite: 0,
      cacheRead: 0,
      total: 0,
      ...over.tokens,
    },
    costUsd: over.costUsd ?? 0,
    costByType: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    unpriced: false,
    subAgentCount: 0,
    errorCount: 0,
    continuedFromId: null,
  };
}

function ids(rows: readonly ConversationSummary[]): string[] {
  return rows.map((r) => r.id);
}

describe("sortConversations", () => {
  it("does not mutate the input array", () => {
    const rows = [summary({ id: "a", costUsd: 1 }), summary({ id: "b", costUsd: 2 })];
    const before = ids(rows);
    sortConversations(rows, { sortBy: "cost", dir: "desc" });
    expect(ids(rows)).toEqual(before);
  });

  it("sorts cost ascending and descending", () => {
    const rows = [
      summary({ id: "a", costUsd: 3 }),
      summary({ id: "b", costUsd: 1 }),
      summary({ id: "c", costUsd: 2 }),
    ];
    expect(ids(sortConversations(rows, { sortBy: "cost", dir: "asc" }))).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(ids(sortConversations(rows, { sortBy: "cost", dir: "desc" }))).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("sorts the total-tokens column numerically (not lexically) in both dirs", () => {
    const rows = [
      summary({ id: "a", tokens: { total: 9 } }),
      summary({ id: "b", tokens: { total: 100 } }),
      summary({ id: "c", tokens: { total: 11 } }),
    ];
    // Lexical order would put 100 < 11 < 9; numeric must put 9 < 11 < 100.
    expect(ids(sortConversations(rows, { sortBy: "total", dir: "asc" }))).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(ids(sortConversations(rows, { sortBy: "total", dir: "desc" }))).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("sorts date chronologically (by timestamp) in both dirs", () => {
    const rows = [
      summary({ id: "a", startedAt: "2026-03-01T00:00:00.000Z" }),
      summary({ id: "b", startedAt: "2026-01-01T00:00:00.000Z" }),
      summary({ id: "c", startedAt: "2026-02-01T00:00:00.000Z" }),
    ];
    // asc = oldest first.
    expect(ids(sortConversations(rows, { sortBy: "date", dir: "asc" }))).toEqual(["b", "c", "a"]);
    // desc = newest first.
    expect(ids(sortConversations(rows, { sortBy: "date", dir: "desc" }))).toEqual(["a", "c", "b"]);
  });

  it("sorts rows with empty/invalid startedAt last in BOTH directions", () => {
    const rows = [
      summary({ id: "a", startedAt: "" }),
      summary({ id: "b", startedAt: "not-a-date" }),
      summary({ id: "c", startedAt: "2026-01-01T00:00:00.000Z" }),
      summary({ id: "d", startedAt: "2026-02-01T00:00:00.000Z" }),
    ];
    // asc: dated rows oldest→newest, then the two undateable rows (id-tiebroken).
    expect(ids(sortConversations(rows, { sortBy: "date", dir: "asc" }))).toEqual(["c", "d", "a", "b"]);
    // desc: dated rows newest→oldest, undateable rows still LAST (not flipped first).
    expect(ids(sortConversations(rows, { sortBy: "date", dir: "desc" }))).toEqual(["d", "c", "a", "b"]);
  });

  it("sorts folder as a case-insensitive string", () => {
    const rows = [
      summary({ id: "a", folder: "Zebra" }),
      summary({ id: "b", folder: "apple" }),
      summary({ id: "c", folder: "Mango" }),
    ];
    // Case-sensitive ASCII would sort uppercase before lowercase (Z < a);
    // case-insensitive must give apple < Mango < Zebra.
    expect(ids(sortConversations(rows, { sortBy: "folder", dir: "asc" }))).toEqual(["b", "c", "a"]);
  });

  it("sorts model by the dominant model string", () => {
    const rows = [
      summary({ id: "a", dominant: "sonnet" }),
      summary({ id: "b", dominant: "haiku" }),
      summary({ id: "c", dominant: "opus" }),
    ];
    expect(ids(sortConversations(rows, { sortBy: "model", dir: "asc" }))).toEqual(["b", "c", "a"]);
  });

  it("sorts title as a string", () => {
    const rows = [
      summary({ id: "a", title: "Gamma" }),
      summary({ id: "b", title: "alpha" }),
      summary({ id: "c", title: "Beta" }),
    ];
    expect(ids(sortConversations(rows, { sortBy: "title", dir: "asc" }))).toEqual(["b", "c", "a"]);
  });

  it("sorts null titles last in BOTH directions", () => {
    const rows = [
      summary({ id: "a", title: null }),
      summary({ id: "b", title: "Beta" }),
      summary({ id: "c", title: "Alpha" }),
    ];
    // asc: Alpha, Beta, then null.
    expect(ids(sortConversations(rows, { sortBy: "title", dir: "asc" }))).toEqual(["c", "b", "a"]);
    // desc: Beta, Alpha, then null (null stays last, not flipped to first).
    expect(ids(sortConversations(rows, { sortBy: "title", dir: "desc" }))).toEqual(["b", "c", "a"]);
  });

  it("breaks ties by id so equal values keep a deterministic order", () => {
    const rows = [
      summary({ id: "c", costUsd: 5 }),
      summary({ id: "a", costUsd: 5 }),
      summary({ id: "b", costUsd: 5 }),
    ];
    // All equal on cost -> tiebreak by id ascending, regardless of dir.
    expect(ids(sortConversations(rows, { sortBy: "cost", dir: "asc" }))).toEqual(["a", "b", "c"]);
    expect(ids(sortConversations(rows, { sortBy: "cost", dir: "desc" }))).toEqual(["a", "b", "c"]);
  });
});
