// The Recorder forwards every API request unchanged and records it, against a
// fake upstream on 127.0.0.1: no test touches the network. A Recording is read
// after `stop()`, which flushes every append.

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startRecorder, type RunningRecorder } from "@/core/recorder";
import { readRecordings } from "@/core/recording";
import {
  deferred,
  MESSAGES_REQUEST_JSON,
  MESSAGES_RESPONSE_SSE,
  respondWithEventStream,
  startFakeUpstream,
  type FakeUpstream,
} from "./helpers/fake-upstream";

const SESSION_ID = "sess-recorded";
const AUTH_TOKEN = "sk-ant-oat01-secret";

const REASSEMBLED_MESSAGE = {
  id: "msg_fixture01",
  type: "message",
  role: "assistant",
  model: "claude-opus-4-8",
  content: [
    { type: "thinking", thinking: "The user wants a listing.", signature: "c2lnLXBhcnQtMQc2lnLXBhcnQtMg" },
    { type: "text", text: "Listing them now." },
    { type: "tool_use", id: "toolu_fixture01", name: "Bash", input: { command: "ls -la" } },
  ],
  stop_reason: "tool_use",
  stop_sequence: null,
  usage: {
    input_tokens: 12,
    cache_creation_input_tokens: 300,
    cache_read_input_tokens: 1000,
    cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 },
    output_tokens: 42,
  },
};

let tmpDir: string;
let recordingsRoot: string;
let upstream: FakeUpstream | undefined;
let recorder: RunningRecorder | undefined;
let loggedMessages: string[];

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "cca-recorder-"));
  recordingsRoot = path.join(tmpDir, "recordings");
  loggedMessages = [];
});

afterEach(async () => {
  await recorder?.stop();
  await upstream?.close();
  recorder = undefined;
  upstream = undefined;
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Start a Recorder on a free port, in front of `upstreamUrl`. */
async function startTestRecorder(upstreamUrl: string, root = recordingsRoot): Promise<RunningRecorder> {
  recorder = await startRecorder({
    port: 0,
    upstreamUrl,
    recordingsRoot: root,
    log: (message) => loggedMessages.push(message),
  });
  return recorder;
}

/** POST the fixture body to the Recorder, as Claude Code does. */
function postMessages(runningRecorder: RunningRecorder, init: RequestInit = {}): Promise<Response> {
  return fetch(`http://127.0.0.1:${runningRecorder.port}/v1/messages?beta=true`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${AUTH_TOKEN}`,
      "content-type": "application/json",
      "x-claude-code-session-id": SESSION_ID,
      cookie: "session=cookie-secret",
    },
    body: MESSAGES_REQUEST_JSON,
    ...init,
  });
}

describe("forwarding through the Recorder", () => {
  it("sends the same method, path, query, body and auth upstream, without hop-by-hop headers or accept-encoding", async () => {
    upstream = await startFakeUpstream(respondWithEventStream);
    const runningRecorder = await startTestRecorder(upstream.url);

    // Raw http, since fetch refuses to set hop-by-hop headers.
    await new Promise<void>((resolve) => {
      const clientRequest = http.request(
        {
          host: "127.0.0.1",
          port: runningRecorder.port,
          method: "POST",
          path: "/v1/messages?beta=true",
          headers: {
            authorization: `Bearer ${AUTH_TOKEN}`,
            connection: "keep-alive, x-hop",
            "keep-alive": "timeout=5",
            "x-hop": "1",
            "accept-encoding": "gzip",
          },
        },
        (response) => response.resume().on("end", resolve),
      );
      clientRequest.end(MESSAGES_REQUEST_JSON);
    });

    const [received] = upstream.receivedRequests;
    expect(received).toMatchObject({ method: "POST", url: "/v1/messages?beta=true", body: MESSAGES_REQUEST_JSON });
    expect(received.headers.authorization).toBe(`Bearer ${AUTH_TOKEN}`);
    expect(received.headers.host).toBe(new URL(upstream.url).host);
    expect(received.headers["accept-encoding"]).toBeUndefined();
    expect(received.headers["keep-alive"]).toBeUndefined();
    expect(received.headers["x-hop"]).toBeUndefined();
  });

  it("forwards under the path of an upstream behind a gateway", async () => {
    upstream = await startFakeUpstream(respondWithEventStream);
    const runningRecorder = await startTestRecorder(`${upstream.url}/gateway/anthropic/`);

    await (await postMessages(runningRecorder)).text();

    expect(upstream.receivedRequests[0].url).toBe("/gateway/anthropic/v1/messages?beta=true");
  });

  it("streams a response back chunk by chunk, before the upstream finishes", async () => {
    const releaseRest = deferred();
    const [firstEvent, ...restEvents] = MESSAGES_RESPONSE_SSE.split(/(?<=\n\n)/);
    upstream = await startFakeUpstream((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(firstEvent);
      void releaseRest.promise.then(() => response.end(restEvents.join("")));
    });
    const runningRecorder = await startTestRecorder(upstream.url);

    const response = await postMessages(runningRecorder);
    const reader = response.body!.getReader();
    const firstChunk = new TextDecoder().decode((await reader.read()).value);
    expect(firstChunk).toBe(firstEvent);

    releaseRest.resolve();
    let rest = "";
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      rest += new TextDecoder().decode(chunk.value);
    }
    expect(firstChunk + rest).toBe(MESSAGES_RESPONSE_SSE);
  });

  it("records the reassembled response, its usage with the cache split, its status, request-id and timings", async () => {
    upstream = await startFakeUpstream(respondWithEventStream);
    const runningRecorder = await startTestRecorder(upstream.url);
    const sentAt = Date.now();

    await (await postMessages(runningRecorder)).text();
    await runningRecorder.stop();

    const [recorded] = readRecordings(recordingsRoot);
    expect(recorded).toMatchObject({ sessionId: SESSION_ID, method: "POST", path: "/v1/messages", query: "beta=true" });
    expect(recorded.response).toMatchObject({ status: 200, requestId: "req_fixture01", isStreamed: true });
    expect(recorded.response.headers["content-type"]).toBe("text/event-stream");
    expect(recorded.response.body).toEqual(REASSEMBLED_MESSAGE);
    expect(recorded.body).toMatchObject({
      model: "claude-opus-4-8",
      messages: JSON.parse(MESSAGES_REQUEST_JSON).messages,
    });

    const { arrivedAt, firstByteAt, endedAt } = recorded.timings;
    expect(Date.parse(arrivedAt)).toBeGreaterThanOrEqual(sentAt - 1000);
    expect(Date.parse(firstByteAt!)).toBeGreaterThanOrEqual(Date.parse(arrivedAt));
    expect(Date.parse(endedAt)).toBeGreaterThanOrEqual(Date.parse(firstByteAt!));
  });

  it("records a non-streamed JSON response as it came", async () => {
    const countTokensResponse = { input_tokens: 1234 };
    upstream = await startFakeUpstream((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(countTokensResponse));
    });
    const runningRecorder = await startTestRecorder(upstream.url);

    const response = await postMessages(runningRecorder);
    expect(await response.json()).toEqual(countTokensResponse);
    await runningRecorder.stop();

    expect(readRecordings(recordingsRoot)[0].response).toMatchObject({ body: countTokensResponse, isStreamed: false });
  });

  it("never writes the auth and cookie headers or the metadata.user_id account and device parts to any file", async () => {
    upstream = await startFakeUpstream((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream", "set-cookie": "upstream=cookie-secret" });
      response.end(MESSAGES_RESPONSE_SSE);
    });
    const runningRecorder = await startTestRecorder(upstream.url);

    await (await postMessages(runningRecorder, { headers: { "x-api-key": "sk-ant-api03-secret" } })).text();
    await (await postMessages(runningRecorder)).text();
    await runningRecorder.stop();

    for (const fileName of readdirSync(recordingsRoot)) {
      const text = gunzipText(path.join(recordingsRoot, fileName));
      for (const secret of [
        AUTH_TOKEN,
        "sk-ant-api03-secret",
        "cookie-secret",
        "account-fixture-9c1e",
        "device-fixture-7f3a",
      ]) {
        expect(text).not.toContain(secret);
      }
    }
    expect(readRecordings(recordingsRoot)).toHaveLength(2);
  });
});

describe("a failing upstream or disk", () => {
  it("answers 502 with an Anthropic-shaped proxy_error when the upstream is unreachable, and records it", async () => {
    const unreachable = await startFakeUpstream(respondWithEventStream);
    await unreachable.close();
    const runningRecorder = await startTestRecorder(unreachable.url);

    const response = await postMessages(runningRecorder);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ type: "error", error: { type: "proxy_error" } });
    await runningRecorder.stop();

    const [recorded] = readRecordings(recordingsRoot);
    expect(recorded.response.status).toBe(502);
    expect(recorded.proxyError).toEqual(expect.any(String));
    expect(recorded.timings.firstByteAt).toBeNull();
  });

  it("still forwards the response when the Recording cannot be written, and logs the failure", async () => {
    const notADirectory = path.join(tmpDir, "a-file");
    writeFileSync(notADirectory, "");
    upstream = await startFakeUpstream(respondWithEventStream);
    const runningRecorder = await startTestRecorder(upstream.url, notADirectory);

    const firstResponse = await postMessages(runningRecorder);
    expect(await firstResponse.text()).toBe(MESSAGES_RESPONSE_SSE);
    const secondResponse = await postMessages(runningRecorder);
    expect(await secondResponse.text()).toBe(MESSAGES_RESPONSE_SSE);
    await runningRecorder.stop();

    expect(loggedMessages.some((message) => message.includes("could not record"))).toBe(true);
  });

  it("aborts the upstream request when the client disconnects, and records what came back", async () => {
    const upstreamRequestClosed = deferred();
    const [firstEvent] = MESSAGES_RESPONSE_SSE.split(/(?<=\n\n)/);
    upstream = await startFakeUpstream((request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(firstEvent);
      response.on("close", upstreamRequestClosed.resolve);
    });
    const runningRecorder = await startTestRecorder(upstream.url);

    await new Promise<void>((resolve) => {
      const clientRequest = http.request(
        {
          host: "127.0.0.1",
          port: runningRecorder.port,
          method: "POST",
          path: "/v1/messages",
          headers: { "x-claude-code-session-id": SESSION_ID },
        },
        (response) =>
          response.once("data", () => {
            clientRequest.destroy();
            resolve();
          }),
      );
      clientRequest.end(MESSAGES_REQUEST_JSON);
    });
    await upstreamRequestClosed.promise;
    await runningRecorder.stop();

    const [recorded] = readRecordings(recordingsRoot);
    expect(recorded.isClientAborted).toBe(true);
    expect(recorded.response.body).toMatchObject({ id: "msg_fixture01", content: [] });
  });
});

function gunzipText(filePath: string): string {
  return gunzipSync(readFileSync(filePath)).toString("utf8");
}
