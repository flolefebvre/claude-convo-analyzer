import { describe, expect, it } from "vitest";

import type { ConversationSummary } from "@/core/refresh";

import {
  DEFAULT_SORT,
  isSortableField,
  modelLabel,
  resolveSort,
  sortConversations,
  sortHref,
  sortIndicator,
  toggleSort,
} from "@/app/_lib/sort";

describe("resolveSort", () => {
  it("defaults to cost desc when no params are given", () => {
    expect(resolveSort(undefined, undefined)).toEqual(DEFAULT_SORT);
    expect(DEFAULT_SORT).toEqual({ sortBy: "cost", dir: "desc" });
  });

  it("uses valid sortBy + dir from params", () => {
    expect(resolveSort("title", "asc")).toEqual({ sortBy: "title", dir: "asc" });
  });

  it("honors every sortable column", () => {
    for (const field of [
      "folder",
      "title",
      "model",
      "input",
      "output",
      "cacheWrite",
      "cacheRead",
      "total",
      "cost",
    ]) {
      expect(resolveSort(field, "asc")).toEqual({ sortBy: field, dir: "asc" });
    }
  });

  it("ignores an unknown field and falls back to the default", () => {
    // `tokens` / `costUsd` are core field names, not app column keys — rejected.
    expect(resolveSort("tokens", "asc")).toEqual(DEFAULT_SORT);
    expect(resolveSort("costUsd", "asc")).toEqual(DEFAULT_SORT);
    expect(resolveSort("bogus", "asc")).toEqual(DEFAULT_SORT);
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
    expect(isSortableField("input")).toBe(true);
    expect(isSortableField("output")).toBe(true);
    expect(isSortableField("cacheWrite")).toBe(true);
    expect(isSortableField("cacheRead")).toBe(true);
    expect(isSortableField("total")).toBe(true);
    expect(isSortableField("cost")).toBe(true);
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
    expect(toggleSort("input", { sortBy: "title", dir: "asc" })).toEqual({
      sortBy: "input",
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
    expect(sortHref("title", { sortBy: "cost", dir: "desc" })).toBe(
      "?sortBy=title&dir=asc",
    );
  });

  it("encodes the flipped dir when re-clicking the active field", () => {
    expect(sortHref("cost", { sortBy: "cost", dir: "desc" })).toBe(
      "?sortBy=cost&dir=asc",
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
  tokens?: Partial<ConversationSummary["tokens"]>;
  costUsd?: number;
}): ConversationSummary {
  return {
    id: over.id,
    title: over.title === undefined ? `t-${over.id}` : over.title,
    project: { folder: over.folder ?? "f", path: `/p/${over.folder ?? "f"}` },
    startedAt: "2026-01-01T00:00:00.000Z",
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
    unpriced: false,
    subAgentCount: 0,
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

  it("sorts a token column numerically (not lexically) in both dirs", () => {
    const rows = [
      summary({ id: "a", tokens: { input: 9 } }),
      summary({ id: "b", tokens: { input: 100 } }),
      summary({ id: "c", tokens: { input: 11 } }),
    ];
    // Lexical order would put 100 < 11 < 9; numeric must put 9 < 11 < 100.
    expect(ids(sortConversations(rows, { sortBy: "input", dir: "asc" }))).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(ids(sortConversations(rows, { sortBy: "input", dir: "desc" }))).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("sorts each numeric token column by its own bucket", () => {
    const rows = [
      summary({ id: "a", tokens: { output: 1, cacheWrite: 3, cacheRead: 2, total: 1 } }),
      summary({ id: "b", tokens: { output: 2, cacheWrite: 1, cacheRead: 3, total: 3 } }),
      summary({ id: "c", tokens: { output: 3, cacheWrite: 2, cacheRead: 1, total: 2 } }),
    ];
    expect(ids(sortConversations(rows, { sortBy: "output", dir: "asc" }))).toEqual(["a", "b", "c"]);
    expect(ids(sortConversations(rows, { sortBy: "cacheWrite", dir: "asc" }))).toEqual(["b", "c", "a"]);
    expect(ids(sortConversations(rows, { sortBy: "cacheRead", dir: "asc" }))).toEqual(["c", "a", "b"]);
    expect(ids(sortConversations(rows, { sortBy: "total", dir: "asc" }))).toEqual(["a", "c", "b"]);
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
