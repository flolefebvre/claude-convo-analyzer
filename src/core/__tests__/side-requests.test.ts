// Side requests (GLOSSARY.md): the API requests Claude Code makes on its own,
// classified by kind at Refresh time from what they sent, and their Unlogged
// usage — theirs, and that of the failed attempts the API reported usage for —
// priced into the Conversation's Cost. A Turn's own API request never adds to
// Cost: the logs' Turn usage stays the source of truth (ADR-0006).

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildFamily } from "@/core/family";
import { getConversation, getTranscript, listConversations } from "@/core/read";
import { openRecordingWriter, type RecordedApiRequest } from "@/core/recording";
import { refresh } from "@/core/refresh";

/** The small model Side requests run on, priced $1 input / $5 output per million tokens. */
const HAIKU = "claude-haiku-4-5-20251001";

/** The recorded fixture logs: a main Conversation with a sub-agent, and another Conversation beside it. */
const LOGS_ROOT = path.join(import.meta.dirname, "fixtures", "recorded-logs");
const MAIN_SESSION_ID = "sess-rec-main";
const OTHER_SESSION_ID = "sess-rec-other";

/** Usage that prices at exactly $3 on {@link HAIKU}: 2M input ($2) and 200k output ($1). */
const THREE_DOLLARS_OF_HAIKU = {
  input_tokens: 2_000_000,
  output_tokens: 200_000,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
const BILLING_HEADER = "x-anthropic-billing-header: cc_version=2.1.303; cc_entrypoint=cli;";

let tmpDir: string;
let recordingsRoot: string;
let dbPath: string;
let arrivalSecond: number;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "cca-side-"));
  recordingsRoot = path.join(tmpDir, "recordings");
  dbPath = path.join(tmpDir, "analyzer.db");
  arrivalSecond = 0;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** A system prompt sent as text blocks, one per string. */
function systemBlocks(...texts: string[]): object[] {
  return texts.map((text) => ({ type: "text", text }));
}

/**
 * An API request of the main fixture Conversation's Main thread, answered
 * `status` with `responseBody`; `requestId` names it in no log unless the
 * test says so. Each arrives one second after the previous one.
 */
function apiRequest(opts: {
  requestId: string;
  body: object;
  path?: string;
  status?: number;
  responseBody?: unknown;
  isClientAborted?: boolean;
}): RecordedApiRequest {
  arrivalSecond += 1;
  const arrivedMs = Date.parse("2026-10-18T10:05:00.000Z") + arrivalSecond * 1000;
  return {
    sessionId: MAIN_SESSION_ID,
    agentId: null,
    method: "POST",
    path: opts.path ?? "/v1/messages",
    query: "beta=true",
    headers: { "anthropic-version": "2023-06-01" },
    body: opts.body,
    response: {
      status: opts.status ?? 200,
      requestId: opts.requestId,
      headers: { "request-id": opts.requestId },
      body: opts.responseBody ?? null,
      isStreamed: false,
    },
    timings: {
      arrivedAt: new Date(arrivedMs).toISOString(),
      firstByteAt: new Date(arrivedMs + 400).toISOString(),
      endedAt: new Date(arrivedMs + 900).toISOString(),
    },
    ...(opts.isClientAborted ? { isClientAborted: true } : {}),
  };
}

/** The message a Side request is answered with, on `model`, with `usage`. */
function answer(requestId: string, usage: object = THREE_DOLLARS_OF_HAIKU, model: string = HAIKU): object {
  return { id: `msg-${requestId}`, type: "message", role: "assistant", model, content: [], usage };
}

/** An overloaded error response, with no usage. */
const OVERLOADED = { type: "error", error: { type: "overloaded_error", message: "Overloaded" } };

const sessionNaming = (requestId = "req-naming") =>
  apiRequest({
    requestId,
    body: {
      model: HAIKU,
      system: systemBlocks(
        BILLING_HEADER,
        "You are naming a coding session so the user can pick it out of a long list of sessions.\nReturn JSON.",
      ),
      messages: [{ role: "user", content: "<session>\naudit the exports\n</session>" }],
    },
    responseBody: answer(requestId),
  });

const quotaProbe = (requestId = "req-quota", status = 200) =>
  apiRequest({
    requestId,
    status,
    body: { model: HAIKU, max_tokens: 1, messages: [{ role: "user", content: "quota" }] },
    responseBody:
      status === 200
        ? answer(requestId)
        : { type: "error", error: { type: "rate_limit_error", message: "Rate limited" } },
  });

const safetyMonitor = (requestId = "req-monitor") =>
  apiRequest({
    requestId,
    body: {
      model: HAIKU,
      system: systemBlocks(
        BILLING_HEADER,
        CLAUDE_CODE_IDENTITY,
        "You are a security monitor for autonomous AI coding agents.\n\n## Context",
      ),
      messages: [{ role: "user", content: "rm -rf build" }],
    },
    responseBody: answer(requestId),
  });

const suggestion = (requestId = "req-suggestion") =>
  apiRequest({
    requestId,
    body: {
      model: "claude-opus-4-8",
      system: systemBlocks(BILLING_HEADER, CLAUDE_CODE_IDENTITY, "You are an interactive agent."),
      messages: [
        { role: "user", content: "audit the exports" },
        { role: "assistant", content: [{ type: "text", text: "The exports live in billing/export.ts." }] },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "[SUGGESTION MODE: Suggest what the user might naturally type next into Claude Code.]\n\nFIRST: …",
            },
          ],
        },
      ],
    },
    responseBody: answer(requestId),
  });

const tokenCount = (requestId = "req-count") =>
  apiRequest({
    requestId,
    path: "/v1/messages/count_tokens",
    body: {
      model: "claude-opus-4-8",
      system: systemBlocks(CLAUDE_CODE_IDENTITY),
      messages: [{ role: "user", content: "audit the exports" }],
    },
    responseBody: { input_tokens: 21_384 },
  });

const otherSideRequest = (requestId = "req-other") =>
  apiRequest({
    requestId,
    body: {
      model: HAIKU,
      system: systemBlocks(BILLING_HEADER, "Summarize the tool calls below in one line.\nBe terse."),
      messages: [{ role: "user", content: "Read billing/export.ts" }],
    },
    responseBody: answer(requestId),
  });

/** A Turn-shaped request of the Main thread: Claude Code's system prompt and a history. */
function turnShapedBody(lastPrompt: string): object {
  return {
    model: "claude-opus-4-8",
    max_tokens: 32000,
    system: systemBlocks(BILLING_HEADER, CLAUDE_CODE_IDENTITY, "You are an interactive agent."),
    messages: [{ role: "user", content: lastPrompt }],
  };
}

/** Append `apiRequests` to the Recordings under the test's root. */
async function record(apiRequests: RecordedApiRequest[]): Promise<void> {
  const writer = openRecordingWriter(recordingsRoot);
  for (const recorded of apiRequests) await writer.append(recorded);
}

/** Refresh the fixture logs with the test's Recordings. */
async function refreshFixtures(): Promise<void> {
  await refresh({ logsRoot: LOGS_ROOT, dbPath, recordingsRoot });
}

/** The main fixture Conversation's Side requests, as its detail breaks them down by kind. */
async function sideRequestKinds(): Promise<string[]> {
  const detail = await getConversation(MAIN_SESSION_ID, { dbPath });
  return (detail?.sideRequests.byKind ?? []).map((group) => group.kind);
}

/** The main fixture Conversation's Cost, as the list shows it. */
async function listedCostOf(sessionId: string): Promise<number | undefined> {
  return (await listConversations({ dbPath })).find((summary) => summary.id === sessionId)?.costUsd;
}

/** A fixture Conversation's detail with no Recording at all. */
async function detailWithoutRecording(sessionId = MAIN_SESSION_ID) {
  const unrecordedDbPath = path.join(tmpDir, "unrecorded.db");
  await refresh({ logsRoot: LOGS_ROOT, dbPath: unrecordedDbPath, recordingsRoot: path.join(tmpDir, "none") });
  return (await getConversation(sessionId, { dbPath: unrecordedDbPath }))!;
}

/** A fixture Conversation's Cost with no Recording at all. */
async function costWithoutRecording(sessionId = MAIN_SESSION_ID): Promise<number> {
  return (await detailWithoutRecording(sessionId)).costUsd;
}

describe("a Side request's kind", () => {
  it("is session naming when its system prompt opens as Claude Code's session naming", async () => {
    await record([sessionNaming()]);
    await refreshFixtures();
    expect(await sideRequestKinds()).toEqual(["session-naming"]);
  });

  it("is quota probe for a one-message `quota` request", async () => {
    await record([quotaProbe()]);
    await refreshFixtures();
    expect(await sideRequestKinds()).toEqual(["quota-probe"]);
  });

  it("stays quota probe when the API answered it 429", async () => {
    await record([quotaProbe("req-quota-429", 429)]);
    await refreshFixtures();
    expect(await sideRequestKinds()).toEqual(["quota-probe"]);
  });

  it("is safety monitor when a system block opens as the security monitor's", async () => {
    await record([safetyMonitor()]);
    await refreshFixtures();
    expect(await sideRequestKinds()).toEqual(["safety-monitor"]);
  });

  it("is suggestion when the last user text starts with `[SUGGESTION MODE`, though Turn-shaped", async () => {
    await record([suggestion()]);
    await refreshFixtures();
    expect(await sideRequestKinds()).toEqual(["suggestion"]);
  });

  it("is token count for a `count_tokens` call", async () => {
    await record([tokenCount()]);
    await refreshFixtures();
    expect(await sideRequestKinds()).toEqual(["token-count"]);
  });

  it("is other for anything else, labelled by its system prompt's first line past the billing header", async () => {
    await record([otherSideRequest()]);
    await refreshFixtures();

    expect(await sideRequestKinds()).toEqual(["other"]);
    const view = await getTranscript(MAIN_SESSION_ID, { dbPath });
    expect(view?.sideRequests.map((s) => [s.kind, s.otherKindLabel])).toEqual([
      ["other", "Summarize the tool calls below in one line."],
    ]);
  });

  it("is never a Turn's request or a failed attempt that a retry joined to a Turn", async () => {
    const retry = apiRequest({
      requestId: "rreq-2",
      body: turnShapedBody("never mind"),
      responseBody: { id: "rmsg-2", type: "message", content: [] },
    });
    const attempt = { ...retry, response: { ...retry.response, status: 529, requestId: "req-a", body: OVERLOADED } };
    await record([attempt, retry]);
    await refreshFixtures();

    expect(await sideRequestKinds()).toEqual([]);
  });
});

describe("a failed attempt no retry joined to a Turn", () => {
  it("is a failed attempt, not a Side request, when it is Turn-shaped", async () => {
    await record([
      apiRequest({ requestId: "req-gave-up", status: 529, body: turnShapedBody("audit"), responseBody: OVERLOADED }),
    ]);
    await refreshFixtures();

    const detail = await getConversation(MAIN_SESSION_ID, { dbPath });
    expect(detail?.sideRequests).toEqual({ count: 0, costUsd: 0, unpriced: false, byKind: [] });
    expect((await getTranscript(MAIN_SESSION_ID, { dbPath }))?.sideRequests).toEqual([]);
  });
});

describe("Unlogged usage in a Conversation's Cost", () => {
  it("prices a Side request's usage into its Conversation's Cost, per Resolved model", async () => {
    const unrecorded = await detailWithoutRecording();
    const baseCostUsd = unrecorded.costUsd;
    const haikuCostOf = (perModel: { model: string; costUsd: number }[]) =>
      perModel.find((group) => group.model === HAIKU)?.costUsd ?? 0;
    await record([sessionNaming(), safetyMonitor()]);
    await refreshFixtures();

    expect(await listedCostOf(MAIN_SESSION_ID)).toBeCloseTo(baseCostUsd + 6, 9);
    const detail = await getConversation(MAIN_SESSION_ID, { dbPath });
    expect(detail?.costUsd).toBeCloseTo(baseCostUsd + 6, 9);
    expect(haikuCostOf(detail!.perModel)).toBeCloseTo(haikuCostOf(unrecorded.perModel) + 6, 9);
    expect(detail?.tokens.input).toBe(unrecorded.tokens.input + 4_000_000);
    expect(detail?.sideRequests).toMatchObject({ count: 2, unpriced: false });
    expect(detail?.sideRequests.costUsd).toBeCloseTo(6, 9);
    expect(detail?.sideRequests.byKind.map((group) => [group.kind, group.count, group.costUsd])).toEqual([
      ["safety-monitor", 1, 3],
      ["session-naming", 1, 3],
    ]);
  });

  it("adds nothing for a token count: counting is not billed", async () => {
    const baseCostUsd = await costWithoutRecording();
    await record([tokenCount()]);
    await refreshFixtures();

    expect(await listedCostOf(MAIN_SESSION_ID)).toBeCloseTo(baseCostUsd, 9);
    expect((await getConversation(MAIN_SESSION_ID, { dbPath }))?.sideRequests).toMatchObject({ count: 1, costUsd: 0 });
  });

  it("counts a failed attempt the API reported usage for, without listing it as a Side request", async () => {
    const baseCostUsd = await costWithoutRecording();
    await record([
      apiRequest({
        requestId: "req-gave-up",
        status: 500,
        body: turnShapedBody("audit"),
        responseBody: { ...answer("req-gave-up"), error: { type: "api_error", message: "Internal" } },
      }),
    ]);
    await refreshFixtures();

    expect(await listedCostOf(MAIN_SESSION_ID)).toBeCloseTo(baseCostUsd + 3, 9);
    expect((await getConversation(MAIN_SESSION_ID, { dbPath }))?.sideRequests.count).toBe(0);
  });

  it("never adds a Turn's own API request, even one that reports usage", async () => {
    const baseCostUsd = await costWithoutRecording();
    await record([
      apiRequest({ requestId: "rreq-2", body: turnShapedBody("audit"), responseBody: answer("rmsg-2-x") }),
    ]);
    await refreshFixtures();

    expect(await listedCostOf(MAIN_SESSION_ID)).toBeCloseTo(baseCostUsd, 9);
  });

  it("never adds an interrupted Turn the logs recorded: it joins its Turn by message.id", async () => {
    const baseCostUsd = await costWithoutRecording();
    await record([
      apiRequest({
        requestId: "req-interrupted",
        body: turnShapedBody("audit"),
        isClientAborted: true,
        responseBody: { ...answer("x"), id: "rmsg-2", model: "claude-opus-4-8" },
      }),
    ]);
    await refreshFixtures();

    expect(await listedCostOf(MAIN_SESSION_ID)).toBeCloseTo(baseCostUsd, 9);
    expect((await getConversation(MAIN_SESSION_ID, { dbPath }))?.recordedState).toBe("partially-recorded");
  });

  it("flags the Cost as a lower bound for a Side request on an unpriced model", async () => {
    await record([
      apiRequest({
        requestId: "req-unknown-model",
        body: { model: "claude-future-9", messages: [{ role: "user", content: "hi" }] },
        responseBody: answer("req-unknown-model", THREE_DOLLARS_OF_HAIKU, "claude-future-9"),
      }),
    ]);
    await refreshFixtures();

    const detail = await getConversation(MAIN_SESSION_ID, { dbPath });
    expect(detail?.unpriced).toBe(true);
    expect(detail?.sideRequests).toMatchObject({ count: 1, costUsd: 0, unpriced: true });
  });

  it("leaves another Conversation's Cost unchanged", async () => {
    const baseCostUsd = await costWithoutRecording(OTHER_SESSION_ID);
    await record([sessionNaming(), quotaProbe(), safetyMonitor(), suggestion(), tokenCount(), otherSideRequest()]);
    await refreshFixtures();

    expect(await listedCostOf(OTHER_SESSION_ID)).toBe(baseCostUsd);
  });

  it("is in the continuation family's cumulative total", async () => {
    const baseCostUsd = await costWithoutRecording();
    await record([sessionNaming()]);
    await refreshFixtures();

    expect(buildFamily(await listConversations({ dbPath }), MAIN_SESSION_ID)?.totalCostUsd).toBeCloseTo(
      baseCostUsd + 3,
      9,
    );
  });
});

describe("the Transcript's Side requests", () => {
  it("lists each one, in arrival order, with its kind, time and cost, and adds them to the grand total", async () => {
    await refreshFixtures();
    const unrecordedTotalUsd = (await getTranscript(MAIN_SESSION_ID, { dbPath }))!.totalCostUsd;
    rmSync(dbPath);

    const naming = sessionNaming();
    const count = tokenCount();
    await record([naming, count]);
    await refreshFixtures();

    const view = await getTranscript(MAIN_SESSION_ID, { dbPath });
    expect(
      view?.sideRequests.map(({ kind, arrivedAt, costUsd, unpriced }) => ({ kind, arrivedAt, costUsd, unpriced })),
    ).toEqual([
      { kind: "session-naming", arrivedAt: naming.timings.arrivedAt, costUsd: 3, unpriced: false },
      { kind: "token-count", arrivedAt: count.timings.arrivedAt, costUsd: 0, unpriced: false },
    ]);
    expect(view?.sideRequests.every((s) => typeof s.apiRequestId === "number")).toBe(true);
    expect(view?.totalCostUsd).toBeCloseTo(unrecordedTotalUsd + 3, 9);
  });
});
