// What was sent (GLOSSARY.md) for a Turn whose API request the conversation
// logs record (Claude Code 2.1.300+, docs/conversation-log-format.md §9): its
// system prompt and tool changes since the previous API request of its Agent,
// its whole system prompt and tools, its parameters, and the body the logs
// rebuild so far — read from the database, no Recording involved.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { getTranscript, type TranscriptMessage } from "@/core/read";
import { openRecordingWriter, type RecordedApiRequest } from "@/core/recording";
import { refresh } from "@/core/refresh";
import { getLoggedRawApiRequest, getLoggedWhatWasSent } from "@/core/what-was-sent";

import { seededTempDb } from "./helpers/temp-db";

const LOGS_ROOT = path.join(import.meta.dirname, "fixtures", "logged-request-logs");
const SESSION_ID = "sess-logged";
const SUB_AGENT_ID = "lsub1";
/** A session whose one API request's base is in no file, and whose tail names a message no record holds. */
const GAPS_SESSION_ID = "sess-logged-gaps";

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

const db = seededTempDb({ prefix: "cca-what-was-sent-from-logs-", logsRoot: LOGS_ROOT });

/** The assistant Turns of one Agent's transcript (`agentId` undefined: the Main thread). */
async function turnsOf(agentId?: string, sessionId = SESSION_ID): Promise<TranscriptMessage[]> {
  const view = await getTranscript(sessionId, { dbPath: db.dbPath, agentId });
  return (view?.messages ?? []).filter((message) => message.role === "assistant");
}

/** The logged API request id of the `ordinal`-th (1-based) assistant Turn of an Agent. */
async function loggedApiRequestIdOfTurn(ordinal: number, agentId?: string, sessionId = SESSION_ID): Promise<number> {
  const source = (await turnsOf(agentId, sessionId))[ordinal - 1]?.whatWasSentSource;
  if (source?.from !== "logs") throw new Error(`Turn ${ordinal} has no logged API request`);
  return source.loggedApiRequestId;
}

/** The first logged Main-thread Turn's API request as a Recording holds it, answered with `status`. */
function recordedFirstTurn(status: number): RecordedApiRequest {
  return {
    sessionId: SESSION_ID,
    agentId: null,
    method: "POST",
    path: "/v1/messages",
    query: "",
    headers: {},
    body: { model: "claude-opus-4-8", messages: [] },
    response: {
      status,
      requestId: status === 200 ? "rid-lmsg-1" : "rid-overloaded",
      headers: {},
      body:
        status === 200
          ? { id: "lmsg-1", type: "message", content: [] }
          : { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
      isStreamed: false,
    },
    timings: {
      arrivedAt: "2026-10-21T10:00:01.005Z",
      firstByteAt: "2026-10-21T10:00:02.000Z",
      endedAt: "2026-10-21T10:00:04.000Z",
    },
  };
}

describe("a Turn's API request in the logs", () => {
  it("is the source of What was sent on every Main-thread Turn its file holds the request of", async () => {
    const turns = await turnsOf();

    // The first Turn is history copied from a resumed session: its request is in no file here.
    expect(turns.map((turn) => turn.whatWasSentSource?.from ?? null)).toEqual([null, "logs", "logs", "logs", "logs"]);
    expect(turns.map((turn) => turn.failedAttemptCount)).toEqual([0, 0, 0, 0, 0]);
  });

  it("is the source on a Sub-agent's Turns too", async () => {
    const turns = await turnsOf(SUB_AGENT_ID);

    expect(turns.map((turn) => turn.whatWasSentSource?.from ?? null)).toEqual(["logs", "logs"]);
  });

  it("wins over a Recording holding the same Turn's API request, its failed attempts included", async () => {
    const recordingsRoot = path.join(path.dirname(db.dbPath), "recordings");
    const writer = openRecordingWriter(recordingsRoot);
    await writer.append(recordedFirstTurn(529));
    await writer.append(recordedFirstTurn(200));
    await refresh({ logsRoot: LOGS_ROOT, dbPath: db.dbPath, recordingsRoot });

    const [, firstLoggedTurn] = await turnsOf();

    expect(firstLoggedTurn?.whatWasSentSource?.from).toBe("logs");
    expect(firstLoggedTurn?.failedAttemptCount).toBe(0);
  });

  it("is not there for a Turn logged before Claude Code 2.1.300", async () => {
    const turns = await turnsOf(undefined, "sess-logged-old");

    expect(turns).toHaveLength(1);
    expect(turns[0]?.whatWasSentSource).toBeNull();
  });
});

describe("What was sent from the logs", () => {
  it("shows how the system prompt and the tools changed since the previous API request of the Agent", async () => {
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(4), { dbPath: db.dbPath });

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
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(3), { dbPath: db.dbPath });

    expect(sent?.previousApiRequestId).toBe(await loggedApiRequestIdOfTurn(2));
    expect(sent?.systemPromptDiff).toBeNull();
    expect(sent?.toolsDiff).toBeNull();
  });

  it("has nothing to compare on the Agent's first API request", async () => {
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(2), { dbPath: db.dbPath });

    expect(sent?.previousApiRequestId).toBeNull();
    expect(sent?.systemPromptDiff).toBeNull();
    expect(sent?.toolsDiff).toBeNull();
  });

  it("gives the parameters, the whole system prompt with its cache breakpoints, and the tools", async () => {
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(4), { dbPath: db.dbPath });

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

  it("has none of what only a Recording knows", async () => {
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(4), { dbPath: db.dbPath });

    expect(sent).toMatchObject({ isSideRequest: false, timings: null, failedAttempts: [] });
  });

  it("works the same for a Sub-agent's Turn, against that Sub-agent's previous API request", async () => {
    const first = await loggedApiRequestIdOfTurn(1, SUB_AGENT_ID);
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(2, SUB_AGENT_ID), { dbPath: db.dbPath });

    expect(sent?.previousApiRequestId).toBe(first);
    expect(sent?.systemPromptDiff).toBeNull();
    expect(sent?.toolsDiff).toBeNull();
    expect(sent?.fullRequest.systemBlocks).toEqual([
      { kind: "text", shownAs: "text", text: "You are a search agent.", cacheControl: "ephemeral 1h" },
    ]);
  });

  it("is null for an unknown id", async () => {
    expect(await getLoggedWhatWasSent(999_999, { dbPath: db.dbPath })).toBeNull();
    expect(await getLoggedRawApiRequest(999_999, { dbPath: db.dbPath })).toBeNull();
  });
});

describe("the messages a logged API request sent", () => {
  it("include the system-reminder Claude Code injected in a user message, from the blob that logs it", async () => {
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(2), { dbPath: db.dbPath });

    expect(sent?.fullRequest.messages[2]).toEqual({
      role: "user",
      blocks: [
        {
          kind: "system-reminder",
          shownAs: "text",
          text: "<system-reminder>\nCLAUDE.md: keep exports in one module.\n</system-reminder>",
        },
      ],
    });
  });

  it("are every message, rebuilt from the file's records where no blob holds one", async () => {
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(4), { dbPath: db.dbPath });

    expect(sent?.missingMessageCount).toBe(0);
    expect(sent?.fullRequest.messages.map((message) => [message?.role, message?.blocks[0]?.kind])).toEqual([
      ["user", "text"],
      ["assistant", "text"],
      ["user", "system-reminder"],
      ["user", "text"],
      ["assistant", "text"],
      ["user", "tool_result"],
      ["assistant", "text"],
      ["system", "text"],
      ["user", "text"],
    ]);
  });

  it("rebuild a Turn written as several records sharing its message id as one message, their blocks in order", async () => {
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(3), { dbPath: db.dbPath });

    expect(sent?.fullRequest.messages[4]?.role).toBe("assistant");
    expect(sent?.fullRequest.messages[4]?.blocks.map((block) => block.kind)).toEqual(["text", "tool_use"]);
    expect(sent?.fullRequest.messages[4]?.blocks[0]).toMatchObject({ text: "Let me delegate the search." });
  });

  it("rebuild the leading part of a run of user records a request sent before the run grew", async () => {
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(5), { dbPath: db.dbPath });

    expect(sent?.missingMessageCount).toBe(0);
    expect(sent?.fullRequest.messages).toHaveLength(11);
    expect(sent?.fullRequest.messages[10]).toEqual({
      role: "user",
      blocks: [
        {
          kind: "tool_result",
          shownAs: "json",
          json: JSON.stringify({ type: "tool_result", tool_use_id: "ltu-3", content: "1 passed" }, null, 2),
        },
      ],
    });
  });

  it("are a Sub-agent's own, rebuilt from its transcript", async () => {
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(2, SUB_AGENT_ID), { dbPath: db.dbPath });

    expect(sent?.fullRequest.messages.map((message) => message?.role)).toEqual(["user", "assistant", "user"]);
    expect(sent?.fullRequest.messages[0]?.blocks).toEqual([
      { kind: "text", shownAs: "text", text: "Find the export code." },
    ]);
  });

  it("follow the base chain back through every earlier request of the file", async () => {
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(5), { dbPath: db.dbPath });

    // lreq-5 keeps lreq-4's, which kept lreq-3's, itself the retry of lreq-2, which kept lreq-1's.
    expect(sent?.fullRequest.messages.map((message) => message?.blocks[0])).toMatchObject([
      { text: "earlier question" },
      { text: "Earlier answer." },
      { kind: "system-reminder" },
      { text: "audit the exports" },
      { text: "Let me delegate the search." },
      { kind: "tool_result" },
      { text: "The exports live in one module." },
      { text: "The date changed: it is now 2026-10-21." },
      { text: "now add a test" },
      { text: "Added a test." },
      { kind: "tool_result" },
    ]);
  });

  it("are new from the first one the previous API request of the Agent did not send", async () => {
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(4), { dbPath: db.dbPath });

    expect(sent?.firstNewMessageIndex).toBe(6);
    expect(sent?.fullRequest.messages.slice(6).map((message) => message?.blocks[0])).toMatchObject([
      { text: "The exports live in one module." },
      { text: "The date changed: it is now 2026-10-21." },
      { text: "now add a test" },
    ]);
  });

  it("are new since the previous answered API request, a retry's included", async () => {
    // lreq-3 retries lreq-2, which no Turn answered: what lreq-2 added is new against lreq-1.
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(3), { dbPath: db.dbPath });

    expect(sent?.firstNewMessageIndex).toBe(4);
    expect(sent?.fullRequest.messages.slice(4).map((message) => message?.role)).toEqual(["assistant", "user"]);
  });

  it("are all new on the Agent's first API request", async () => {
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(2), { dbPath: db.dbPath });

    expect(sent?.firstNewMessageIndex).toBe(0);
  });

  it("are new on a Sub-agent's Turn since that Sub-agent's previous API request", async () => {
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(2, SUB_AGENT_ID), { dbPath: db.dbPath });

    expect(sent?.firstNewMessageIndex).toBe(1);
  });

  it("keep the place of each one the logs cannot rebuild, and count them", async () => {
    // greq-1's base is in no file, and the last hash of its tail names nothing its file holds.
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(1, undefined, GAPS_SESSION_ID), {
      dbPath: db.dbPath,
    });

    expect(sent?.missingMessageCount).toBe(3);
    expect(sent?.fullRequest.messages).toEqual([
      null,
      null,
      { role: "user", blocks: [{ kind: "text", shownAs: "text", text: "pick up where we left off" }] },
      null,
    ]);
  });

  it("include the system message Claude Code injected, from a blob logged after the request, its string content kept", async () => {
    const sent = await getLoggedWhatWasSent(await loggedApiRequestIdOfTurn(4), { dbPath: db.dbPath });
    const raw = await getLoggedRawApiRequest(await loggedApiRequestIdOfTurn(4), { dbPath: db.dbPath });

    expect(sent?.fullRequest.messages[7]).toEqual({
      role: "system",
      blocks: [{ kind: "text", shownAs: "text", text: "The date changed: it is now 2026-10-21." }],
    });
    expect((raw?.requestBody as { messages: unknown[] }).messages[7]).toEqual({
      role: "system",
      content: "The date changed: it is now 2026-10-21.",
    });
  });
});

describe("a logged API request raw", () => {
  it("is the body as the logs rebuild it: the parameters, the system prompt, the tools and the messages as logged", async () => {
    const raw = await getLoggedRawApiRequest(await loggedApiRequestIdOfTurn(2), { dbPath: db.dbPath });

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
        // A string content stays a string; the breakpoint at ["messages", 1, "content", 0] is set there.
        messages: [
          { role: "user", content: "earlier question" },
          {
            role: "assistant",
            content: [{ type: "text", text: "Earlier answer.", cache_control: { type: "ephemeral" } }],
          },
          {
            role: "user",
            content: [
              { type: "text", text: "<system-reminder>\nCLAUDE.md: keep exports in one module.\n</system-reminder>" },
            ],
          },
          { role: "user", content: "audit the exports" },
        ],
      },
      missingMessageCount: 0,
      responseBody: null,
      requestHeaders: null,
    });
  });

  it("leaves out the messages the logs cannot rebuild, counted, its breakpoints still where they were sent", async () => {
    const raw = await getLoggedRawApiRequest(await loggedApiRequestIdOfTurn(1, undefined, GAPS_SESSION_ID), {
      dbPath: db.dbPath,
    });

    expect(raw?.missingMessageCount).toBe(3);
    expect(raw?.requestBody).toMatchObject({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "pick up where we left off", cache_control: { type: "ephemeral" } }],
        },
      ],
    });
  });
});

describe("safeguards", () => {
  it("are never stored", () => {
    for (const file of [db.dbPath, `${db.dbPath}-wal`]) {
      if (existsSync(file)) expect(readFileSync(file).includes(SAFEGUARDS_TEXT)).toBe(false);
    }
  });
});
