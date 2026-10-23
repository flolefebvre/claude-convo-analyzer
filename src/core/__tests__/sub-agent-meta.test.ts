// A Sub-agent's type comes from the spawn ledger naming it when the ledger
// states one, else from the `agent-<id>.meta.json` Claude Code writes beside
// its transcript (log-format §4).

import path from "node:path";
import { describe, expect, it } from "vitest";
import { seededTempDb } from "@/core/__tests__/helpers/temp-db";
import { getConversation, getTranscript, type TranscriptAgentNode } from "@/core/read";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "agent-meta-logs");

describe("a Sub-agent's meta file", () => {
  const db = seededTempDb({ prefix: "cca-sub-agent-meta-", logsRoot: FIXTURES_ROOT });

  /** The Agent type `getConversation` breaks sess-meta's Sub-agent `agentId` down under. */
  async function agentTypeOf(agentId: string) {
    const detail = await getConversation("sess-meta", { dbPath: db.dbPath });
    return detail?.subAgents.find((sub) => sub.agentId === agentId)?.agentType;
  }

  it("types a Sub-agent whose ledger states no type by its meta file", async () => {
    expect(await agentTypeOf("bg")).toBe("Explore");
  });

  it("keeps the ledger's type when the ledger states one", async () => {
    expect(await agentTypeOf("fg")).toBe("general-purpose");
  });

  it("skips a malformed meta file, leaving the Sub-agent untyped", async () => {
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
});
