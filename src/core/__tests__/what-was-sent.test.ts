// What was sent (GLOSSARY.md) for a Turn whose API request the conversation
// logs record (Claude Code 2.1.300+, docs/conversation-log-format.md §9): its
// system prompt and tool changes since the previous API request of its Agent,
// its whole system prompt and tools, its parameters, and the body the logs
// rebuild so far — read from the database.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getTranscript, type TranscriptMessage } from "@/core/read";
import { refresh } from "@/core/refresh";
import { getRawApiRequest, getWhatWasSent, VOLATILE_SYSTEM_LINE_PATTERNS } from "@/core/what-was-sent";

import { type RecordedRequest, type RequestRecordMessage, writeRequestRecordsLog } from "./helpers/request-records-log";
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

/** The API request id of the `ordinal`-th (1-based) assistant Turn of an Agent. */
async function apiRequestIdOfTurn(ordinal: number, agentId?: string, sessionId = SESSION_ID): Promise<number> {
  const apiRequestId = (await turnsOf(agentId, sessionId))[ordinal - 1]?.apiRequestId;
  if (apiRequestId == null) throw new Error(`Turn ${ordinal} has no API request`);
  return apiRequestId;
}

describe("a Turn's API request in the logs", () => {
  it("is the source of What was sent on every Main-thread Turn its file holds the request of", async () => {
    const turns = await turnsOf();

    // The first Turn is history copied from a resumed session: its request is in no file here.
    expect(turns.map((turn) => turn.apiRequestId !== null)).toEqual([false, true, true, true, true]);
    expect(turns.map((turn) => turn.failedAttemptCount)).toEqual([0, 0, 0, 0, 0]);
  });

  it("is the source on a Sub-agent's Turns too", async () => {
    const turns = await turnsOf(SUB_AGENT_ID);

    expect(turns.map((turn) => turn.apiRequestId !== null)).toEqual([true, true]);
  });

  it("is not there for a Turn logged before Claude Code 2.1.300", async () => {
    const turns = await turnsOf(undefined, "sess-logged-old");

    expect(turns).toHaveLength(1);
    expect(turns[0]?.apiRequestId).toBeNull();
  });
});

describe("What was sent from the logs", () => {
  it("shows how the system prompt and the tools changed since the previous API request of the Agent", async () => {
    const sent = await getWhatWasSent(await apiRequestIdOfTurn(4), { dbPath: db.dbPath });

    expect(sent?.previousApiRequestId).toBe(await apiRequestIdOfTurn(3));
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
    const sent = await getWhatWasSent(await apiRequestIdOfTurn(3), { dbPath: db.dbPath });

    expect(sent?.previousApiRequestId).toBe(await apiRequestIdOfTurn(2));
    expect(sent?.systemPromptDiff).toBeNull();
    expect(sent?.toolsDiff).toBeNull();
  });

  it("has nothing to compare on the Agent's first API request", async () => {
    const sent = await getWhatWasSent(await apiRequestIdOfTurn(2), { dbPath: db.dbPath });

    expect(sent?.previousApiRequestId).toBeNull();
    expect(sent?.systemPromptDiff).toBeNull();
    expect(sent?.toolsDiff).toBeNull();
  });

  it("gives when the API request was sent", async () => {
    const sent = await getWhatWasSent(await apiRequestIdOfTurn(4), { dbPath: db.dbPath });

    expect(sent?.sentAt).toBe("2026-10-21T10:02:01.000Z");
  });

  it("gives the parameters, the whole system prompt with its cache breakpoints, and the tools", async () => {
    const sent = await getWhatWasSent(await apiRequestIdOfTurn(4), { dbPath: db.dbPath });

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

  it("works the same for a Sub-agent's Turn, against that Sub-agent's previous API request", async () => {
    const first = await apiRequestIdOfTurn(1, SUB_AGENT_ID);
    const sent = await getWhatWasSent(await apiRequestIdOfTurn(2, SUB_AGENT_ID), { dbPath: db.dbPath });

    expect(sent?.previousApiRequestId).toBe(first);
    expect(sent?.systemPromptDiff).toBeNull();
    expect(sent?.toolsDiff).toBeNull();
    expect(sent?.fullRequest.systemBlocks).toEqual([
      { kind: "text", shownAs: "text", text: "You are a search agent.", cacheControl: "ephemeral 1h" },
    ]);
  });

  it("is null for an unknown id", async () => {
    expect(await getWhatWasSent(999_999, { dbPath: db.dbPath })).toBeNull();
    expect(await getRawApiRequest(999_999, { dbPath: db.dbPath })).toBeNull();
  });
});

describe("the messages an API request sent", () => {
  it("include the system-reminder Claude Code injected in a user message, from the blob that logs it", async () => {
    const sent = await getWhatWasSent(await apiRequestIdOfTurn(2), { dbPath: db.dbPath });

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
    const sent = await getWhatWasSent(await apiRequestIdOfTurn(4), { dbPath: db.dbPath });

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
    const sent = await getWhatWasSent(await apiRequestIdOfTurn(3), { dbPath: db.dbPath });

    expect(sent?.fullRequest.messages[4]?.role).toBe("assistant");
    expect(sent?.fullRequest.messages[4]?.blocks.map((block) => block.kind)).toEqual(["text", "tool_use"]);
    expect(sent?.fullRequest.messages[4]?.blocks[0]).toMatchObject({ text: "Let me delegate the search." });
  });

  it("rebuild the leading part of a run of user records a request sent before the run grew", async () => {
    const sent = await getWhatWasSent(await apiRequestIdOfTurn(5), { dbPath: db.dbPath });

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
    const sent = await getWhatWasSent(await apiRequestIdOfTurn(2, SUB_AGENT_ID), { dbPath: db.dbPath });

    expect(sent?.fullRequest.messages.map((message) => message?.role)).toEqual(["user", "assistant", "user"]);
    expect(sent?.fullRequest.messages[0]?.blocks).toEqual([
      { kind: "text", shownAs: "text", text: "Find the export code." },
    ]);
  });

  it("follow the base chain back through every earlier request of the file", async () => {
    const sent = await getWhatWasSent(await apiRequestIdOfTurn(5), { dbPath: db.dbPath });

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
    const sent = await getWhatWasSent(await apiRequestIdOfTurn(4), { dbPath: db.dbPath });

    expect(sent?.firstNewMessageIndex).toBe(6);
    expect(sent?.fullRequest.messages.slice(6).map((message) => message?.blocks[0])).toMatchObject([
      { text: "The exports live in one module." },
      { text: "The date changed: it is now 2026-10-21." },
      { text: "now add a test" },
    ]);
  });

  it("are new since the previous answered API request, a retry's included", async () => {
    // lreq-3 retries lreq-2, which no Turn answered: what lreq-2 added is new against lreq-1.
    const sent = await getWhatWasSent(await apiRequestIdOfTurn(3), { dbPath: db.dbPath });

    expect(sent?.firstNewMessageIndex).toBe(4);
    expect(sent?.fullRequest.messages.slice(4).map((message) => message?.role)).toEqual(["assistant", "user"]);
  });

  it("are all new on the Agent's first API request", async () => {
    const sent = await getWhatWasSent(await apiRequestIdOfTurn(2), { dbPath: db.dbPath });

    expect(sent?.firstNewMessageIndex).toBe(0);
  });

  it("are new on a Sub-agent's Turn since that Sub-agent's previous API request", async () => {
    const sent = await getWhatWasSent(await apiRequestIdOfTurn(2, SUB_AGENT_ID), { dbPath: db.dbPath });

    expect(sent?.firstNewMessageIndex).toBe(1);
  });

  it("keep the place of each one the logs cannot rebuild, and count them", async () => {
    // greq-1's base is in no file, and the last hash of its tail names nothing its file holds.
    const sent = await getWhatWasSent(await apiRequestIdOfTurn(1, undefined, GAPS_SESSION_ID), {
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
    const sent = await getWhatWasSent(await apiRequestIdOfTurn(4), { dbPath: db.dbPath });
    const raw = await getRawApiRequest(await apiRequestIdOfTurn(4), { dbPath: db.dbPath });

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

describe("an API request raw", () => {
  it("is the body as the logs rebuild it: the parameters, the system prompt, the tools and the messages as logged", async () => {
    const raw = await getRawApiRequest(await apiRequestIdOfTurn(2), { dbPath: db.dbPath });

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
    });
  });

  it("leaves out the messages the logs cannot rebuild, counted, its breakpoints still where they were sent", async () => {
    const raw = await getRawApiRequest(await apiRequestIdOfTurn(1, undefined, GAPS_SESSION_ID), {
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

/** What a Turn's API request sends unless a test changes it. */
const SYSTEM = [
  { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." },
  { type: "text", text: "Working directory: /Users/me/dev/sent\nGit status: clean" },
];
const BASH_TOOL = {
  name: "Bash",
  description: "Run a shell command.",
  input_schema: { type: "object", properties: { command: { type: "string" } } },
};
const PROMPT: RequestRecordMessage = { role: "user", content: "audit the exports" };
const REPLY: RequestRecordMessage = {
  role: "assistant",
  content: [{ type: "tool_use", id: "tu-1", name: "Bash", input: { command: "ls billing" } }],
};
const RESULT: RequestRecordMessage = {
  role: "user",
  content: [{ type: "tool_result", tool_use_id: "tu-1", content: "export.ts" }],
};
const SYSTEM_REMINDER = "<system-reminder>The user opened billing/export.ts.</system-reminder>";

/** Two API requests of the Main thread: the opening prompt, then the history after a tool call. */
function twoRequests(change: Partial<RecordedRequest> = {}): RecordedRequest[] {
  return [
    { system: SYSTEM, tools: [BASH_TOOL], messages: [PROMPT] },
    { system: SYSTEM, tools: [BASH_TOOL], messages: [PROMPT, REPLY, RESULT], ...change },
  ];
}

describe("What was sent, request by request", () => {
  let scratchDir = "";

  beforeEach(() => {
    scratchDir = mkdtempSync(path.join(tmpdir(), "cca-what-was-sent-requests-"));
  });

  afterEach(() => rmSync(scratchDir, { recursive: true, force: true }));

  /** What was sent for each of `requests`, in order, as a log recording them reads after a Refresh. */
  async function whatWasSentOf(requests: RecordedRequest[]) {
    const logsRoot = path.join(scratchDir, "projects");
    const dbPath = path.join(scratchDir, "analyzer.db");
    writeRequestRecordsLog(logsRoot, "sess-sent", requests);
    await refresh({ logsRoot, dbPath });
    const turns = ((await getTranscript("sess-sent", { dbPath }))?.messages ?? []).filter(
      (m) => m.role === "assistant",
    );
    return Promise.all(turns.map((turn) => getWhatWasSent(turn.apiRequestId!, { dbPath })));
  }

  /** The changed lines of `hunks`, each as its marker and text, a volatile one ending in ` ~`. */
  function changedLinesOf(hunks: { lines: { change: string; text: string; isVolatile?: boolean }[] }[] = []) {
    return hunks
      .flatMap((hunk) => hunk.lines)
      .filter((line) => line.change !== "unchanged")
      .map((line) => `${line.change === "added" ? "+" : "-"}${line.text}${line.isVolatile ? " ~" : ""}`);
  }

  describe("the new messages", () => {
    it("count a prompt as new even when an earlier one read the same", async () => {
      const [, sent] = await whatWasSentOf(twoRequests({ messages: [PROMPT, REPLY, RESULT, PROMPT] }));

      expect(sent?.firstNewMessageIndex).toBe(1);
      expect(sent?.fullRequest.messages.slice(1).map((message) => message?.role)).toEqual([
        "assistant",
        "user",
        "user",
      ]);
    });

    it("do not count a message as new because its cache breakpoint moved", async () => {
      const [first, second] = twoRequests();
      const breakpoint = { type: "ephemeral" };
      const [, sent] = await whatWasSentOf([
        { ...first!, cacheBreakpoints: [{ path: ["messages", 0, "content", 0], value: breakpoint }] },
        { ...second!, cacheBreakpoints: [{ path: ["messages", 2, "content", 0], value: breakpoint }] },
      ]);

      expect(sent?.firstNewMessageIndex).toBe(1);
    });
  });

  describe("the parameters", () => {
    it("show a thinking parameter as its type then each field, and one of any other shape as JSON", async () => {
      const [enabled, other] = await whatWasSentOf([
        {
          ...twoRequests()[0]!,
          parameters: { model: "claude-opus-4-8", thinking: { type: "enabled", budget_tokens: 31999 } },
        },
        { ...twoRequests()[1]!, parameters: { model: "claude-opus-4-8", thinking: "adaptive-ish" } },
      ]);

      expect(enabled?.parameters.thinking).toBe("enabled · budget_tokens 31999");
      expect(other?.parameters.thinking).toBe('"adaptive-ish"');
    });
  });

  describe("when it was sent", () => {
    it("is unknown for a request whose record logs no time", async () => {
      const [sent] = await whatWasSentOf([{ ...twoRequests()[0]!, sentAt: null }]);

      expect(sent?.sentAt).toBeNull();
    });
  });

  describe("the system-prompt diff", () => {
    it("is volatile-only when only the git status changed", async () => {
      const [, sent] = await whatWasSentOf(
        twoRequests({
          system: [
            SYSTEM[0],
            { type: "text", text: "Working directory: /Users/me/dev/sent\nGit status: 2 files modified" },
          ],
        }),
      );

      expect(sent?.systemPromptDiff?.isVolatileOnly).toBe(true);
      expect(changedLinesOf(sent?.systemPromptDiff?.hunks)).toEqual([
        "-Git status: clean ~",
        "+Git status: 2 files modified ~",
      ]);
    });

    it("is volatile-only when a clean tree gained a modified file", async () => {
      const gitStatus = (status: string) => [{ type: "text", text: `gitStatus: at the start\nStatus:\n${status}` }];
      const [first, second] = twoRequests();
      const [, sent] = await whatWasSentOf([
        { ...first!, system: gitStatus("(clean)") },
        { ...second!, system: gitStatus(" M src/core/read.ts") },
      ]);

      expect(sent?.systemPromptDiff?.isVolatileOnly).toBe(true);
      expect(changedLinesOf(sent?.systemPromptDiff?.hunks)).toEqual(["-(clean) ~", "+ M src/core/read.ts ~"]);
    });

    it("reads a system prompt sent as one string as one block", async () => {
      const [, sent] = await whatWasSentOf(twoRequests({ system: "Answer briefly." }));

      expect(sent?.systemPromptDiff?.isVolatileOnly).toBe(false);
      expect(sent?.fullRequest.systemBlocks).toEqual([
        { kind: "text", shownAs: "text", text: "Answer briefly.", cacheControl: null },
      ]);
    });
  });

  describe("the tools diff", () => {
    const READ_TOOL = {
      name: "Read",
      description: "Read a file.",
      input_schema: { type: "object", properties: { file_path: { type: "string" } } },
    };

    it("is absent when only a tool's cache breakpoint changed", async () => {
      const [, sent] = await whatWasSentOf(
        twoRequests({ tools: [{ ...BASH_TOOL, cache_control: { type: "ephemeral" } }] }),
      );

      expect(sent?.toolsDiff).toBeNull();
    });

    it("names the tools added and removed", async () => {
      const [, sent] = await whatWasSentOf(twoRequests({ tools: [READ_TOOL] }));

      expect(sent?.toolsDiff).toEqual({
        added: [{ name: "Read", definitionJson: JSON.stringify(READ_TOOL, null, 2) }],
        removed: [{ name: "Bash", definitionJson: JSON.stringify(BASH_TOOL, null, 2) }],
        changed: [],
      });
    });

    it("shows a changed description as a line diff of the definition", async () => {
      const [, sent] = await whatWasSentOf(twoRequests({ tools: [{ ...BASH_TOOL, description: "Run a command." }] }));

      expect(sent?.toolsDiff?.changed.map((tool) => [tool.name, tool.changedFields])).toEqual([
        ["Bash", ["description"]],
      ]);
      expect(changedLinesOf(sent?.toolsDiff?.changed[0]?.hunks)).toEqual([
        '-  "description": "Run a shell command.",',
        '+  "description": "Run a command.",',
      ]);
    });

    it("names a changed input schema, whatever its key order", async () => {
      const reordered = { ...BASH_TOOL, input_schema: { properties: { command: { type: "string" } }, type: "object" } };
      const widened = {
        ...BASH_TOOL,
        input_schema: { type: "object", properties: { command: { type: "string" }, timeout: { type: "number" } } },
      };
      const [first, second] = twoRequests();
      const [, reorderedSent, widenedSent] = await whatWasSentOf([
        first!,
        { ...second!, tools: [reordered] },
        { ...second!, messages: [...second!.messages, PROMPT], tools: [widened] },
      ]);

      expect(reorderedSent?.toolsDiff).toBeNull();
      expect(widenedSent?.toolsDiff?.changed.map((tool) => tool.changedFields)).toEqual([["input_schema"]]);
    });
  });

  describe("the kind of a sent block", () => {
    /** The blocks of a request's one message, sent as `content`, as their kind and how they show. */
    async function kindsOfContent(content: unknown): Promise<[string, string][]> {
      const [sent] = await whatWasSentOf([{ system: SYSTEM, tools: [], messages: [{ role: "user", content }] }]);
      return (sent?.fullRequest.messages[0]?.blocks ?? []).map((block) => [block.kind, block.shownAs]);
    }

    it("is its type, a text block shown as text and any other as JSON", async () => {
      expect(
        await kindsOfContent([
          { type: "text", text: "audit the exports" },
          { type: "tool_result", tool_use_id: "tu-1", content: "export.ts" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } },
          { type: "thinking", thinking: "Look at billing first.", signature: "sig" },
          { type: "document", source: { type: "text", media_type: "text/plain", data: "notes" } },
        ]),
      ).toEqual([
        ["text", "text"],
        ["tool_result", "json"],
        ["image", "json"],
        ["thinking", "json"],
        ["document", "json"],
      ]);
    });

    it("is a tool_use for a tool call the model made", async () => {
      const [, sent] = await whatWasSentOf(twoRequests());

      expect(sent?.fullRequest.messages[1]?.blocks.map((block) => block.kind)).toEqual(["tool_use"]);
    });

    it("is a system-reminder for a text block opening with its tag, leading whitespace aside", async () => {
      expect(
        await kindsOfContent([
          { type: "text", text: SYSTEM_REMINDER },
          { type: "text", text: `\n  ${SYSTEM_REMINDER}` },
          { type: "text", text: `See this: ${SYSTEM_REMINDER}` },
        ]),
      ).toEqual([
        ["system-reminder", "text"],
        ["system-reminder", "text"],
        ["text", "text"],
      ]);
    });

    it("is a text block, or a system-reminder, for a message whose content is a string", async () => {
      expect(await kindsOfContent(SYSTEM_REMINDER)).toEqual([["system-reminder", "text"]]);
    });

    it("is none for a message sent without content: it has no blocks", async () => {
      const [sent] = await whatWasSentOf([{ system: SYSTEM, tools: [], messages: [{ role: "user" }] }]);

      expect(sent?.fullRequest.messages).toEqual([{ role: "user", blocks: [] }]);
    });
  });
});

describe("a volatile system-prompt line", () => {
  it.each([
    "Today's date is 2026-10-19.",
    "Today's date: 2026-10-19",
    "Current date: 2026-10-19",
    "Working directory: /Users/me/dev/sent",
    "Primary working directory: /Users/me/dev/sent",
    "gitStatus: This is the git status at the start of the conversation.",
    "Git status: clean",
    "Current branch: main",
    "Status:",
    "Recent commits:",
    "(clean)",
    "M src/core/read.ts",
    " M src/core/read.ts",
    "?? docs/notes.md",
    "7ece6e8 Add the export audit trail (#161)",
    "",
    "   ",
  ])("matches %j", (line) => {
    expect(VOLATILE_SYSTEM_LINE_PATTERNS.some((pattern) => pattern.test(line))).toBe(true);
  });

  it.each([
    "A tool call runs in the sandbox.",
    "A skill is a packaged set of instructions.",
    "M is for model.",
    "Keep changes small, run the tests before you report.",
  ])("does not match the prose line %j", (line) => {
    expect(VOLATILE_SYSTEM_LINE_PATTERNS.some((pattern) => pattern.test(line))).toBe(false);
  });
});
