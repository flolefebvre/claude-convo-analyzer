// The Recording format (docs/recording-format.md): what the writer puts on disk
// and what the reader gives back. Files are decoded here only to check what is
// on disk — the deduplication and the redaction are promises about the bytes.

import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  truncateSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalJson } from "@/core/canonical-json";
import {
  discoverRecordings,
  openRecordingWriter,
  readRecording,
  readRecordings,
  readRecordingWithoutBodies,
  readSelectedApiRequests,
  sessionIdInUserId,
  type RecordedApiRequest,
} from "@/core/recording";

const REQUEST_BODY = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "fixtures", "recording", "messages-request.json"), "utf8"),
);
const SECRETS = ["sk-ant-oat01-secret", "sk-ant-api03-secret", "session=cookie-secret", "device-fixture-7f3a"];

/** An API request of the fixture session, `body` and fields overridable. */
function apiRequest(overrides: Partial<RecordedApiRequest> = {}): RecordedApiRequest {
  return {
    sessionId: "sess-recorded",
    agentId: null,
    method: "POST",
    path: "/v1/messages",
    query: "beta=true",
    headers: {
      authorization: "Bearer sk-ant-oat01-secret",
      "x-api-key": "sk-ant-api03-secret",
      cookie: "session=cookie-secret",
      "anthropic-version": "2023-06-01",
    },
    body: structuredClone(REQUEST_BODY),
    response: {
      status: 200,
      requestId: "req_fixture01",
      headers: { "request-id": "req_fixture01", "set-cookie": ["session=cookie-secret; Path=/"] },
      body: { id: "msg_fixture01", type: "message", content: [{ type: "text", text: "Done." }] },
      isStreamed: true,
    },
    timings: {
      arrivedAt: "2026-10-18T10:00:00.000Z",
      firstByteAt: "2026-10-18T10:00:01.000Z",
      endedAt: "2026-10-18T10:00:02.000Z",
    },
    ...overrides,
  };
}

/** The fixture body, with `messages` grown by one assistant and one user Message. */
function nextTurnBody(): object {
  return {
    ...structuredClone(REQUEST_BODY),
    messages: [
      ...REQUEST_BODY.messages,
      { role: "assistant", content: [{ type: "text", text: "Done." }] },
      { role: "user", content: [{ type: "text", text: "Thanks." }] },
    ],
  };
}

/** Every JSON line of a Recording file, decoded from its gzip members. */
function linesOf(filePath: string): { type: string; hash?: string }[] {
  return gunzipSync(readFileSync(filePath))
    .toString("utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
}

let recordingsRoot: string;

beforeEach(() => {
  recordingsRoot = mkdtempSync(path.join(tmpdir(), "cca-recording-"));
});

afterEach(() => {
  rmSync(recordingsRoot, { recursive: true, force: true });
});

describe("a Recording", () => {
  it("stores each system block, tool definition and message shared by two API requests once", async () => {
    const writer = openRecordingWriter(recordingsRoot);
    await writer.append(apiRequest());
    await writer.append(apiRequest({ body: nextTurnBody() }));

    const lines = linesOf(path.join(recordingsRoot, "sess-recorded.jsonl.gz"));
    const pieceHashes = lines.filter((line) => line.type === "piece").map((line) => line.hash);
    // 2 system blocks + 1 tool definition + 3 distinct messages.
    expect(pieceHashes).toHaveLength(6);
    expect(new Set(pieceHashes).size).toBe(6);
    expect(lines.filter((line) => line.type === "api_request")).toHaveLength(2);
  });

  it("reads both API requests back in full", async () => {
    const writer = openRecordingWriter(recordingsRoot);
    await writer.append(apiRequest());
    await writer.append(apiRequest({ body: nextTurnBody() }));

    const [first, second] = readRecordings(recordingsRoot);
    expect(first.body).toEqual(redactedUserId(REQUEST_BODY));
    expect(second.body).toEqual(redactedUserId(nextTurnBody()));
    expect(second.response).toEqual({ ...apiRequest().response, headers: expect.any(Object) });
    expect(second.timings).toEqual(apiRequest().timings);
    expect(second).toMatchObject({
      sessionId: "sess-recorded",
      method: "POST",
      path: "/v1/messages",
      query: "beta=true",
    });
  });

  it("names a piece after its content, whatever the key order", async () => {
    const writer = openRecordingWriter(recordingsRoot);
    await writer.append(apiRequest({ body: { messages: [{ role: "user", content: "hi" }] } }));
    await writer.append(apiRequest({ body: { messages: [{ content: "hi", role: "user" }] } }));

    const lines = linesOf(path.join(recordingsRoot, "sess-recorded.jsonl.gz"));
    expect(lines.filter((line) => line.type === "piece")).toHaveLength(1);
  });

  it("names a piece by the first 16 hex characters of its content's sha256", async () => {
    const writer = openRecordingWriter(recordingsRoot);
    const message = { role: "user", content: "hi" };
    await writer.append(apiRequest({ body: { messages: [message] } }));

    const [piece] = linesOf(path.join(recordingsRoot, "sess-recorded.jsonl.gz")).filter(
      (line) => line.type === "piece",
    );
    const sha256 = createHash("sha256").update(canonicalJson(message)).digest("hex");
    expect(piece.hash).toBe(sha256.slice(0, 16));
  });

  it("reads, and appends after, a file whose pieces are named by the whole sha256", async () => {
    const message = { role: "user", content: "hi" };
    const filePath = path.join(recordingsRoot, "sess-recorded.jsonl.gz");
    const hash = createHash("sha256").update(canonicalJson(message)).digest("hex");
    const { body, ...withoutBody } = apiRequest();
    const lines = [
      { type: "piece", hash, content: message },
      { ...withoutBody, type: "api_request", body: { parameters: {}, messages: [hash] } },
    ];
    writeFileSync(filePath, gzipSync(lines.map((line) => JSON.stringify(line) + "\n").join("")));

    await openRecordingWriter(recordingsRoot).append(apiRequest({ body: { messages: [message] } }));

    expect(readRecording(filePath).map((recorded) => recorded.body)).toEqual([
      { messages: [message] },
      { messages: [message] },
    ]);
  });

  it("keeps a system prompt sent as one string, and a body that is not JSON", async () => {
    const writer = openRecordingWriter(recordingsRoot);
    const stringSystemBody = { model: "claude-haiku-4-5", system: "Be brief.", messages: [] };
    await writer.append(apiRequest({ body: stringSystemBody }));
    await writer.append(apiRequest({ method: "GET", path: "/api/hello", body: "plain text" }));
    await writer.append(apiRequest({ method: "GET", path: "/api/hello", body: null }));

    expect(readRecordings(recordingsRoot).map((recorded) => recorded.body)).toEqual([
      stringSystemBody,
      "plain text",
      null,
    ]);
  });

  it("deduplicates against what an earlier writer left in the file", async () => {
    await openRecordingWriter(recordingsRoot).append(apiRequest());
    await openRecordingWriter(recordingsRoot).append(apiRequest());

    const lines = linesOf(path.join(recordingsRoot, "sess-recorded.jsonl.gz"));
    expect(lines.filter((line) => line.type === "piece")).toHaveLength(4);
    expect(readRecordings(recordingsRoot)).toHaveLength(2);
  });

  it("deduplicates between API requests appended concurrently", async () => {
    const writer = openRecordingWriter(recordingsRoot);
    await Promise.all([writer.append(apiRequest()), writer.append(apiRequest()), writer.append(apiRequest())]);

    const lines = linesOf(path.join(recordingsRoot, "sess-recorded.jsonl.gz"));
    expect(lines.filter((line) => line.type === "piece")).toHaveLength(4);
    expect(lines.filter((line) => line.type === "api_request")).toHaveLength(3);
  });

  it("writes one gzip member per API request, so a file cut short mid-member keeps the requests before it", async () => {
    const writer = openRecordingWriter(recordingsRoot);
    await writer.append(apiRequest());
    const filePath = path.join(recordingsRoot, "sess-recorded.jsonl.gz");
    const sizeAfterFirst = statSync(filePath).size;
    await writer.append(apiRequest({ body: nextTurnBody() }));
    truncateSync(filePath, sizeAfterFirst + Math.floor((statSync(filePath).size - sizeAfterFirst) / 2));

    expect(readRecordings(recordingsRoot)).toHaveLength(1);
  });

  it("cuts off a member left short before appending after it, so the file stays whole", async () => {
    await openRecordingWriter(recordingsRoot).append(apiRequest());
    const filePath = path.join(recordingsRoot, "sess-recorded.jsonl.gz");
    const sizeAfterFirst = statSync(filePath).size;
    await openRecordingWriter(recordingsRoot).append(apiRequest({ body: nextTurnBody() }));
    truncateSync(filePath, sizeAfterFirst + Math.floor((statSync(filePath).size - sizeAfterFirst) / 2));

    await openRecordingWriter(recordingsRoot).append(apiRequest({ body: nextTurnBody() }));

    expect(() => gunzipSync(readFileSync(filePath))).not.toThrow();
    expect(readRecordings(recordingsRoot).map((recorded) => recorded.body)).toEqual([
      redactedUserId(REQUEST_BODY),
      redactedUserId(nextTurnBody()),
    ]);
    expect(readdirSync(recordingsRoot)).toEqual(["sess-recorded.jsonl.gz"]);
  });

  it("files API requests per session, and those of no session or an unsafe one as unattributed", async () => {
    const writer = openRecordingWriter(recordingsRoot);
    await writer.append(apiRequest());
    await writer.append(apiRequest({ sessionId: "sess-other" }));
    await writer.append(apiRequest({ sessionId: null }));
    await writer.append(apiRequest({ sessionId: "../escape" }));

    expect(readdirSync(recordingsRoot).sort()).toEqual([
      "sess-other.jsonl.gz",
      "sess-recorded.jsonl.gz",
      "unattributed.jsonl.gz",
    ]);
    expect(readRecordings(recordingsRoot).map((recorded) => recorded.sessionId)).toEqual([
      "sess-other",
      "sess-recorded",
      null,
      null,
    ]);
  });

  it("reads an empty or missing root as no API requests", () => {
    expect(readRecordings(recordingsRoot)).toEqual([]);
    expect(readRecordings(path.join(recordingsRoot, "missing"))).toEqual([]);
  });
});

describe("reading a Recording one session at a time", () => {
  it("discovers each Recording file with its session id, size and mtime, the unattributed one under no session", async () => {
    const writer = openRecordingWriter(recordingsRoot);
    await writer.append(apiRequest({ sessionId: "sess-other" }));
    await writer.append(apiRequest());
    await writer.append(apiRequest({ sessionId: null }));

    const recordings = discoverRecordings(recordingsRoot);

    expect(recordings.map((recording) => recording.sessionId)).toEqual(["sess-other", "sess-recorded", null]);
    const [, recorded] = recordings;
    const stat = statSync(path.join(recordingsRoot, "sess-recorded.jsonl.gz"));
    expect(recorded).toEqual({
      sessionId: "sess-recorded",
      sourcePath: path.join(recordingsRoot, "sess-recorded.jsonl.gz"),
      sourceMtime: Math.floor(stat.mtimeMs),
      sourceSize: stat.size,
    });
  });

  it("discovers no Recording in an empty or missing root", () => {
    expect(discoverRecordings(recordingsRoot)).toEqual([]);
    expect(discoverRecordings(path.join(recordingsRoot, "missing"))).toEqual([]);
  });

  it("reads one session's API requests in full, in append order", async () => {
    const writer = openRecordingWriter(recordingsRoot);
    await writer.append(apiRequest());
    await writer.append(apiRequest({ sessionId: "sess-other" }));
    await writer.append(apiRequest({ body: nextTurnBody() }));

    const apiRequests = readRecording(path.join(recordingsRoot, "sess-recorded.jsonl.gz"));

    expect(apiRequests.map((recorded) => recorded.body)).toEqual([
      redactedUserId(REQUEST_BODY),
      redactedUserId(nextTurnBody()),
    ]);
  });

  it("reads one session's API requests without their bodies, every other field kept", async () => {
    const writer = openRecordingWriter(recordingsRoot);
    await writer.append(apiRequest({ agentId: "agent-7", proxyError: "socket hang up", isClientAborted: true }));
    const filePath = path.join(recordingsRoot, "sess-recorded.jsonl.gz");

    const [withoutBody] = readRecordingWithoutBodies(filePath);

    const [inFull] = readRecording(filePath);
    const expected: Partial<RecordedApiRequest> = { ...inFull };
    delete expected.body;
    expect(withoutBody).toEqual({ ...expected, storedBodyHash: expect.any(String), sentOutline: expect.any(Object) });
    expect(withoutBody).not.toHaveProperty("body");
  });

  it("outlines what each API request sent by first lines, without restoring a body", async () => {
    const writer = openRecordingWriter(recordingsRoot);
    await writer.append(
      apiRequest({
        body: {
          model: "claude-haiku-4-5-20251001",
          system: [
            { type: "text", text: "First block.\nIts second line." },
            { type: "text", text: "Second block." },
          ],
          messages: [
            { role: "assistant", content: [{ type: "text", text: "Earlier." }] },
            {
              role: "user",
              content: [
                { type: "tool_result", tool_use_id: "t1", content: "ignored" },
                { type: "text", text: "Last text.\nMore." },
              ],
            },
          ],
        },
      }),
    );
    await writer.append(apiRequest({ body: { model: "m", system: "One string.\nTwo.", messages: [] } }));
    await writer.append(apiRequest({ body: "not json" }));

    const outlines = readRecordingWithoutBodies(path.join(recordingsRoot, "sess-recorded.jsonl.gz")).map(
      (recorded) => recorded.sentOutline,
    );

    expect(outlines).toEqual([
      {
        requestedModel: "claude-haiku-4-5-20251001",
        systemFirstLines: ["First block.", "Second block."],
        messageCount: 2,
        lastUserMessageFirstLines: ["Last text."],
      },
      { requestedModel: "m", systemFirstLines: ["One string."], messageCount: 0, lastUserMessageFirstLines: [] },
      { requestedModel: null, systemFirstLines: [], messageCount: 0, lastUserMessageFirstLines: [] },
    ]);
  });

  it("tells, without restoring them, which API requests of one file sent the same body", async () => {
    const writer = openRecordingWriter(recordingsRoot);
    await writer.append(apiRequest());
    await writer.append(apiRequest({ body: nextTurnBody() }));
    await writer.append(apiRequest({ body: { ...REQUEST_BODY } }));
    const filePath = path.join(recordingsRoot, "sess-recorded.jsonl.gz");

    const [first, next, repeated] = readRecordingWithoutBodies(filePath).map((recorded) => recorded.storedBodyHash);

    expect(repeated).toBe(first);
    expect(next).not.toBe(first);
  });

  it("reads API requests without their bodies even when a piece they reference is missing", async () => {
    await openRecordingWriter(recordingsRoot).append(apiRequest());
    const filePath = path.join(recordingsRoot, "sess-recorded.jsonl.gz");
    const apiRequestLines = linesOf(filePath).filter((line) => line.type === "api_request");
    writeFileSync(filePath, gzipSync(apiRequestLines.map((line) => JSON.stringify(line) + "\n").join("")));

    expect(() => readRecording(filePath)).toThrow(/missing piece/);
    expect(readRecordingWithoutBodies(filePath).map((recorded) => recorded.response.requestId)).toEqual([
      "req_fixture01",
    ]);
  });
});

/** `body` with its `metadata.user_id` as the writer stores it: the session id only. */
function redactedUserId(body: object): object {
  return {
    ...body,
    metadata: { user_id: '{"device_id":"<redacted>","account_uuid":"<redacted>","session_id":"sess-recorded"}' },
  };
}

describe("redaction in a Recording", () => {
  it("never writes the organization and workspace ids the API sends back", async () => {
    const response = {
      ...apiRequest().response,
      headers: { "anthropic-organization-id": "org-fixture-51d0", "anthropic-workspace-id": "wrk-fixture-77e2" },
    };
    await openRecordingWriter(recordingsRoot).append(apiRequest({ response }));

    const text = gunzipSync(readFileSync(path.join(recordingsRoot, "sess-recorded.jsonl.gz"))).toString("utf8");
    expect(text).not.toContain("org-fixture-51d0");
    expect(text).not.toContain("wrk-fixture-77e2");
    expect(readRecordings(recordingsRoot)[0].response.headers).toEqual({
      "anthropic-organization-id": "<redacted>",
      "anthropic-workspace-id": "<redacted>",
    });
  });

  it("never writes the auth and cookie headers, nor the account and device parts of metadata.user_id", async () => {
    const legacyUserId = "user_device-fixture-7f3a_account_account-fixture-9c1e_session_sess-recorded";
    const writer = openRecordingWriter(recordingsRoot);
    await writer.append(apiRequest());
    await writer.append(apiRequest({ body: { ...REQUEST_BODY, metadata: { user_id: legacyUserId } } }));

    const text = gunzipSync(readFileSync(path.join(recordingsRoot, "sess-recorded.jsonl.gz"))).toString("utf8");
    for (const secret of [...SECRETS, "account-fixture-9c1e"]) expect(text).not.toContain(secret);

    const [recorded, legacy] = readRecordings(recordingsRoot);
    expect(recorded.headers).toMatchObject({
      authorization: "<redacted>",
      "x-api-key": "<redacted>",
      cookie: "<redacted>",
      "anthropic-version": "2023-06-01",
    });
    expect(recorded.response.headers["set-cookie"]).toEqual(["<redacted>"]);
    expect(recorded.body).toEqual(redactedUserId(REQUEST_BODY));
    expect(legacy.body).toMatchObject({
      metadata: { user_id: "user_<redacted>_account_<redacted>_session_sess-recorded" },
    });
  });

  it("redacts a metadata.user_id of an unknown shape whole", async () => {
    await openRecordingWriter(recordingsRoot).append(
      apiRequest({ body: { ...REQUEST_BODY, metadata: { user_id: "device-fixture-7f3a" } } }),
    );

    expect(readRecordings(recordingsRoot)[0].body).toMatchObject({ metadata: { user_id: "<redacted>" } });
  });
});

describe("the selected API requests of a Recording", () => {
  /** A fixed mtime, set after each write, so a test controls the file's change key. */
  const MTIME = new Date("2026-10-18T12:00:00Z");

  /** The file of three API requests, each sending one Message more than the last, so pieces span three members. */
  async function threeTurnRecording(): Promise<string> {
    const writer = openRecordingWriter(recordingsRoot);
    for (const turn of [1, 2, 3]) {
      await writer.append(
        apiRequest({ body: turnBody(turn), response: { ...apiRequest().response, requestId: `req_${turn}` } }),
      );
    }
    const filePath = path.join(recordingsRoot, "sess-recorded.jsonl.gz");
    utimesSync(filePath, MTIME, MTIME);
    return filePath;
  }

  /** The body of Turn `turn`: one user Message per Turn so far. */
  function turnBody(turn: number): object {
    return {
      model: "claude-opus-4-5",
      system: [{ type: "text", text: "Be brief." }],
      messages: Array.from({ length: turn }, (_, index) => ({ role: "user", content: `prompt ${index + 1}` })),
    };
  }

  const isRequest = (requestId: string) => (recorded: { response: { requestId: string | null } }) =>
    recorded.response.requestId === requestId;

  it("restores a request whose pieces span several members", async () => {
    const filePath = await threeTurnRecording();

    const [third] = readSelectedApiRequests(filePath, isRequest("req_3"));

    expect(third.body).toEqual(turnBody(3));
  });

  it("returns the same API requests when the file is read again unchanged, without decoding it again", async () => {
    const filePath = await threeTurnRecording();
    const first = readSelectedApiRequests(filePath, isRequest("req_3"));
    // Same size and mtime, bytes no longer a Recording: only a decode would notice.
    writeFileSync(filePath, Buffer.alloc(statSync(filePath).size));
    utimesSync(filePath, MTIME, MTIME);

    expect(readSelectedApiRequests(filePath, isRequest("req_3"))).toEqual(first);
    expect(readSelectedApiRequests(filePath, isRequest("req_2"))[0].body).toEqual(turnBody(2));
  });

  it("reads an API request appended since the last read", async () => {
    const filePath = await threeTurnRecording();
    readSelectedApiRequests(filePath, isRequest("req_3"));

    await openRecordingWriter(recordingsRoot).append(
      apiRequest({ body: turnBody(4), response: { ...apiRequest().response, requestId: "req_4" } }),
    );

    expect(readSelectedApiRequests(filePath, isRequest("req_4"))[0].body).toEqual(turnBody(4));
  });

  it("reads a file repaired after a member cut short since the last read", async () => {
    const filePath = await threeTurnRecording();
    const sizeAfterThree = statSync(filePath).size;
    await openRecordingWriter(recordingsRoot).append(
      apiRequest({ body: turnBody(4), response: { ...apiRequest().response, requestId: "req_4" } }),
    );
    truncateSync(filePath, sizeAfterThree + Math.floor((statSync(filePath).size - sizeAfterThree) / 2));
    expect(readSelectedApiRequests(filePath, isRequest("req_4"))).toEqual([]);

    await openRecordingWriter(recordingsRoot).append(
      apiRequest({ body: turnBody(5), response: { ...apiRequest().response, requestId: "req_5" } }),
    );

    expect(readSelectedApiRequests(filePath, isRequest("req_4"))).toEqual([]);
    expect(readSelectedApiRequests(filePath, isRequest("req_5"))[0].body).toEqual(turnBody(5));
  });

  it("reads each of two files as its own", async () => {
    const filePath = await threeTurnRecording();
    await openRecordingWriter(recordingsRoot).append(
      apiRequest({ sessionId: "sess-other", response: { ...apiRequest().response, requestId: "req_other" } }),
    );
    const otherPath = path.join(recordingsRoot, "sess-other.jsonl.gz");

    expect(readSelectedApiRequests(filePath, isRequest("req_1"))).toHaveLength(1);
    expect(readSelectedApiRequests(otherPath, isRequest("req_1"))).toEqual([]);
    expect(readSelectedApiRequests(otherPath, isRequest("req_other"))).toHaveLength(1);
    expect(readSelectedApiRequests(filePath, isRequest("req_other"))).toEqual([]);
  });
});

describe("the session id in metadata.user_id", () => {
  it("is the session_id of the JSON shape", () => {
    expect(sessionIdInUserId(REQUEST_BODY.metadata.user_id)).toBe("sess-recorded");
  });

  it("is the _session_ suffix of the legacy shape", () => {
    expect(sessionIdInUserId("user_abc_account__session_6f1c-22")).toBe("6f1c-22");
  });

  it("is null for any other shape", () => {
    expect(sessionIdInUserId("user_abc")).toBeNull();
    expect(sessionIdInUserId('{"device_id":"abc"}')).toBeNull();
  });
});
