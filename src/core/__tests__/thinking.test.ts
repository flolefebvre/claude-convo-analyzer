import path from "node:path";
import { describe, expect, it } from "vitest";

import { getTranscript } from "@/core/read";

import { seededTempDb } from "./helpers/temp-db";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "thinking-logs");

/**
 * A Turn's thinking (log-format §3, "Thinking"): the text of its `thinking` blocks, empty
 * in most of them, and the record's `thinkingDurationMs` (2.1.287+). The
 * `sess-thinking` fixture holds one Turn of each shape, and a Sub-agent whose
 * Turn thought too.
 */
describe("thinking", () => {
  const db = seededTempDb({ prefix: "cca-thinking-", logsRoot: FIXTURES_ROOT });

  const turns = async (agentId?: string) => {
    const view = await getTranscript("sess-thinking", { dbPath: db.dbPath, agentId });
    return (view?.messages ?? []).filter((m) => m.role === "assistant");
  };

  it("keeps a Turn's thinking text and duration, from its thinking line merged with its text line", async () => {
    const [first] = await turns();
    expect(first?.text).toBe("The index is missing.");
    expect([first?.thinkingText, first?.thinkingDurationMs]).toEqual(["Checking the query plan first.", 1300]);
  });

  it("keeps the duration of a Turn whose thinking block is empty, and no text", async () => {
    const [, second] = await turns();
    expect([second?.thinkingText, second?.thinkingDurationMs]).toEqual([null, 800]);
  });

  it("joins the text of a Turn's two thinking lines in order, and sums their durations", async () => {
    const [, , third] = await turns();
    expect([third?.thinkingText, third?.thinkingDurationMs]).toEqual([
      "Listing the queries.\nDelegating the search.",
      4203,
    ]);
  });

  it("keeps the thinking text of a Turn logged before the duration was", async () => {
    const [, , , fourth] = await turns();
    expect([fourth?.thinkingText, fourth?.thinkingDurationMs]).toEqual(["Two queries to fix.", null]);
  });

  it("has no thinking on a Turn whose log holds only an empty block and no duration", async () => {
    const [, , , , fifth] = await turns();
    expect([fifth?.thinkingText, fifth?.thinkingDurationMs]).toEqual([null, null]);
  });

  it("has no thinking on a user Message", async () => {
    const view = await getTranscript("sess-thinking", { dbPath: db.dbPath });
    const prompts = (view?.messages ?? []).filter((m) => m.role === "user");
    expect(prompts.map((m) => [m.thinkingText, m.thinkingDurationMs])).toEqual(prompts.map(() => [null, null]));
  });

  it("keeps a Sub-agent's Turn's thinking the same way", async () => {
    const [subAgentTurn] = await turns("think1");
    expect([subAgentTurn?.thinkingText, subAgentTurn?.thinkingDurationMs]).toEqual(["Grepping for SELECT.", 900]);
  });
});
