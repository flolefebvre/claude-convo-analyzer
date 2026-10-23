// Continuation families (issue #46): the walk over `continued_from` links that
// turns a set of conversation summaries into the connected component a given
// conversation belongs to. Every case but the cycle is exercised through the
// public core functions over a database seeded by the REAL `refresh()` from
// fixture logs.
//
// These fixtures live in their OWN logs root (`fixtures/family-logs`), not the
// shared one: the family shapes need ten extra sessions, and adding them to
// the shared root both slowed every other refresh-based suite and collided with
// the corpus assertions of the FTS tests. Each continuation copies its parent's
// records (log-format §10): the root encodes a standalone session, a linear
// chain, a fork, a cross-project resume, a copy whose original is gone, and an
// older pair with no `continued-in` record. A cycle cannot come out of copies,
// so the walk's guard is fed made-up summaries. The titles carry the shapes of
// the last-wins rule: the root is re-titled, the standalone session renamed
// twice, and sess-fam-b holds only its parent's title, re-appended on resume.

import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildFamily, type FamilyRow, familySizes } from "@/core/family";
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
    expect(family.members.slice(0, 3).map((m) => m.id)).toEqual(["sess-fam-a", "sess-fam-b", "sess-fam-c"]);
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
    expect(family.members.filter((m) => m.isCurrent).map((m) => m.id)).toEqual(["sess-fam-c"]);

    // The fork's two branches are the root's direct continuations.
    const fromRoot = buildFamily(rows, "sess-fam-a");
    expect(fromRoot?.children.map((c) => c.id)).toEqual(["sess-fam-b", "sess-fam-d"]);

    // A member resumed in a different Project keeps its own project label.
    const elsewhere = family.members.find((m) => m.id === "sess-fam-e");
    expect(elsewhere?.project.path).toBe("/Users/me/dev/family-alt");
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
    expect(family.members.filter((m) => m.unpriced).map((m) => m.id)).toEqual(["sess-fam-e"]);
    expect(family.hasUnpriced).toBe(true);

    // A fully priced conversation is not flagged.
    expect(buildFamily(rows, "sess-fam-solo")?.hasUnpriced).toBe(false);
  });

  it("degrades gracefully when the parent link is broken", async () => {
    const rows = await listConversations({ dbPath: db.dbPath });
    // sess-orphan copies a session whose log file is gone, so `refresh()` found
    // no original: it stands alone rather than dangling.
    expect(rows.find((r) => r.id === "sess-orphan")?.continuedFromId).toBeNull();
    expect(buildFamily(rows, "sess-orphan")?.size).toBe(1);

    // Same tolerance one level up: a pointer at a conversation MISSING from the
    // given rows makes that conversation a root, never a crash.
    const dangling = rows.filter((r) => r.id === "sess-fam-c").map((r) => ({ ...r, continuedFromId: "sess-vanished" }));
    const family = buildFamily(dangling, "sess-fam-c");
    expect(family?.size).toBe(1);
    expect(family?.parent).toBeNull();
  });

  it("returns null for a conversation it does not know", async () => {
    const rows = await listConversations({ dbPath: db.dbPath });
    expect(buildFamily(rows, "does-not-exist")).toBeNull();
  });

  it("terminates on a cyclic link structure, listing each member once", () => {
    // Two sessions continuing EACH OTHER — a shape copies cannot produce,
    // guarded against anyway.
    const loopRow = (id: string, continuedFromId: string): FamilyRow => ({
      id,
      title: null,
      project: { path: "/Users/me/dev/loop" },
      startedAt: "2026-06-21T14:00:00.000Z",
      costUsd: 0,
      unpriced: false,
      continuedFromId,
    });
    const rows = [loopRow("sess-loop-a", "sess-loop-b"), loopRow("sess-loop-b", "sess-loop-a")];

    const family = buildFamily(rows, "sess-loop-a");
    expect(family).not.toBeNull();
    if (family === null) return;
    expect(family.size).toBe(2);
    expect(family.members.map((m) => m.id).sort()).toEqual(["sess-loop-a", "sess-loop-b"]);
    expect(family.members.filter((m) => m.isCurrent)).toHaveLength(1);
  });
});

describe("familySizes", () => {
  const db = seededTempDb({ prefix: "cca-famsize-", logsRoot: FIXTURES_ROOT });

  it("gives every member of a family the same size and standalone rows 1", async () => {
    const rows = await listConversations({ dbPath: db.dbPath });
    const sizes = familySizes(rows);

    // The whole connected component counts, seen from any of its members.
    for (const id of ["sess-fam-a", "sess-fam-b", "sess-fam-c", "sess-fam-d", "sess-fam-e"]) {
      expect(sizes.get(id)).toBe(5);
    }
    expect(sizes.get("sess-legacy-a")).toBe(2);
    expect(sizes.get("sess-legacy-b")).toBe(2);
    expect(sizes.get("sess-legacy-fork")).toBe(1);
    expect(sizes.get("sess-fam-solo")).toBe(1);
    expect(sizes.get("sess-orphan")).toBe(1);
    // Every conversation is accounted for exactly once.
    expect(sizes.size).toBe(rows.length);
  });
});

describe("a Conversation's title", () => {
  const db = seededTempDb({ prefix: "cca-famtitle-", logsRoot: FIXTURES_ROOT });

  /** The listed title of the Conversation `sessionId`. */
  async function titleOf(sessionId: string): Promise<string | null | undefined> {
    const rows = await listConversations({ dbPath: db.dbPath });
    return rows.find((r) => r.id === sessionId)?.title;
  }

  it("is the last ai-title of a session re-titled mid-way", async () => {
    // sess-fam-a is titled "Plan the work", then "Family root".
    expect(await titleOf("sess-fam-a")).toBe("Family root");
  });

  it("is the last custom-title of a session renamed twice, over its ai-title", async () => {
    expect(await titleOf("sess-fam-solo")).toBe("Solo, renamed");
  });

  it("is the parent's title for a continuation whose only title is the one Claude Code re-appended on resume", async () => {
    // sess-fam-b opens with sess-fam-a's current title and has none of its own.
    expect(await titleOf("sess-fam-b")).toBe("Family root");
    expect(await titleOf("sess-fam-a")).toBe("Family root");
  });

  it("is the only ai-title of an original titled once", async () => {
    expect(await titleOf("sess-legacy-a")).toBe("Legacy original");
  });
});
