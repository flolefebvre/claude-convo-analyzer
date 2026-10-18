// The Recorder forwards every API request unchanged and records it, against a
// fake upstream on 127.0.0.1: no test touches the network. A Recording is read
// after `stop()`, which flushes every append.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readRecordings } from "@/core/recording";
import {
  deferred,
  MESSAGES_REQUEST_JSON,
  MESSAGES_RESPONSE_EVENTS,
  MESSAGES_RESPONSE_SSE,
  respondWithEventStream,
  startFakeUpstream,
  textUntilEnd,
} from "./helpers/fake-upstream";
import { AUTH_TOKEN, postMessages, setUpRecorderHarness } from "./helpers/recorder-harness";

const SESSION_HEADERS = { "x-claude-code-session-id": "sess-recorded" };

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

const harness = setUpRecorderHarness();

/** POST the fixture over raw http (fetch refuses hop-by-hop headers), handing its response to `onResponse`. */
function rawPost(
  port: number,
  headers: http.OutgoingHttpHeaders,
  onResponse: (response: http.IncomingMessage, clientRequest: http.ClientRequest) => void,
): void {
  const clientRequest = http.request(
    { host: "127.0.0.1", port, method: "POST", path: "/v1/messages?beta=true", headers },
    (response) => onResponse(response, clientRequest),
  );
  clientRequest.end(MESSAGES_REQUEST_JSON);
}

describe("forwarding through the Recorder", () => {
  it("sends the same method, path, query, body and auth upstream, without hop-by-hop headers or accept-encoding", async () => {
    const upstream = await harness.startUpstream(respondWithEventStream);
    const recorder = await harness.startRecorder(upstream.url);

    await new Promise<void>((resolve) =>
      rawPost(
        recorder.port,
        {
          authorization: `Bearer ${AUTH_TOKEN}`,
          connection: "keep-alive, x-hop",
          "keep-alive": "timeout=5",
          "x-hop": "1",
          "accept-encoding": "gzip",
        },
        (response) => response.resume().on("end", resolve),
      ),
    );

    const [received] = upstream.receivedRequests;
    expect(received).toMatchObject({ method: "POST", url: "/v1/messages?beta=true", body: MESSAGES_REQUEST_JSON });
    expect(received.headers.authorization).toBe(`Bearer ${AUTH_TOKEN}`);
    expect(received.headers.host).toBe(new URL(upstream.url).host);
    expect(received.headers["accept-encoding"]).toBeUndefined();
    expect(received.headers["keep-alive"]).toBeUndefined();
    expect(received.headers["x-hop"]).toBeUndefined();
  });

  it("forwards under the path of an upstream behind a gateway", async () => {
    const upstream = await harness.startUpstream(respondWithEventStream);
    const recorder = await harness.startRecorder(`${upstream.url}/gateway/anthropic/`);

    await (await postMessages(recorder)).text();

    expect(upstream.receivedRequests[0].url).toBe("/gateway/anthropic/v1/messages?beta=true");
  });

  it("streams a response back chunk by chunk, before the upstream finishes", async () => {
    const { reader, firstChunk, releaseRest } = await harness.startHeldStream();
    expect(firstChunk).toBe(MESSAGES_RESPONSE_EVENTS[0]);

    releaseRest();
    expect(firstChunk + (await textUntilEnd(reader))).toBe(MESSAGES_RESPONSE_SSE);
  });

  it("records the reassembled response, its usage with the cache split, its status, request-id and timings", async () => {
    const upstream = await harness.startUpstream(respondWithEventStream);
    const recorder = await harness.startRecorder(upstream.url);
    const sentAt = Date.now();

    await (await postMessages(recorder, { headers: SESSION_HEADERS })).text();
    await recorder.stop();

    const [recorded] = readRecordings(harness.recordingsRoot);
    expect(recorded).toMatchObject({
      sessionId: "sess-recorded",
      method: "POST",
      path: "/v1/messages",
      query: "beta=true",
    });
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
    const upstream = await harness.startUpstream((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(countTokensResponse));
    });
    const recorder = await harness.startRecorder(upstream.url);

    const response = await postMessages(recorder);
    expect(await response.json()).toEqual(countTokensResponse);
    await recorder.stop();

    expect(readRecordings(harness.recordingsRoot)[0].response).toMatchObject({
      body: countTokensResponse,
      isStreamed: false,
    });
  });

  it("never writes the auth and cookie headers or the metadata.user_id account and device parts to any file", async () => {
    const upstream = await harness.startUpstream((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream", "set-cookie": "upstream=cookie-secret" });
      response.end(MESSAGES_RESPONSE_SSE);
    });
    const recorder = await harness.startRecorder(upstream.url);

    await (await postMessages(recorder, { headers: { "x-api-key": "sk-ant-api03-secret" } })).text();
    await (await postMessages(recorder, { headers: SESSION_HEADERS })).text();
    await recorder.stop();

    const secrets = [AUTH_TOKEN, "sk-ant-api03-secret", "cookie-secret", "account-fixture-9c1e", "device-fixture-7f3a"];
    for (const fileName of readdirSync(harness.recordingsRoot)) {
      const text = gunzipSync(readFileSync(path.join(harness.recordingsRoot, fileName))).toString("utf8");
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
    expect(readRecordings(harness.recordingsRoot)).toHaveLength(2);
  });
});

describe("a failing upstream or disk", () => {
  it("answers 502 with an Anthropic-shaped proxy_error when the upstream is unreachable, and records it", async () => {
    const unreachable = await startFakeUpstream(respondWithEventStream);
    await unreachable.close();
    const recorder = await harness.startRecorder(unreachable.url);

    const response = await postMessages(recorder);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ type: "error", error: { type: "proxy_error" } });
    await recorder.stop();

    const [recorded] = readRecordings(harness.recordingsRoot);
    expect(recorded.response.status).toBe(502);
    expect(recorded.proxyError).toEqual(expect.any(String));
    expect(recorded.timings.firstByteAt).toBeNull();
  });

  it("still forwards the response when the Recording cannot be written, and logs the failure", async () => {
    const notADirectory = path.join(harness.tmpDir, "a-file");
    writeFileSync(notADirectory, "");
    const upstream = await harness.startUpstream(respondWithEventStream);
    const recorder = await harness.startRecorder(upstream.url, { recordingsRoot: notADirectory });

    const firstResponse = await postMessages(recorder);
    expect(await firstResponse.text()).toBe(MESSAGES_RESPONSE_SSE);
    const secondResponse = await postMessages(recorder);
    expect(await secondResponse.text()).toBe(MESSAGES_RESPONSE_SSE);
    await recorder.stop();

    expect(harness.loggedMessages.some((message) => message.includes("could not record"))).toBe(true);
  });

  it("aborts the upstream request when the client disconnects, and records what came back", async () => {
    const upstreamRequestClosed = deferred();
    const upstream = await harness.startUpstream((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(MESSAGES_RESPONSE_EVENTS[0]);
      response.on("close", upstreamRequestClosed.resolve);
    });
    const recorder = await harness.startRecorder(upstream.url);

    await new Promise<void>((resolve) =>
      rawPost(recorder.port, SESSION_HEADERS, (response, clientRequest) =>
        response.once("data", () => {
          clientRequest.destroy();
          resolve();
        }),
      ),
    );
    await upstreamRequestClosed.promise;
    await recorder.stop();

    const [recorded] = readRecordings(harness.recordingsRoot);
    expect(recorded.isClientAborted).toBe(true);
    expect(recorded.response.body).toMatchObject({ id: "msg_fixture01", content: [] });
  });
});
