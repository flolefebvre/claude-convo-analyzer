// A Sub-agent's type comes from the `agent-<id>.meta.json` Claude Code writes
// beside its transcript, and from the spawn ledger naming it only when the
// meta file states none (log-format §4).

import path from "node:path";
import { describe, expect, it } from "vitest";
import { seededTempDb, type TempDb } from "@/core/__tests__/helpers/temp-db";
import { getConversation, getTranscript, type TranscriptAgentNode } from "@/core/read";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "agent-meta-logs");

/** The Agent type and resolved model `getConversation` gives Sub-agent `agentId` of `sessionId`. */
async function subAgentOf(db: TempDb, sessionId: string, agentId: string) {
  const detail = await getConversation(sessionId, { dbPath: db.dbPath });
  const subAgent = detail?.subAgents.find((sub) => sub.agentId === agentId);
  return { agentType: subAgent?.agentType, model: subAgent?.model };
}

describe("a Sub-agent with no meta file", () => {
  const db = seededTempDb({
    prefix: "cca-sub-agent-no-meta-",
    logsRoot: path.join(import.meta.dirname, "fixtures", "forked-agent-logs"),
  });

  it("is typed by the spawn ledger naming it, and runs on the ledger's resolved model", async () => {
    expect(await subAgentOf(db, "sess-forks", "lead-child")).toEqual({
      agentType: "Explore",
      model: "claude-haiku-4-5-20251001",
    });
  });
});

describe("a Sub-agent's meta file", () => {
  const db = seededTempDb({ prefix: "cca-sub-agent-meta-", logsRoot: FIXTURES_ROOT });

  /** The Agent type `getConversation` breaks sess-meta's Sub-agent `agentId` down under. */
  async function agentTypeOf(agentId: string) {
    return (await subAgentOf(db, "sess-meta", agentId)).agentType;
  }

  it("types a Sub-agent whose ledger states no type", async () => {
    expect(await agentTypeOf("bg")).toBe("Explore");
  });

  it("types a Sub-agent whose ledger states another type", async () => {
    expect(await agentTypeOf("fg")).toBe("Plan");
  });

  it("skips a malformed meta file, leaving the Sub-agent typed by its ledger, which states none", async () => {
    expect(await agentTypeOf("bad")).toBe("");
  });

  /** sess-meta's Agent tree node `agentId`, and the id of the node it is nested under. */
  async function treeNodeOf(agentId: string) {
    const view = await getTranscript("sess-meta", { dbPath: db.dbPath });
    const find = (
      node: TranscriptAgentNode,
      parentId: string | null,
    ): { node: TranscriptAgentNode; parentId: string | null } | null => {
      if (node.id === agentId) return { node, parentId };
      for (const child of node.children) {
        const found = find(child, node.id);
        if (found !== null) return found;
      }
      return null;
    };
    return find(view!.tree, null);
  }

  it("links a Sub-agent no ledger names to the Main thread's Agent call its meta file names", async () => {
    const loose = await treeNodeOf("loose");

    expect(loose?.parentId).toBe((await getTranscript("sess-meta", { dbPath: db.dbPath }))?.tree.id);
    expect(loose?.node).toMatchObject({ agentType: "Explore", spawnedByToolUseId: "toolu-loose" });
  });

  // bg-fork's file copies bg's Agent call that spawned inner: the call is bg's, not its fork's.
  it("links a Sub-agent no ledger names to the Sub-agent whose Agent call its meta file names", async () => {
    const inner = await treeNodeOf("inner");

    expect(inner?.parentId).toBe("bg");
    expect(inner?.node).toMatchObject({ agentType: "general-purpose", spawnedByToolUseId: "toolu-inner" });
  });

  // c-fork, a fork no ledger names, forks a-fork-of-fork, whose file copies c-fork's
  // copy of s-spawner's Agent call: a spawner never descends from what it spawned.
  it("links a fork no ledger names to its spawner, not to its own fork holding a copy of the call", async () => {
    const fork = await treeNodeOf("c-fork");
    const forkOfFork = await treeNodeOf("a-fork-of-fork");

    expect(fork?.parentId).toBe("s-spawner");
    expect(fork?.node).toMatchObject({ agentType: "fork", spawnedByToolUseId: "toolu-c" });
    expect(forkOfFork?.parentId).toBe("c-fork");
    expect(forkOfFork?.node.spawnedByToolUseId).toBe("toolu-f");
  });
});
