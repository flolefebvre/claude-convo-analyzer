import path from "node:path";
import { describe, expect, it } from "vitest";

import { getToolCallBody, getTranscript } from "@/core/read";

import { seededTempDb } from "./helpers/temp-db";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "tool-body-logs");

describe("getToolCallBody", () => {
  const db = seededTempDb({ prefix: "cca-tool-body-", logsRoot: FIXTURES_ROOT });

  /** The row id of the fixture's Tool call with this `tool_use` id, as the Transcript page carries it. */
  async function callId(toolUseId: string): Promise<number> {
    const view = await getTranscript("sess-toolbody", { dbPath: db.dbPath });
    const call = view?.messages.flatMap((m) => m.toolCalls).find((c) => c.toolUseId === toolUseId);
    if (call === undefined) throw new Error(`no tool call ${toolUseId} in the fixture`);
    return call.id;
  }

  it("returns a Tool call's input and stored result", async () => {
    const body = await getToolCallBody(await callId("toolu-b-bash"), { dbPath: db.dbPath });

    expect(body).toEqual({
      inputJson: JSON.stringify({ command: "echo hello" }),
      resultText: "hello\n",
      resultTruncated: false,
      resultCharSize: 6,
      isError: false,
      inputParts: [{ kind: "raw" }],
      resultParts: [{ kind: "raw" }],
    });
  });

  it("shapes an Agent call's input into its facts and its Task prompt", async () => {
    const body = await getToolCallBody(await callId("toolu-b-agent"), { dbPath: db.dbPath });

    expect(body?.inputParts).toEqual([
      {
        kind: "facts",
        facts: [
          { key: "subagent_type", value: "Plan" },
          { key: "description", value: "plan the log rotation" },
          { key: "model", value: "sonnet" },
          { key: "run_in_background", value: "false" },
        ],
      },
      {
        kind: "markdown",
        text: "## Task\n\nPlan how `big.log` gets rotated.\n\n- keep the last 7 days\n- compress older files\n\n```sh\nls -la /Users/me/dev/toolbody\n```",
      },
    ]);
    expect(body?.resultParts).toEqual([{ kind: "raw" }]);
  });

  it("returns null for an unknown id", async () => {
    expect(await getToolCallBody(999_999, { dbPath: db.dbPath })).toBeNull();
  });

  it("returns the stored prefix of a truncated result, with its full size", async () => {
    const body = await getToolCallBody(await callId("toolu-b-read"), { dbPath: db.dbPath });

    expect(body?.resultTruncated).toBe(true);
    expect(body?.resultText).toHaveLength(10_000);
    expect(body?.resultCharSize).toBe(12_000);
  });

  it("returns an Agent call's result whole, however long its hand-back", async () => {
    const body = await getToolCallBody(await callId("toolu-b-agent-long"), { dbPath: db.dbPath });

    expect(body?.resultTruncated).toBe(false);
    expect(body?.resultText).toHaveLength(12_000);
    expect(body?.resultText).toMatch(/long report\n$/);
    expect(body?.resultCharSize).toBe(12_000);
  });

  it("flags an error result", async () => {
    const body = await getToolCallBody(await callId("toolu-b-edit"), { dbPath: db.dbPath });

    expect(body?.isError).toBe(true);
    expect(body?.resultText).toBe("Error: string to replace not found in file");
  });

  it("has no result for a call that was never answered", async () => {
    const body = await getToolCallBody(await callId("toolu-b-grep"), { dbPath: db.dbPath });

    expect(body?.inputJson).toContain("never answered");
    expect(body?.resultText).toBeNull();
    expect(body?.resultCharSize).toBeNull();
  });
});
