// What was sent (GLOSSARY.md) for a Turn whose API request the conversation
// logs record (Claude Code 2.1.300+, docs/conversation-log-format.md §9): its
// system prompt and tool changes since the previous API request of its Agent,
// its whole system prompt and tools, its parameters, and the body the logs
// rebuild so far — read from the database, no Recording involved.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getTranscript, type TranscriptMessage } from "@/core/read";
import { refresh } from "@/core/refresh";
import { getLoggedRawApiRequest, getLoggedWhatWasSent } from "@/core/what-was-sent";

const LOGS_ROOT = path.join(import.meta.dirname, "fixtures", "logged-request-logs");
const SESSION_ID = "sess-logged";
const SUB_AGENT_ID = "lsub1";

/** The parameters every fixture request logs, `safeguards` left out. */
const STORED_PARAMETERS = {
  model: "claude-opus-4-8",
  betas: ["beta-one", "beta-two"],
  max_tokens: 32000,
  thinking: { type: "adaptive", display: "updates" },
  context_management: { edits: [] },
  output_config: { effort: "high" },
};
/** The `safeguards` context the fixture logs on every request, which is never stored. */
const SAFEGUARDS_TEXT = "stub-safeguards-context";

let scratchDir = "";
let dbPath = "";

beforeEach(async () => {
  scratchDir = mkdtempSync(path.join(tmpdir(), "cca-what-was-sent-from-logs-"));
  dbPath = path.join(scratchDir, "analyzer.db");
  await refresh({ logsRoot: LOGS_ROOT, dbPath, recordingsRoot: path.join(scratchDir, "recordings") });
});

afterEach(() => rmSync(scratchDir, { recursive: true, force: true }));

/** The assistant Turns of one Agent's transcript (`agentId` undefined: the Main thread). */
async function turnsOf(agentId?: string, sessionId = SESSION_ID): Promise<TranscriptMessage[]> {
  const view = await getTranscript(sessionId, { dbPath, agentId });
  return (view?.messages ?? []).filter((message) => message.role === "assistant");
}

/** The logged API request id of the `ordinal`-th (1-based) assistant Turn of an Agent. */
async function loggedApiRequestIdOfTurn(ordinal: number, agentId?: string): Promise<number> {
  const source = (await turnsOf(agentId))[ordinal - 1]?.whatWasSentSource;
  if (source?.from !== "logs") throw new Error(`Turn ${ordinal} has no logged API request`);
  return source.loggedApiRequestId;
}

describe("a Turn's API request in the logs", () => {
  it("is the source of What was sent on every Main-thread Turn its file holds the request of", async () => {
    const turns = await turnsOf();

    // The first Turn is history copied from a resumed session: its request is in no file here.
    expect(turns.map((turn) => turn.whatWasSentSource?.from ?? null)).toEqual([null, "logs", "logs", "logs"]);
    expect(turns.map((turn) => turn.failedAttemptCount)).toEqual([0, 0, 0, 0]);
  });

  it("is the source on a Sub-agent's Turns too", async () => {
    const turns = await turnsOf(SUB_AGENT_ID);

    expect(turns.map((turn) => turn.whatWasSentSource?.from ?? null)).toEqual(["logs", "logs"]);
  });

  it("is not there for a Turn logged before Claude Code 2.1.300", async () => {
    const turns = await turnsOf(undefined, "sess-logged-old");

    expect(turns).toHaveLength(1);
    expect(turns[0]?.whatWasSentSource).toBeNull();
  });
});

describe("What was sent from the logs", () => {
  it("shows how the system prompt and the tools changed since the previous API request of the Agent", async () => {
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(4), { dbPath });

    expect(sent?.previousApiRequestId).toBe(await loggedApiRequestIdOfTurn(3));
    expect(sent?.systemPromptDiff?.isVolatileOnly).toBe(false);
    const changedLines = sent?.systemPromptDiff?.hunks
      .flatMap((hunk) => hunk.lines)
      .filter((line) => line.change !== "unchanged");
    expect(changedLines).toEqual([
      { change: "removed", text: "Today's date: 2026-10-20", isVolatile: true },
      { change: "added", text: "Today's date: 2026-10-21", isVolatile: true },
      { change: "added", text: "Always run the tests.", isVolatile: false },
    ]);
    expect(sent?.toolsDiff?.added.map((tool) => tool.name)).toEqual(["Grep"]);
    expect(sent?.toolsDiff?.removed).toEqual([]);
    expect(sent?.toolsDiff?.changed).toEqual([]);
  });

  it("compares against the previous answered API request, never an unanswered one retried since", async () => {
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(3), { dbPath });

    expect(sent?.previousApiRequestId).toBe(await loggedApiRequestIdOfTurn(2));
    expect(sent?.systemPromptDiff).toBeNull();
    expect(sent?.toolsDiff).toBeNull();
  });

  it("has nothing to compare on the Agent's first API request", async () => {
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(2), { dbPath });

    expect(sent?.previousApiRequestId).toBeNull();
    expect(sent?.systemPromptDiff).toBeNull();
    expect(sent?.toolsDiff).toBeNull();
  });

  it("gives the parameters, the whole system prompt with its cache breakpoints, and the tools", async () => {
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(4), { dbPath });

    expect(sent?.parameters).toEqual({
      model: "claude-opus-4-8",
      maxTokens: 32000,
      thinking: "adaptive · display updates",
      effort: "high",
      betas: ["beta-one", "beta-two"],
    });
    expect(sent?.fullRequest.parameterByName).toEqual(STORED_PARAMETERS);
    expect(sent?.fullRequest.systemBlocks.map((block) => block.cacheControl)).toEqual(["ephemeral 1h", "ephemeral"]);
    expect(sent?.fullRequest.systemBlocks[0]).toMatchObject({ shownAs: "text", text: "You are a coding agent." });
    expect(sent?.fullRequest.tools.map((tool) => tool.name)).toEqual(["Bash", "Grep"]);
  });

  it("does not rebuild the messages yet, and has none of what only a Recording knows", async () => {
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(4), { dbPath });

    expect(sent).toMatchObject({
      isSideRequest: false,
      timings: null,
      failedAttempts: [],
      firstNewMessageIndex: 0,
      fullRequest: { messages: null },
    });
  });

  it("works the same for a Sub-agent's Turn, against that Sub-agent's previous API request", async () => {
    const first = await loggedApiRequestIdOfTurn(1, SUB_AGENT_ID);
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(2, SUB_AGENT_ID), { dbPath });

    expect(sent?.previousApiRequestId).toBe(first);
    expect(sent?.systemPromptDiff).toBeNull();
    expect(sent?.toolsDiff).toBeNull();
    expect(sent?.fullRequest.systemBlocks).toEqual([
      { kind: "text", shownAs: "text", text: "You are a search agent.", cacheControl: "ephemeral 1h" },
    ]);
  });

  it("is null for an unknown id", async () => {
    expect(await getLoggedWhatWasSent(999_999, { dbPath })).toBeNull();
    expect(await getLoggedRawApiRequest(999_999, { dbPath })).toBeNull();
  });
});

describe("a logged API request raw", () => {
  it("is the body as the logs rebuild it so far: the parameters, the system prompt and the tools, no messages", async () => {
    const raw = await getLoggedRawApiRequest(await loggedApiRequestIdOfTurn(2), { dbPath });

    expect(raw).toEqual({
      requestBody: {
        ...STORED_PARAMETERS,
        system: [
          {
            type: "text",
            text: "You are a coding agent.",
            cache_control: { type: "ephemeral", ttl: "1h", scope: "global" },
          },
          {
            type: "text",
            text: "Working directory: /Users/me/dev/logged\nToday's date: 2026-10-20\nAnswer briefly.",
            cache_control: { type: "ephemeral" },
          },
        ],
        tools: [
          {
            name: "Bash",
            description: "Run a command.",
            input_schema: { type: "object", properties: { command: { type: "string" } } },
          },
        ],
      },
      responseBody: null,
      requestHeaders: null,
    });
  });
});

describe("safeguards", () => {
  it("are never stored", () => {
    for (const file of [dbPath, `${dbPath}-wal`]) {
      if (existsSync(file)) expect(readFileSync(file).includes(SAFEGUARDS_TEXT)).toBe(false);
    }
  });
});
