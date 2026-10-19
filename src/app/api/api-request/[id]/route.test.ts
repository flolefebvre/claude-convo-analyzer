// The What-was-sent route, driven through its pipe: the exported `GET` is
// called as Next calls it, against the default database and Recordings root
// (`refreshedDefaultDatabase`).

import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { getTranscript } from "@/core/read";
import { openRecordingWriter, type RecordedApiRequest } from "@/core/recording";

import { coreFixtureLogsRoot, refreshedDefaultDatabase } from "../../__tests__/helpers/default-database";
import { GET } from "./route";

const SESSION_ID = "sess-sent";

/** The API request of the fixture's first Main-thread Turn. */
const FIRST_TURN: RecordedApiRequest = {
  sessionId: SESSION_ID,
  agentId: null,
  method: "POST",
  path: "/v1/messages",
  query: "",
  headers: {},
  body: { model: "claude-opus-4-8", max_tokens: 32000, messages: [{ role: "user", content: "audit the exports" }] },
  response: { status: 200, requestId: "sreq-1", headers: {}, body: null, isStreamed: true },
  timings: {
    arrivedAt: "2026-10-18T10:00:01.000Z",
    firstByteAt: "2026-10-18T10:00:02.000Z",
    endedAt: "2026-10-18T10:00:04.000Z",
  },
};

/** Call the route for the raw `[id]` segment `id`. */
async function getWhatWasSentResponse(id: string): Promise<{ status: number; json: unknown }> {
  const res = await GET(new Request(`http://localhost/api/api-request/${id}`), { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json() };
}

/** The `api_request` row id of the fixture's first Main-thread Turn. */
async function firstTurnApiRequestId(): Promise<number | null | undefined> {
  const view = await getTranscript(SESSION_ID);
  return view?.messages.find((message) => message.role === "assistant")?.apiRequestId;
}

describe("GET /api/api-request/[id]", () => {
  const db = refreshedDefaultDatabase({
    prefix: "cca-api-request-route-",
    logsRoot: coreFixtureLogsRoot("what-was-sent-logs"),
    record: (recordingsRoot) => openRecordingWriter(recordingsRoot).append(FIRST_TURN),
  });

  it("answers a recorded Turn's API request with what was sent", async () => {
    const res = await getWhatWasSentResponse(String(await firstTurnApiRequestId()));

    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({
      parameters: { model: "claude-opus-4-8", maxTokens: 32000 },
      timings: { timeToFirstByteMs: 1000, durationMs: 3000 },
      previousApiRequestId: null,
      newMessages: [{ role: "user", blocks: [{ kind: "text", text: "audit the exports" }] }],
    });
  });

  it("answers 404 for an unknown id", async () => {
    expect((await getWhatWasSentResponse("999999")).status).toBe(404);
  });

  it("answers 404 when the Recording no longer holds the API request", async () => {
    const apiRequestId = await firstTurnApiRequestId();
    rmSync(db.recordingsRoot, { recursive: true, force: true });

    expect((await getWhatWasSentResponse(String(apiRequestId))).status).toBe(404);
  });

  it.each(["abc", "0", "-3", "1.5"])("answers 400 for the malformed id %j", async (id) => {
    expect((await getWhatWasSentResponse(id)).status).toBe(400);
  });
});
