import path from "node:path";
import { describe, expect, it } from "vitest";

import { getConversation, getTranscript } from "@/core/read";

import { seededTempDb } from "./helpers/temp-db";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

describe("getTranscript core reader", () => {
  const db = seededTempDb({
    prefix: "cca-transcript-",
    logsRoot: FIXTURES_ROOT,
  });

  it("returns null for an unknown session id", async () => {
    expect(await getTranscript("does-not-exist", { dbPath: db.dbPath })).toBeNull();
  });

  it("returns the sessionId + title for a known session", async () => {
    const view = await getTranscript("sess-transcript", { dbPath: db.dbPath });
    expect(view).not.toBeNull();
    expect(view?.sessionId).toBe("sess-transcript");
    expect(view?.title).toBe("Transcript kinds");
  });

  it("builds a single main node with own-transcript cost for a solo session", async () => {
    const view = await getTranscript("sess-transcript", { dbPath: db.dbPath });
    const main = view?.tree;
    expect(main?.id).toMatch(/^\d+$/);
    expect(main?.agentType).toBeNull();
    expect(main?.children).toHaveLength(0);
    expect(main?.tokens.input).toBe(13);
    expect(main?.tokens.output).toBe(12);
    expect(main?.costUsd).toBeGreaterThan(0);
    expect(view?.totalCostUsd).toBeCloseTo(main?.costUsd ?? -1, 10);
    expect(view?.totalTokens.total).toBe(25);
  });

  it("carries each message's record uuid — the deep-link anchor", async () => {
    const view = await getTranscript("sess-transcript", { dbPath: db.dbPath });
    expect(view?.messages.map((m) => m.uuid)).toEqual(["tu1", "ta1", "ta2"]);
  });

  it("flags the API-error dot and counts hidden meta on the node", async () => {
    const view = await getTranscript("sess-transcript", { dbPath: db.dbPath });
    expect(view?.tree.hasError).toBe(true);
    expect(view?.tree.metaCount).toBe(1);
    expect(view?.metaHiddenCount).toBe(1);
  });

  it("renders only prompts + assistant turns, in order, excluding tool-result & meta", async () => {
    const view = await getTranscript("sess-transcript", { dbPath: db.dbPath });
    const msgs = view?.messages ?? [];
    expect(msgs.map((m) => `${m.role}:${m.kind ?? "-"}`)).toEqual(["user:prompt", "assistant:-", "assistant:-"]);
    const prompt = msgs[0];
    expect(prompt?.text).toBe("kick off the transcript run");
    expect(prompt?.tokens).toBeNull();
    expect(prompt?.costUsd).toBe(0);
    expect(prompt?.toolCalls).toHaveLength(0);
  });

  it("prices each assistant turn and carries the API-error message", async () => {
    const view = await getTranscript("sess-transcript", { dbPath: db.dbPath });
    const msgs = view?.messages ?? [];
    const ta1 = msgs[1];
    expect(ta1?.role).toBe("assistant");
    expect(ta1?.model).toBe("claude-opus-4-8");
    expect(ta1?.tokens?.input).toBe(10);
    expect(ta1?.tokens?.output).toBe(12);
    expect(ta1?.costUsd).toBeGreaterThan(0);
    expect(ta1?.isApiError).toBe(false);
    expect(typeof ta1?.timestamp).toBe("string");

    const ta2 = msgs[2];
    expect(ta2?.isApiError).toBe(true);
    expect(ta2?.apiErrorMessage).toBe("overloaded_error");
    expect(ta2?.text).toBe("API Error: Overloaded");
  });

  it("nests the raw tool-call fields under the assistant turn", async () => {
    const view = await getTranscript("sess-transcript", { dbPath: db.dbPath });
    const ta1 = view?.messages[1];
    expect(ta1?.toolCalls).toHaveLength(1);
    const tc = ta1?.toolCalls[0];
    expect(tc?.name).toBe("Bash");
    expect(tc?.toolUseId).toBe("toolu-t-bash");
    expect(tc?.inputJson).toContain("echo done");
    expect(tc?.resultText).toContain("done");
    expect(tc?.resultTruncated).toBe(false);
    expect(tc?.resultCharSize).toBeGreaterThan(0);
    expect(tc?.isError).toBe(false);
  });

  it("nests a sub-agent under main with its own-transcript cost and spawn linkage", async () => {
    const view = await getTranscript("sess-sub", { dbPath: db.dbPath });
    const main = view?.tree;
    expect(main?.agentType).toBeNull();
    expect(main?.tokens.input).toBe(10);
    expect(main?.tokens.output).toBe(15);
    expect(main?.children).toHaveLength(1);

    const sub = main?.children[0];
    expect(sub?.id).toBe("sub1");
    expect(sub?.agentType).toBe("Explore");
    expect(sub?.resolvedModel).toBe("claude-haiku-4-5-20251001");
    expect(sub?.tokens.output).toBe(130);
    expect(sub?.tokens.cacheRead).toBe(20);
    expect(sub?.hasError).toBe(false);
    expect(sub?.spawnedByMessageId).not.toBeNull();
    expect(sub?.spawnedByToolUseId).toBe("toolu-agent-1");

    const detail = await getConversation("sess-sub", { dbPath: db.dbPath });
    expect(sub?.costUsd).toBeCloseTo(detail?.subAgents[0]?.costUsd ?? -1, 10);
    expect(view?.totalCostUsd).toBeCloseTo((main?.costUsd ?? 0) + (sub?.costUsd ?? 0), 10);
    expect(view?.totalTokens.total).toBe(225);
  });

  it("correlates the Agent tool call to the spawned sub-agent node", async () => {
    const view = await getTranscript("sess-sub", { dbPath: db.dbPath });
    const agentCall = view?.messages.flatMap((m) => m.toolCalls).find((tc) => tc.name === "Agent");
    expect(agentCall?.toolUseId).toBe("toolu-agent-1");
    expect(view?.tree.children[0]?.spawnedByToolUseId).toBe(agentCall?.toolUseId);
  });

  it("defaults to the main agent's transcript", async () => {
    const view = await getTranscript("sess-sub", { dbPath: db.dbPath });
    expect(view?.selectedAgentId).toBe(view?.tree.id);
    expect(view?.messages.map((m) => m.role)).toEqual(["user", "assistant", "assistant"]);
  });

  it("selects a sub-agent transcript via opts.agentId", async () => {
    const view = await getTranscript("sess-sub", {
      dbPath: db.dbPath,
      agentId: "sub1",
    });
    expect(view?.selectedAgentId).toBe("sub1");
    const msgs = view?.messages ?? [];
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "assistant"]);
    expect(msgs[0]?.text).toBe("look around");
    expect(msgs[1]?.toolCalls[0]?.name).toBe("Bash");
    expect(msgs[1]?.toolCalls[0]?.toolUseId).toBe("toolu-sub-bash");
    expect(msgs[1]?.model).toBe("claude-haiku-4-5-20251001");
  });

  it("orders sibling sub-agents by spawn time (first-message ts), not id", async () => {
    const view = await getTranscript("sess-multi", { dbPath: db.dbPath });
    const kids = view?.tree.children ?? [];
    expect(kids.map((k) => k.id)).toEqual(["beta", "alpha"]);
    expect(kids[0]?.spawnedByToolUseId).toBe("toolu-beta");
    expect(kids[1]?.spawnedByToolUseId).toBe("toolu-alpha");
  });

  it("nests a grandchild under the sub-agent that spawned it, to any depth", async () => {
    const view = await getTranscript("sess-nested", { dbPath: db.dbPath });
    const main = view?.tree;
    expect(main?.children.map((c) => c.id).sort()).toEqual(["orphan", "suba"]);

    const suba = main?.children.find((c) => c.id === "suba");
    expect(suba?.agentType).toBe("Explore");
    expect(suba?.children.map((c) => c.id)).toEqual(["subb"]);

    const subb = suba?.children[0];
    expect(subb?.agentType).toBe("Plan");
    expect(subb?.children.map((c) => c.id)).toEqual(["subc"]);

    const subc = subb?.children[0];
    expect(subc?.agentType).toBe("general-purpose");
    expect(subc?.children).toHaveLength(0);
  });

  it("links a grandchild's spawn to the Agent call in its own parent's transcript", async () => {
    const view = await getTranscript("sess-nested", {
      dbPath: db.dbPath,
      agentId: "subb",
    });
    const agentCall = view?.messages.flatMap((m) => m.toolCalls).find((tc) => tc.name === "Agent");
    expect(agentCall?.toolUseId).toBe("toolu-agent-c");

    const subc = view?.tree.children[0]?.children[0]?.children[0];
    expect(subc?.id).toBe("subc");
    expect(subc?.spawnedByMessageId).not.toBeNull();
    expect(subc?.spawnedByToolUseId).toBe(agentCall?.toolUseId);
  });

  it("attaches a sub-agent with no spawn ledger under the main thread", async () => {
    const view = await getTranscript("sess-nested", { dbPath: db.dbPath });
    const orphan = view?.tree.children.find((c) => c.id === "orphan");
    expect(orphan).toBeDefined();
    expect(orphan?.agentType).toBeNull();
    expect(orphan?.spawnedByMessageId).toBeNull();
    expect(orphan?.children).toHaveLength(0);
  });

  it("carries each assistant turn's effort, null where the log recorded none", async () => {
    const view = await getTranscript("sess-effort", { dbPath: db.dbPath });
    const msgs = view?.messages ?? [];
    expect(msgs.map((m) => m.effort)).toEqual([null, "high", "high", null, "xhigh"]);
  });

  it("carries effort on a sub-agent's transcript too", async () => {
    const view = await getTranscript("sess-effort", {
      dbPath: db.dbPath,
      agentId: "eff1",
    });
    expect(view?.selectedAgentId).toBe("eff1");
    expect(view?.messages.map((m) => m.effort)).toEqual([null, "medium", "medium"]);
  });

  it("reports null effort throughout a transcript from a log that recorded none", async () => {
    const view = await getTranscript("sess-transcript", { dbPath: db.dbPath });
    expect(view?.messages.every((m) => m.effort === null)).toBe(true);
  });

  it("attaches sub-agents whose spawn ledgers form a cycle under the main thread", async () => {
    const view = await getTranscript("sess-cycle", { dbPath: db.dbPath });
    const kids = view?.tree.children ?? [];
    expect(kids.map((k) => k.id).sort()).toEqual(["cyc1", "cyc2"]);
    expect(kids.every((k) => k.children.length === 0)).toBe(true);
  });
});
