// A Sub-agent's spawner is the Agent of its Conversation owning the `Agent`
// call its meta file's `toolUseId` names, else the call of the spawn ledger
// naming it, by ADR-0011's ownership rule among the call's holders — never
// the Sub-agent itself nor one of its descendants (log-format §4). The links
// pass decides it from stored rows, whatever order the log files sort in.

import { cpSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTranscript, type TranscriptAgentNode } from "@/core/read";
import { refresh } from "@/core/refresh";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");

/** An order a fixture's log files sort in: the Sub-agents renamed to get it, each new id by its fixture id. */
type SortOrder = { order: string; renames: Record<string, string> };

/**
 * Rename Sub-agent `from` to `to` in every file under `dir`: its log and meta
 * file names, and every JSON string holding its id — so the files sort in
 * another order and nothing else changes.
 */
function renameSubAgent(dir: string, from: string, to: string): void {
  for (const entry of readdirSync(dir)) {
    const entryPath = path.join(dir, entry);
    if (statSync(entryPath).isDirectory()) {
      renameSubAgent(entryPath, from, to);
      continue;
    }
    writeFileSync(entryPath, readFileSync(entryPath, "utf8").replaceAll(`"${from}"`, `"${to}"`));
    if (entry.startsWith(`agent-${from}.`)) {
      renameSync(entryPath, path.join(dir, entry.replace(`agent-${from}.`, `agent-${to}.`)));
    }
  }
}

/** Where Sub-agent `agentId` sits in the Agent tree under `root`: its parent's id and its spawning Agent call. */
function placeIn(root: TranscriptAgentNode, agentId: string): { parentId: string; spawnedByToolUseId: string | null } {
  const find = (node: TranscriptAgentNode): { parentId: string; spawnedByToolUseId: string | null } | null => {
    for (const child of node.children) {
      if (child.id === agentId) return { parentId: node.id, spawnedByToolUseId: child.spawnedByToolUseId };
      const found = find(child);
      if (found !== null) return found;
    }
    return null;
  };
  const place = find(root);
  if (place === null) throw new Error(`no Sub-agent ${agentId} in the tree`);
  return place;
}

describe("a Sub-agent's spawner", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-sub-agent-spawner-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * A cold Refresh of fixture root `fixtureRootName`, its Sub-agents renamed by
   * `renames` first; the Agent tree of `sessionId`, ids mapped back to the
   * fixture's own and the Main thread's as `main`.
   */
  async function agentTreeOf(fixtureRootName: string, sessionId: string, renames: Record<string, string>) {
    const logsRoot = path.join(tmpDir, "logs");
    cpSync(path.join(FIXTURES_DIR, fixtureRootName), logsRoot, { recursive: true });
    for (const [from, to] of Object.entries(renames)) renameSubAgent(logsRoot, from, to);
    const dbPath = path.join(tmpDir, "analyzer.db");
    await refresh({ logsRoot, dbPath });
    const tree = (await getTranscript(sessionId, { dbPath }))!.tree;
    const originalIdByRenamed = new Map(Object.entries(renames).map(([from, to]) => [to, from]));
    const mapBack = (node: TranscriptAgentNode): TranscriptAgentNode => ({
      ...node,
      id: originalIdByRenamed.get(node.id) ?? node.id,
      children: node.children.map(mapBack),
    });
    // The Main thread's node is keyed by its row id: `main` reads better.
    return { ...mapBack(tree), id: "main" };
  }

  // As the fixture sorts, fork-lead's forks come first; renamed, fork-lead does.
  describe.each<SortOrder>([
    { order: "with the forks sorting first", renames: {} },
    { order: "with the spawner sorting first", renames: { "fork-lead": "a-lead" } },
  ])("among forked Sub-agents holding a ledger, $order", ({ renames }) => {
    it("is the spawner for a Sub-agent it finished before forking, whose call and ledger its forks copy", async () => {
      const tree = await agentTreeOf("forked-agent-logs", "sess-forks", renames);

      expect(placeIn(tree, "lead-child")).toEqual({ parentId: "fork-lead", spawnedByToolUseId: "toolu-lead-child" });
    });

    it("is the forking Agent for a fork, and for a fork of a fork", async () => {
      const tree = await agentTreeOf("forked-agent-logs", "sess-forks", renames);

      expect(placeIn(tree, "fork-a")).toEqual({ parentId: "fork-lead", spawnedByToolUseId: "toolu-fork-a" });
      expect(placeIn(tree, "fork-b")).toEqual({ parentId: "fork-a", spawnedByToolUseId: "toolu-fork-b" });
    });
  });

  // As the fixture sorts, each fork comes before its spawner; renamed, after it.
  describe.each<SortOrder>([
    { order: "with the forks sorting first", renames: {} },
    {
      order: "with the spawners sorting first",
      renames: { bg: "a-bg", "s-spawner": "a-spawner", "a-fork-of-fork": "z-fork-of-fork" },
    },
  ])("named by meta files, $order", ({ renames }) => {
    it("is the spawner for a Sub-agent it started before forking, whose call its fork copies", async () => {
      const tree = await agentTreeOf("agent-meta-logs", "sess-meta", renames);

      expect(placeIn(tree, "inner")).toEqual({ parentId: "bg", spawnedByToolUseId: "toolu-inner" });
      expect(placeIn(tree, "bg-fork")).toEqual({ parentId: "bg", spawnedByToolUseId: "toolu-bg-fork" });
    });

    it("is the forking Agent for a fork whose own fork copies its spawning call", async () => {
      const tree = await agentTreeOf("agent-meta-logs", "sess-meta", renames);

      expect(placeIn(tree, "c-fork")).toEqual({ parentId: "s-spawner", spawnedByToolUseId: "toolu-c" });
      expect(placeIn(tree, "a-fork-of-fork")).toEqual({ parentId: "c-fork", spawnedByToolUseId: "toolu-f" });
    });

    it("is the Sub-agent holding the call for a nested Sub-agent", async () => {
      const tree = await agentTreeOf("agent-meta-logs", "sess-meta", renames);

      expect(placeIn(tree, "deep")).toEqual({ parentId: "fg", spawnedByToolUseId: "toolu-deep" });
    });

    // bg, fg and bad are spawned by one Message, whose calls the tree pairs with them by spawn time, not by id.
    it("is the Main thread for a background Sub-agent, and for one whose meta file states nothing, by its ledger", async () => {
      const tree = await agentTreeOf("agent-meta-logs", "sess-meta", renames);
      const spawningMessageIdOf = (agentId: string) =>
        tree.children.find((node) => node.id === agentId)?.spawnedByMessageId;

      expect(placeIn(tree, "bg").parentId).toBe("main");
      expect(placeIn(tree, "bad").parentId).toBe("main");
      expect(spawningMessageIdOf("bg")).not.toBeNull();
      expect(spawningMessageIdOf("bad")).toBe(spawningMessageIdOf("bg"));
      expect(spawningMessageIdOf("fg")).toBe(spawningMessageIdOf("bg"));
      expect(placeIn(tree, "loose")).toEqual({ parentId: "main", spawnedByToolUseId: "toolu-loose" });
    });
  });
});
