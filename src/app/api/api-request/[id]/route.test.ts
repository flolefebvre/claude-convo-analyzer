// The What-was-sent route and its Raw sibling, driven through their pipes:
// each exported `GET` is called as Next calls it, against the default database
// and Recordings root (`refreshedDefaultDatabase`), one for the whole file.

import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { getTranscript } from "@/core/read";
import { openRecordingWriter, type RecordedApiRequest } from "@/core/recording";

import { coreFixtureLogsRoot, refreshedDefaultDatabase } from "../../__tests__/helpers/default-database";
import { GET as getRawApiRequestRoute } from "./raw/route";
import { GET as getWhatWasSentRoute } from "./route";

const SESSION_ID = "sess-sent";

/** The API request of the fixture's first Main-thread Turn. */
const FIRST_TURN: RecordedApiRequest = {
  sessionId: SESSION_ID,
  agentId: null,
  method: "POST",
  path: "/v1/messages",
  query: "",
  headers: { "anthropic-version": "2023-06-01", authorization: "Bearer sk-ant-fixture-secret" },
  body: { model: "claude-opus-4-8", max_tokens: 32000, messages: [{ role: "user", content: "audit the exports" }] },
  response: { status: 200, requestId: "sreq-1", headers: {}, body: null, isStreamed: true },
  timings: {
    arrivedAt: "2026-10-18T10:00:01.000Z",
    firstByteAt: "2026-10-18T10:00:02.000Z",
    endedAt: "2026-10-18T10:00:04.000Z",
  },
};

/** Both routes, by the path each answers. */
const ROUTES = [
  ["GET /api/api-request/[id]", getWhatWasSentRoute],
  ["GET /api/api-request/[id]/raw", getRawApiRequestRoute],
] as const;

/** Call `route` for the raw `[id]` segment `id`. */
async function responseOf(route: (typeof ROUTES)[number][1], id: string): Promise<{ status: number; json: unknown }> {
  const res = await route(new Request(`http://localhost/api/api-request/${id}`), { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json() };
}

/** The `api_request` row id of the fixture's first Main-thread Turn. */
async function firstTurnApiRequestId(): Promise<number | null> {
  const view = await getTranscript(SESSION_ID);
  const source = view?.messages.find((message) => message.role === "assistant")?.whatWasSentSource;
  return source?.from === "recording" ? source.apiRequestId : null;
}

const db = refreshedDefaultDatabase({
  prefix: "cca-api-request-route-",
  logsRoot: coreFixtureLogsRoot("what-was-sent-logs"),
  record: (recordingsRoot) => openRecordingWriter(recordingsRoot).append(FIRST_TURN),
});

describe("GET /api/api-request/[id]", () => {
  it("answers a recorded Turn's API request with what was sent", async () => {
    const res = await responseOf(getWhatWasSentRoute, String(await firstTurnApiRequestId()));

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      parameters: { model: "claude-opus-4-8", maxTokens: 32000 },
      timings: { timeToFirstByteMs: 1000, durationMs: 3000 },
      previousApiRequestId: null,
      firstNewMessageIndex: 0,
      fullRequest: {
        messages: [{ role: "user", blocks: [{ kind: "text", shownAs: "text", text: "audit the exports" }] }],
      },
    });
  });
});

describe("GET /api/api-request/[id]/raw", () => {
  it("answers a recorded Turn's API request raw, as JSON values", async () => {
    const res = await responseOf(getRawApiRequestRoute, String(await firstTurnApiRequestId()));

    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      requestBody: FIRST_TURN.body,
      responseBody: null,
      requestHeaders: { "anthropic-version": "2023-06-01", authorization: "<redacted>" },
    });
  });
});

describe.each(ROUTES)("%s", (_, route) => {
  it("answers 404 for an unknown id", async () => {
    expect((await responseOf(route, "999999")).status).toBe(404);
  });

  it.each(["abc", "0", "-3", "1.5", "2147483648"])("answers 400 for the malformed id %j", async (id) => {
    expect((await responseOf(route, id)).status).toBe(400);
  });
});

// Last: it removes the file's Recordings.
describe("both routes, once the Recording no longer holds the API request", () => {
  it("answer 404", async () => {
    const apiRequestId = String(await firstTurnApiRequestId());
    rmSync(db.recordingsRoot, { recursive: true, force: true });

    for (const [, route] of ROUTES) expect((await responseOf(route, apiRequestId)).status).toBe(404);
  });
});
