import path from "node:path";
import { describe, expect, it } from "vitest";

import { getDailySpend } from "@/core/read";
import { getToolCallSamples, getToolStats } from "@/core/tool-stats";

import { seededTempDb } from "./helpers/temp-db";

// One Project per line, each with a distinct input-token count (so a scope's
// token total names the Projects it spans) and a distinct tool:
//   /Users/me/dev/scope                      1      Bash   the Folder itself
//   /Users/me/dev/scope/.claude/worktrees/wt 10     Read   a Folder below it
//   /Users/me/dev/scopex                     100    Grep   same prefix, no `/` boundary
//   /Users/me/dev/Scope/child                1000   Glob   differs only by case
//   /Users/me/dev/sc_pe                      10000  Write  `_` would match `o` as a LIKE wildcard
const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "scope-logs");
const REPO = "/Users/me/dev/scope";
const WORKTREE = "/Users/me/dev/scope/.claude/worktrees/wt";
const NOW = Date.parse("2026-06-20T18:00:00.000Z");

describe("Folder scope", () => {
  const db = seededTempDb({ prefix: "cca-scope-", logsRoot: FIXTURES_ROOT });

  async function scopedTokens(folder: string, thisFolderOnly?: boolean) {
    const spend = await getDailySpend({ dbPath: db.dbPath, folder, thisFolderOnly, now: NOW });
    return spend.totalTokens.total;
  }

  async function scopedToolNames(folder: string, thisFolderOnly?: boolean) {
    const stats = await getToolStats({ dbPath: db.dbPath, folder, thisFolderOnly, now: NOW });
    return stats.tools.map((t) => t.name).sort();
  }

  it("spans the Folder's own Project and every Project below it", async () => {
    expect(await scopedTokens(REPO)).toBe(1 + 10);
    expect(await scopedToolNames(REPO)).toEqual(["Bash", "Read"]);
  });

  it("narrows to this folder's own Conversations", async () => {
    expect(await scopedTokens(REPO, true)).toBe(1);
    expect(await scopedToolNames(REPO, true)).toEqual(["Bash"]);
  });

  it("scopes a leaf Folder to its own Project", async () => {
    expect(await scopedTokens(WORKTREE)).toBe(10);
    expect(await scopedToolNames(WORKTREE)).toEqual(["Read"]);
  });

  it("leaves out a sibling that shares the prefix without a `/` boundary", async () => {
    expect(await scopedTokens("/Users/me/dev/scopex")).toBe(100);
  });

  it("matches paths exactly: case matters, and `_` is a literal", async () => {
    expect(await scopedTokens("/Users/me/dev/Scope")).toBe(1000);
    expect(await scopedToolNames("/Users/me/dev/Scope")).toEqual(["Glob"]);
    expect(await scopedTokens("/Users/me/dev/sc_pe")).toBe(10000);
    expect(await scopedToolNames("/Users/me/dev/sc_pe")).toEqual(["Write"]);
  });

  it("samples tool calls over the same subtree", async () => {
    const below = await getToolCallSamples("Read", { dbPath: db.dbPath, folder: REPO, now: NOW });
    expect(below.largestResults.map((s) => s.toolUseId)).toEqual(["sw-t1"]);
    const prefixSibling = await getToolCallSamples("Grep", { dbPath: db.dbPath, folder: REPO, now: NOW });
    expect(prefixSibling.largestResults).toEqual([]);
    const own = await getToolCallSamples("Read", { dbPath: db.dbPath, folder: REPO, thisFolderOnly: true, now: NOW });
    expect(own.largestResults).toEqual([]);
  });
});
