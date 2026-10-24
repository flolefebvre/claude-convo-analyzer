// A Sub-agent's spawner is the Agent of its Conversation owning the `Agent`
// call its meta file's `toolUseId` names, else the call of the spawn ledger
// naming it, by ADR-0011's ownership rule among the call's holders — never
// the Sub-agent itself nor one of its descendants (log-format §4). The links
// pass decides it from stored rows, whatever order the log files sort in.

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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

// Claude Code never writes these shapes; they must still end in a tree, the same cold and incremental.
describe("Sub-agents holding each other's spawning calls", () => {
  const SESSION_ID = "sess-held";
  let tmpDir: string;
  let logsRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-sub-agent-cycle-"));
    logsRoot = path.join(tmpDir, "logs");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** The log file of Sub-agent `agentId`, under the logs root. */
  const subAgentLogPath = (agentId: string) =>
    path.join(logsRoot, "-Users-me-dev-held", SESSION_ID, "subagents", `agent-${agentId}.jsonl`);

  /**
   * Write a Conversation whose Main thread's one Turn holds the `Agent` call of
   * each of `mainThreadHeldAgentIds`, and one Sub-agent per key of
   * `heldCallsByAgentId`: its meta file names `toolu-<its id>` as its spawning
   * call, and its one Turn holds the `Agent` call of each id listed.
   */
  function writeConversation(
    heldCallsByAgentId: Record<string, string[]>,
    mainThreadHeldAgentIds: string[] = [],
  ): void {
    const agentCalls = (heldAgentIds: string[]) =>
      heldAgentIds.map((heldAgentId) => ({
        type: "tool_use",
        id: `toolu-${heldAgentId}`,
        name: "Agent",
        input: { description: heldAgentId, subagent_type: "Explore", prompt: "go" },
      }));
    const record = (uuid: string, minute: number, extras: Record<string, unknown>) =>
      JSON.stringify({
        uuid,
        timestamp: new Date(Date.UTC(2026, 5, 22, 9, minute)).toISOString(),
        cwd: "/Users/me/dev/held",
        version: "2.1.300",
        sessionId: SESSION_ID,
        ...extras,
      });
    const assistant = (uuid: string, minute: number, content: unknown[], agentId?: string) =>
      record(uuid, minute, {
        type: "assistant",
        requestId: `${uuid}-req`,
        ...(agentId === undefined ? {} : { isSidechain: true, agentId }),
        message: {
          id: `${uuid}-msg`,
          role: "assistant",
          model: "claude-haiku-4-5-20251001",
          content,
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      });
    const mainThreadPath = path.join(logsRoot, "-Users-me-dev-held", `${SESSION_ID}.jsonl`);
    mkdirSync(path.dirname(subAgentLogPath("x")), { recursive: true });
    writeFileSync(
      mainThreadPath,
      `${record("main-u1", 0, { type: "user", message: { role: "user", content: "start" } })}\n` +
        `${assistant("main-a1", 1, [{ type: "text", text: "started" }, ...agentCalls(mainThreadHeldAgentIds)])}\n`,
    );
    Object.entries(heldCallsByAgentId).forEach(([agentId, heldAgentIds], index) => {
      writeFileSync(
        subAgentLogPath(agentId),
        `${record(`${agentId}-u1`, 2 + index, { type: "user", isSidechain: true, agentId, message: { role: "user", content: "go" } })}\n` +
          `${assistant(`${agentId}-a1`, 2 + index, agentCalls(heldAgentIds), agentId)}\n`,
      );
      writeFileSync(
        subAgentLogPath(agentId).replace(/\.jsonl$/, ".meta.json"),
        JSON.stringify({ agentType: "Explore", toolUseId: `toolu-${agentId}` }),
      );
    });
  }

  /**
   * The Agent tree a Refresh of the logs root into `dbPath` stores, its Main
   * thread's node as `main`, and each spawning Message's row id, which differs
   * between databases, as 0.
   */
  async function agentTreeAfterRefresh(dbPath: string) {
    await refresh({ logsRoot, dbPath });
    const withoutRowIds = (node: TranscriptAgentNode): TranscriptAgentNode => ({
      ...node,
      spawnedByMessageId: node.spawnedByMessageId === null ? null : 0,
      children: node.children.map(withoutRowIds),
    });
    return { ...withoutRowIds((await getTranscript(SESSION_ID, { dbPath }))!.tree), id: "main" };
  }

  /** The tree of a Refresh after a first Refresh and a Turn appended to `agentId`'s file, and the cold one, the same. */
  async function agentTreeAfterAppendAndCold(agentId: string) {
    const changedDbPath = path.join(tmpDir, "changed.db");
    await refresh({ logsRoot, dbPath: changedDbPath });
    const appended = {
      type: "user",
      uuid: `${agentId}-u-appended`,
      timestamp: "2026-06-22T10:00:00.000Z",
      isSidechain: true,
      agentId,
      message: { role: "user", content: "more" },
    };
    writeFileSync(
      subAgentLogPath(agentId),
      `${readFileSync(subAgentLogPath(agentId), "utf8")}${JSON.stringify(appended)}\n`,
    );
    const changedTree = await agentTreeAfterRefresh(changedDbPath);
    const coldTree = await agentTreeAfterRefresh(path.join(tmpDir, "cold.db"));
    expect(changedTree).toEqual(coldTree);
    return coldTree;
  }

  // cyc-a, first in path order, is decided under the only other holder of its call; cyc-b's only holder then descends from it.
  it.each(["cyc-a", "cyc-b"])("are nested as a tree when two hold each other's, after %s grows", async (agentId) => {
    writeConversation({ "cyc-a": ["cyc-b"], "cyc-b": ["cyc-a"] });

    const tree = await agentTreeAfterAppendAndCold(agentId);

    expect(placeIn(tree, "cyc-a")).toEqual({ parentId: "cyc-b", spawnedByToolUseId: "toolu-cyc-a" });
    expect(placeIn(tree, "cyc-b")).toEqual({ parentId: "main", spawnedByToolUseId: null });
  });

  // No sweep decides any: the first in path order goes under the Main thread, then the others under the settled holders.
  it("are nested as a tree when each of three holds both others'", async () => {
    writeConversation({ "tri-a": ["tri-b", "tri-c"], "tri-b": ["tri-a", "tri-c"], "tri-c": ["tri-a", "tri-b"] });

    const tree = await agentTreeAfterAppendAndCold("tri-b");

    expect(placeIn(tree, "tri-a")).toEqual({ parentId: "main", spawnedByToolUseId: null });
    expect(placeIn(tree, "tri-b")).toEqual({ parentId: "tri-a", spawnedByToolUseId: "toolu-tri-b" });
    expect(placeIn(tree, "tri-c")).toEqual({ parentId: "tri-a", spawnedByToolUseId: "toolu-tri-c" });
  });

  // fork forks twice: fork-1 copies its spawn record, fork-2 copies that and fork-1's spawn too. No sweep
  // decides fork or fork-1, each waiting on the other; fork, whose spawner is settled, is decided first.
  it.each([
    { order: "with the first fork sorting first", firstForkId: "fs-a-fork-1" },
    { order: "with the first fork sorting last", firstForkId: "fs-z-fork-1" },
  ])("are the forking Agent for a fork that forks twice, $order", async ({ firstForkId }) => {
    writeConversation(
      {
        "fs-spawner": ["fs-fork"],
        "fs-fork": ["fs-fork", firstForkId, "fs-fork-2"],
        [firstForkId]: ["fs-fork", firstForkId],
        "fs-fork-2": ["fs-fork", firstForkId, "fs-fork-2"],
      },
      ["fs-spawner"],
    );

    const tree = await agentTreeAfterAppendAndCold(firstForkId);

    expect(placeIn(tree, "fs-spawner")).toEqual({ parentId: "main", spawnedByToolUseId: "toolu-fs-spawner" });
    expect(placeIn(tree, "fs-fork")).toEqual({ parentId: "fs-spawner", spawnedByToolUseId: "toolu-fs-fork" });
    // fs-fork's one Turn holds both forks' calls, which the tree pairs with them by spawn time, not by id.
    expect(placeIn(tree, firstForkId).parentId).toBe("fs-fork");
    expect(placeIn(tree, "fs-fork-2").parentId).toBe("fs-fork");
  });
});
