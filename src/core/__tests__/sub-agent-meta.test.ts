// A Sub-agent's type comes from the spawn ledger naming it when the ledger
// states one, else from the `agent-<id>.meta.json` Claude Code writes beside
// its transcript (log-format §4).

import path from "node:path";
import { describe, expect, it } from "vitest";
import { seededTempDb } from "@/core/__tests__/helpers/temp-db";
import { getConversation } from "@/core/read";

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
});
