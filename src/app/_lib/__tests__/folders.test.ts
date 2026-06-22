import { describe, expect, it } from "vitest";

import type { ConversationSummary } from "@/core/refresh";

import { deriveFolders, type FolderEntry } from "@/app/_lib/folders";

// Minimal ConversationSummary factory: each test states only the field(s) it
// cares about (project folder/path and the two timestamps).
function summary(over: {
  id: string;
  folder?: string;
  path?: string;
  startedAt?: string;
  endedAt?: string;
  costUsd?: number;
  tokensTotal?: number;
  unpriced?: boolean;
}): ConversationSummary {
  const path = over.path ?? "/Users/me/dev/demo";
  // Dash-encode the path the way the core does, unless an explicit folder key
  // is supplied (so tests can force a folder identity independent of path).
  const folder = over.folder ?? path.replace(/\//g, "-");
  const total = over.tokensTotal ?? 0;
  return {
    id: over.id,
    title: `t-${over.id}`,
    project: { folder, path },
    startedAt: over.startedAt ?? "2026-01-01T00:00:00.000Z",
    endedAt: over.endedAt ?? "2026-01-01T01:00:00.000Z",
    models: { dominant: "opus", distinctCount: 1 },
    tokens: { input: total, output: 0, cacheWrite: 0, cacheRead: 0, total },
    costUsd: over.costUsd ?? 0,
    unpriced: over.unpriced ?? false,
    subAgentCount: 0,
    continuedFromId: null,
  };
}

function labels(rows: { label: string }[]): string[] {
  return rows.map((r) => r.label);
}

/** Index derived folder entries by their folder key for direct assertions. */
function byKey(rows: ConversationSummary[]): Record<string, FolderEntry> {
  return Object.fromEntries(deriveFolders(rows).map((e) => [e.folder, e]));
}

describe("deriveFolders", () => {
  it("produces one entry per distinct Project with count, label, path and key", () => {
    const rows = [
      summary({ id: "a", folder: "fA", path: "/Users/me/dev/alpha" }),
      summary({ id: "b", folder: "fA", path: "/Users/me/dev/alpha" }),
      summary({ id: "c", folder: "fB", path: "/Users/me/dev/beta" }),
    ];
    const entries = deriveFolders(rows);
    expect(entries).toHaveLength(2);

    const byKey = Object.fromEntries(entries.map((e) => [e.folder, e]));
    expect(byKey.fA.count).toBe(2);
    expect(byKey.fA.label).toBe("alpha");
    expect(byKey.fA.path).toBe("/Users/me/dev/alpha");
    expect(byKey.fB.count).toBe(1);
    expect(byKey.fB.label).toBe("beta");
    expect(byKey.fB.path).toBe("/Users/me/dev/beta");
  });

  it("uses the max endedAt as latest activity across a Project's conversations", () => {
    const rows = [
      summary({ id: "a", folder: "f", endedAt: "2026-01-01T00:00:00.000Z" }),
      summary({ id: "b", folder: "f", endedAt: "2026-03-01T00:00:00.000Z" }),
      summary({ id: "c", folder: "f", endedAt: "2026-02-01T00:00:00.000Z" }),
    ];
    expect(deriveFolders(rows)[0].latestActivity).toBe("2026-03-01T00:00:00.000Z");
  });

  it("falls back to startedAt when a row's endedAt is empty", () => {
    const rows = [
      // Latest endedAt is Feb; but a row with empty endedAt started in April —
      // its startedAt must be considered, making April the latest activity.
      summary({ id: "a", folder: "f", endedAt: "2026-02-01T00:00:00.000Z" }),
      summary({
        id: "b",
        folder: "f",
        startedAt: "2026-04-01T00:00:00.000Z",
        endedAt: "",
      }),
    ];
    expect(deriveFolders(rows)[0].latestActivity).toBe("2026-04-01T00:00:00.000Z");
  });

  it("yields empty latest activity when no timestamps are known", () => {
    const rows = [summary({ id: "a", folder: "f", startedAt: "", endedAt: "" })];
    expect(deriveFolders(rows)[0].latestActivity).toBe("");
  });

  it("orders Projects by latest activity descending (newest on top)", () => {
    const rows = [
      summary({ id: "a", folder: "fOld", path: "/p/old", endedAt: "2026-01-01T00:00:00.000Z" }),
      summary({ id: "b", folder: "fNew", path: "/p/new", endedAt: "2026-03-01T00:00:00.000Z" }),
      summary({ id: "c", folder: "fMid", path: "/p/mid", endedAt: "2026-02-01T00:00:00.000Z" }),
    ];
    expect(deriveFolders(rows).map((e) => e.folder)).toEqual(["fNew", "fMid", "fOld"]);
  });

  it("breaks latest-activity ties by friendly label ascending (deterministic)", () => {
    const at = "2026-05-01T00:00:00.000Z";
    const rows = [
      summary({ id: "a", folder: "fZ", path: "/p/zebra", endedAt: at }),
      summary({ id: "b", folder: "fA", path: "/p/apple", endedAt: at }),
      summary({ id: "c", folder: "fM", path: "/p/mango", endedAt: at }),
    ];
    expect(labels(deriveFolders(rows))).toEqual(["apple", "mango", "zebra"]);
  });

  it("disambiguates a basename collision with the minimal unique trailing suffix", () => {
    const at = "2026-05-01T00:00:00.000Z";
    const rows = [
      summary({ id: "a", folder: "f1", path: "/Users/me/dev/demo", endedAt: at }),
      summary({ id: "b", folder: "f2", path: "/Users/me/tmp/demo", endedAt: at }),
    ];
    const ent = byKey(rows);
    // Both basenames are "demo"; one trailing segment more makes them unique.
    expect(ent.f1.label).toBe("dev/demo");
    expect(ent.f2.label).toBe("tmp/demo");
  });

  it("keeps a bare basename when it is already unique among Projects", () => {
    const at = "2026-05-01T00:00:00.000Z";
    const rows = [
      summary({ id: "a", folder: "f1", path: "/Users/me/dev/demo", endedAt: at }),
      summary({ id: "b", folder: "f2", path: "/Users/me/tmp/demo", endedAt: at }),
      summary({ id: "c", folder: "f3", path: "/Users/me/work/unique", endedAt: at }),
    ];
    const ent = byKey(rows);
    expect(ent.f1.label).toBe("dev/demo");
    expect(ent.f2.label).toBe("tmp/demo");
    // Not part of the collision -> stays a bare basename.
    expect(ent.f3.label).toBe("unique");
  });

  it("widens a 3-way collision to the depth that makes the WHOLE group unique", () => {
    const at = "2026-05-01T00:00:00.000Z";
    const rows = [
      summary({ id: "a", folder: "f1", path: "/a/x/app", endedAt: at }),
      summary({ id: "b", folder: "f2", path: "/b/x/app", endedAt: at }),
      summary({ id: "c", folder: "f3", path: "/a/y/app", endedAt: at }),
    ];
    const ent = byKey(rows);
    // Depth 2 gives x/app, x/app, y/app -> still colliding, so the group widens
    // uniformly to depth 3 where all three become unique.
    expect(ent.f1.label).toBe("a/x/app");
    expect(ent.f2.label).toBe("b/x/app");
    expect(ent.f3.label).toBe("a/y/app");
  });

  it("appends the folder key as a last resort when two Projects share an identical path", () => {
    const at = "2026-05-01T00:00:00.000Z";
    const rows = [
      summary({ id: "a", folder: "f1", path: "/Users/me/dev/demo", endedAt: at }),
      summary({ id: "b", folder: "f2", path: "/Users/me/dev/demo", endedAt: at }),
    ];
    const ent = byKey(rows);
    // Same path, distinct folder keys -> labels still unique + deterministic.
    expect(ent.f1.label).not.toBe(ent.f2.label);
    expect(ent.f1.label).toContain("f1");
    expect(ent.f2.label).toContain("f2");
  });

  it("sums costUsd and total tokens across each Project's conversations", () => {
    const rows = [
      summary({ id: "a", folder: "fA", costUsd: 10, tokensTotal: 100 }),
      summary({ id: "b", folder: "fA", costUsd: 5, tokensTotal: 50 }),
      summary({ id: "c", folder: "fB", costUsd: 2, tokensTotal: 20 }),
    ];
    const ent = byKey(rows);
    expect(ent.fA.costUsd).toBeCloseTo(15);
    expect(ent.fA.tokensTotal).toBe(150);
    expect(ent.fB.costUsd).toBeCloseTo(2);
    expect(ent.fB.tokensTotal).toBe(20);
  });

  it("flags a Project as unpriced when ANY of its conversations is unpriced", () => {
    const rows = [
      summary({ id: "a", folder: "fA", costUsd: 10, unpriced: false }),
      summary({ id: "b", folder: "fA", costUsd: 0, unpriced: true }),
      summary({ id: "c", folder: "fB", costUsd: 3, unpriced: false }),
    ];
    const ent = byKey(rows);
    expect(ent.fA.unpriced).toBe(true);
    expect(ent.fB.unpriced).toBe(false);
  });
});
