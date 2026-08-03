// Continuation families (issue #46): the walk over `continued_from` links that
// turns a set of conversation summaries into the connected component a given
// conversation belongs to. Every case is exercised through the public core
// functions over a database seeded by the REAL `refresh()` from fixture logs.
//
// These fixtures live in their OWN logs root (`fixtures/family-logs`), not the
// shared one: the family shapes need eight extra sessions, and adding them to
// the shared root both slowed every other refresh-based suite and collided with
// the corpus assertions of the FTS tests. The root encodes a standalone session,
// a linear chain, a fork, a cross-project resume, a broken parent link and a
// pathological cycle.

import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildFamily, familySizes } from "@/core/family";
import { listConversations } from "@/core/read";

import { seededTempDb } from "./helpers/temp-db";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "family-logs");

describe("buildFamily", () => {
  const db = seededTempDb({ prefix: "cca-family-", logsRoot: FIXTURES_ROOT });

  it("reports a conversation with no parent and no continuations as a family of one", async () => {
    const rows = await listConversations({ dbPath: db.dbPath });
    const family = buildFamily(rows, "sess-fam-solo");

    expect(family).not.toBeNull();
    if (family === null) return;
    expect(family.size).toBe(1);
    expect(family.members.map((m) => m.id)).toEqual(["sess-fam-solo"]);
    expect(family.parent).toBeNull();
    expect(family.children).toEqual([]);
  });

  it("walks both directions along a linear chain, oldest first", async () => {
    const rows = await listConversations({ dbPath: db.dbPath });
    // sess-fam-a → sess-fam-b → sess-fam-c, seen from the LAST sitting: the
    // walk climbs the parent links and comes back down the continuations.
    const family = buildFamily(rows, "sess-fam-c");

    expect(family).not.toBeNull();
    if (family === null) return;
    expect(family.members.slice(0, 3).map((m) => m.id)).toEqual([
      "sess-fam-a",
      "sess-fam-b",
      "sess-fam-c",
    ]);
    expect(family.members.slice(0, 3).map((m) => m.depth)).toEqual([0, 1, 2]);
    expect(family.parent?.id).toBe("sess-fam-b");
    expect(family.children).toEqual([]);

    // The middle sitting sees its parent above and its continuation below.
    const middle = buildFamily(rows, "sess-fam-b");
    expect(middle?.parent?.id).toBe("sess-fam-a");
    expect(middle?.children.map((c) => c.id)).toEqual(["sess-fam-c"]);
  });

  it("lays a forked family out as a tree, chronological within each fork", async () => {
    const rows = await listConversations({ dbPath: db.dbPath });
    // sess-fam-a forks into sess-fam-b (→ sess-fam-c) and sess-fam-d
    // (→ sess-fam-e, resumed in ANOTHER project).
    const family = buildFamily(rows, "sess-fam-c");

    expect(family).not.toBeNull();
    if (family === null) return;
    expect(family.size).toBe(5);
    expect(family.members.map((m) => m.id)).toEqual([
      "sess-fam-a",
      "sess-fam-b",
      "sess-fam-c",
      "sess-fam-d",
      "sess-fam-e",
    ]);
    expect(family.members.map((m) => m.depth)).toEqual([0, 1, 2, 1, 2]);
    expect(family.members.filter((m) => m.isCurrent).map((m) => m.id)).toEqual([
      "sess-fam-c",
    ]);

    // The fork's two branches are the root's direct continuations.
    const fromRoot = buildFamily(rows, "sess-fam-a");
    expect(fromRoot?.children.map((c) => c.id)).toEqual([
      "sess-fam-b",
      "sess-fam-d",
    ]);

    // A member resumed in a different Project keeps its own project label.
    const elsewhere = family.members.find((m) => m.id === "sess-fam-e");
    expect(elsewhere?.project.folder).toBe("-Users-me-dev-family-alt");
    expect(elsewhere?.title).toBe("Family resumed elsewhere");
  });

  it("totals the family's cost and flags it as a lower bound when a member is unpriced", async () => {
    const rows = await listConversations({ dbPath: db.dbPath });
    const family = buildFamily(rows, "sess-fam-a");

    expect(family).not.toBeNull();
    if (family === null) return;
    const summed = family.members.reduce((sum, m) => sum + m.costUsd, 0);
    expect(family.totalCostUsd).toBeCloseTo(summed, 12);
    expect(family.totalCostUsd).toBeGreaterThan(0);
    // Only sess-fam-e carries `<synthetic>` (unpriced) usage; the family total
    // is therefore a lower bound even though every other member is priced.
    expect(family.members.filter((m) => m.unpriced).map((m) => m.id)).toEqual([
      "sess-fam-e",
    ]);
    expect(family.hasUnpriced).toBe(true);

    // A fully priced conversation is not flagged.
    expect(buildFamily(rows, "sess-fam-solo")?.hasUnpriced).toBe(false);
  });

  it("degrades gracefully when the parent link is broken", async () => {
    const rows = await listConversations({ dbPath: db.dbPath });
    // sess-orphan resumes a session whose log file is gone, so `refresh()` could
    // not resolve the link: it stands alone rather than dangling.
    expect(rows.find((r) => r.id === "sess-orphan")?.continuedFromId).toBeNull();
    expect(buildFamily(rows, "sess-orphan")?.size).toBe(1);

    // Same tolerance one level up: a pointer at a conversation MISSING from the
    // given rows makes that conversation a root, never a crash.
    const dangling = rows
      .filter((r) => r.id === "sess-fam-c")
      .map((r) => ({ ...r, continuedFromId: "sess-vanished" }));
    const family = buildFamily(dangling, "sess-fam-c");
    expect(family?.size).toBe(1);
    expect(family?.parent).toBeNull();
  });

  it("returns null for a conversation it does not know", async () => {
    const rows = await listConversations({ dbPath: db.dbPath });
    expect(buildFamily(rows, "does-not-exist")).toBeNull();
  });

  it("terminates on a cyclic link structure, listing each member once", async () => {
    const rows = await listConversations({ dbPath: db.dbPath });
    // The loop fixtures resume EACH OTHER — a shape real logs cannot produce,
    // guarded against anyway (SetNull deletes plus re-parses).
    expect(rows.find((r) => r.id === "sess-loop-a")?.continuedFromId).toBe(
      "sess-loop-b",
    );
    expect(rows.find((r) => r.id === "sess-loop-b")?.continuedFromId).toBe(
      "sess-loop-a",
    );

    const family = buildFamily(rows, "sess-loop-a");
    expect(family).not.toBeNull();
    if (family === null) return;
    expect(family.size).toBe(2);
    expect(family.members.map((m) => m.id).sort()).toEqual([
      "sess-loop-a",
      "sess-loop-b",
    ]);
    expect(family.members.filter((m) => m.isCurrent)).toHaveLength(1);
  });
});

describe("familySizes", () => {
  const db = seededTempDb({ prefix: "cca-famsize-", logsRoot: FIXTURES_ROOT });

  it("gives every member of a family the same size and standalone rows 1", async () => {
    const rows = await listConversations({ dbPath: db.dbPath });
    const sizes = familySizes(rows);

    // The whole connected component counts, seen from any of its members.
    for (const id of [
      "sess-fam-a",
      "sess-fam-b",
      "sess-fam-c",
      "sess-fam-d",
      "sess-fam-e",
    ]) {
      expect(sizes.get(id)).toBe(5);
    }
    expect(sizes.get("sess-loop-a")).toBe(2);
    expect(sizes.get("sess-loop-b")).toBe(2);
    expect(sizes.get("sess-fam-solo")).toBe(1);
    expect(sizes.get("sess-orphan")).toBe(1);
    // Every conversation is accounted for exactly once.
    expect(sizes.size).toBe(rows.length);
  });
});
