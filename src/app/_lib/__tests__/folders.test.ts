import { describe, expect, it } from "vitest";

import type { ConversationSummary } from "@/core/read";

import { deriveFolders, type FolderEntry } from "@/app/_lib/folders";

import { summary } from "./helpers/summaries";

/** One shared latest activity, so ordering is decided by the tiebreak, not time. */
const TIE_AT = "2026-05-01T00:00:00.000Z";

/** Two Projects whose paths share the basename `demo` — a label collision. */
const COLLIDING_DEMOS = [
  summary({ id: "a", path: "/Users/me/dev/demo", endedAt: TIE_AT }),
  summary({ id: "b", path: "/Users/me/tmp/demo", endedAt: TIE_AT }),
];

function labels(rows: { label: string }[]): string[] {
  return rows.map((r) => r.label);
}

/** Index derived folder entries by their Project path for direct assertions. */
function entryByPath(rows: ConversationSummary[]): Record<string, FolderEntry> {
  return Object.fromEntries(deriveFolders(rows).map((e) => [e.path, e]));
}

describe("deriveFolders", () => {
  it("produces one entry per distinct Project path with count and label", () => {
    const rows = [
      summary({ id: "a", path: "/Users/me/dev/alpha" }),
      summary({ id: "b", path: "/Users/me/dev/alpha" }),
      summary({ id: "c", path: "/Users/me/dev/beta" }),
    ];
    const entries = deriveFolders(rows);
    expect(entries.map((e) => e.path).sort()).toEqual(["/Users/me/dev/alpha", "/Users/me/dev/beta"]);

    const ent = entryByPath(rows);
    expect(ent["/Users/me/dev/alpha"].count).toBe(2);
    expect(ent["/Users/me/dev/alpha"].label).toBe("alpha");
    expect(ent["/Users/me/dev/beta"].count).toBe(1);
    expect(ent["/Users/me/dev/beta"].label).toBe("beta");
  });

  it("labels a repo and its worktree each from its own path", () => {
    const ent = entryByPath([
      summary({ id: "a", path: "/Users/me/dev/repo" }),
      summary({ id: "b", path: "/Users/me/dev/repo/.claude/worktrees/feature" }),
    ]);
    expect(ent["/Users/me/dev/repo"].label).toBe("repo");
    expect(ent["/Users/me/dev/repo/.claude/worktrees/feature"].label).toBe("feature");
  });

  it("uses the max endedAt as latest activity across a Project's conversations", () => {
    const rows = [
      summary({ id: "a", path: "/p/f", endedAt: "2026-01-01T00:00:00.000Z" }),
      summary({ id: "b", path: "/p/f", endedAt: "2026-03-01T00:00:00.000Z" }),
      summary({ id: "c", path: "/p/f", endedAt: "2026-02-01T00:00:00.000Z" }),
    ];
    expect(deriveFolders(rows)[0].latestActivity).toBe("2026-03-01T00:00:00.000Z");
  });

  it("falls back to startedAt when a row's endedAt is empty", () => {
    const rows = [
      // Latest endedAt is Feb; but a row with empty endedAt started in April —
      // its startedAt must be considered, making April the latest activity.
      summary({ id: "a", path: "/p/f", endedAt: "2026-02-01T00:00:00.000Z" }),
      summary({
        id: "b",
        path: "/p/f",
        startedAt: "2026-04-01T00:00:00.000Z",
        endedAt: "",
      }),
    ];
    expect(deriveFolders(rows)[0].latestActivity).toBe("2026-04-01T00:00:00.000Z");
  });

  it("yields empty latest activity when no timestamps are known", () => {
    const rows = [summary({ id: "a", path: "/p/f", startedAt: "", endedAt: "" })];
    expect(deriveFolders(rows)[0].latestActivity).toBe("");
  });

  it("orders Projects by latest activity descending (newest on top)", () => {
    const rows = [
      summary({ id: "a", path: "/p/old", endedAt: "2026-01-01T00:00:00.000Z" }),
      summary({ id: "b", path: "/p/new", endedAt: "2026-03-01T00:00:00.000Z" }),
      summary({ id: "c", path: "/p/mid", endedAt: "2026-02-01T00:00:00.000Z" }),
    ];
    expect(deriveFolders(rows).map((e) => e.path)).toEqual(["/p/new", "/p/mid", "/p/old"]);
  });

  it("breaks latest-activity ties by friendly label ascending (deterministic)", () => {
    const rows = [
      summary({ id: "a", path: "/p/zebra", endedAt: TIE_AT }),
      summary({ id: "b", path: "/p/apple", endedAt: TIE_AT }),
      summary({ id: "c", path: "/p/mango", endedAt: TIE_AT }),
    ];
    expect(labels(deriveFolders(rows))).toEqual(["apple", "mango", "zebra"]);
  });

  it("disambiguates a basename collision with the minimal unique trailing suffix", () => {
    // Both basenames are "demo"; one trailing segment more makes them unique.
    expect(labels(deriveFolders(COLLIDING_DEMOS))).toEqual(["dev/demo", "tmp/demo"]);
  });

  it("keeps a bare basename when it is already unique among Projects", () => {
    const rows = [...COLLIDING_DEMOS, summary({ id: "c", path: "/Users/me/work/unique", endedAt: TIE_AT })];
    // "unique" is not part of the collision -> stays a bare basename.
    expect(labels(deriveFolders(rows))).toEqual(["dev/demo", "tmp/demo", "unique"]);
  });

  it("widens a 3-way collision to the depth that makes the WHOLE group unique", () => {
    const rows = [
      summary({ id: "a", path: "/a/x/app", endedAt: TIE_AT }),
      summary({ id: "b", path: "/b/x/app", endedAt: TIE_AT }),
      summary({ id: "c", path: "/a/y/app", endedAt: TIE_AT }),
    ];
    const ent = entryByPath(rows);
    // Depth 2 gives x/app, x/app, y/app -> still colliding, so the group widens
    // uniformly to depth 3 where all three become unique.
    expect(ent["/a/x/app"].label).toBe("a/x/app");
    expect(ent["/b/x/app"].label).toBe("b/x/app");
    expect(ent["/a/y/app"].label).toBe("a/y/app");
  });

  it("labels a Windows Project by its last `\\`-separated segment, widened with `\\` on a collision", () => {
    const ent = entryByPath([
      summary({ id: "a", path: "C:\\Users\\me\\repo", endedAt: TIE_AT }),
      summary({ id: "b", path: "C:\\Users\\me\\a\\app", endedAt: TIE_AT }),
      summary({ id: "c", path: "C:\\Users\\me\\b\\app", endedAt: TIE_AT }),
    ]);
    expect(ent["C:\\Users\\me\\repo"].label).toBe("repo");
    expect(ent["C:\\Users\\me\\a\\app"].label).toBe("a\\app");
    expect(ent["C:\\Users\\me\\b\\app"].label).toBe("b\\app");
  });

  it("sums costUsd and total tokens across each Project's conversations", () => {
    const rows = [
      summary({ id: "a", path: "/p/fA", costUsd: 10, tokens: { total: 100 } }),
      summary({ id: "b", path: "/p/fA", costUsd: 5, tokens: { total: 50 } }),
      summary({ id: "c", path: "/p/fB", costUsd: 2, tokens: { total: 20 } }),
    ];
    const ent = entryByPath(rows);
    expect(ent["/p/fA"].costUsd).toBeCloseTo(15);
    expect(ent["/p/fA"].tokensTotal).toBe(150);
    expect(ent["/p/fB"].costUsd).toBeCloseTo(2);
    expect(ent["/p/fB"].tokensTotal).toBe(20);
  });

  it("flags a Project as unpriced when ANY of its conversations is unpriced", () => {
    const rows = [
      summary({ id: "a", path: "/p/fA", costUsd: 10, unpriced: false }),
      summary({ id: "b", path: "/p/fA", costUsd: 0, unpriced: true }),
      summary({ id: "c", path: "/p/fB", costUsd: 3, unpriced: false }),
    ];
    const ent = entryByPath(rows);
    expect(ent["/p/fA"].unpriced).toBe(true);
    expect(ent["/p/fB"].unpriced).toBe(false);
  });
});
