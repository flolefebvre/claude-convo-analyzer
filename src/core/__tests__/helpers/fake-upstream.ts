// A stand-in for the Anthropic API on 127.0.0.1, so the Recorder's tests never
// touch the network. Each test answers with its own handler.

import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

/** The SSE fixture: a streamed response with thinking, text and a tool_use block. */
export const MESSAGES_RESPONSE_SSE = readFileSync(
  path.join(import.meta.dirname, "..", "fixtures", "recording", "messages-response.sse"),
  "utf8",
);

/** The SSE fixture's events, each with its blank line. */
export const MESSAGES_RESPONSE_EVENTS = MESSAGES_RESPONSE_SSE.split(/(?<=\n\n)/);

/** The text a response body reader yields from here to its end. */
export async function textUntilEnd(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  let text = "";
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    text += new TextDecoder().decode(chunk.value);
  }
  return text;
}

/** The request-body fixture, as text, carrying `metadata.user_id` in its JSON shape. */
export const MESSAGES_REQUEST_JSON = readFileSync(
  path.join(import.meta.dirname, "..", "fixtures", "recording", "messages-request.json"),
  "utf8",
);

/** One request the fake upstream received. */
export type ReceivedRequest = { method: string; url: string; headers: http.IncomingHttpHeaders; body: string };

/** A running fake upstream. */
export type FakeUpstream = {
  url: string;
  receivedRequests: ReceivedRequest[];
  close(): Promise<void>;
};

/** Start a fake upstream answering every request with `respond`, once its body is read. */
export async function startFakeUpstream(
  respond: (request: http.IncomingMessage, response: http.ServerResponse) => void,
): Promise<FakeUpstream> {
  const receivedRequests: ReceivedRequest[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      receivedRequests.push({
        method: request.method!,
        url: request.url!,
        headers: request.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      respond(request, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    receivedRequests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A handler answering with the SSE fixture in one write. */
export function respondWithEventStream(_request: http.IncomingMessage, response: http.ServerResponse): void {
  response.writeHead(200, { "content-type": "text/event-stream", "request-id": "req_fixture01" });
  response.end(MESSAGES_RESPONSE_SSE);
}

/** A handler streaming the SSE fixture's first event at once, and the rest only once `releaseRest` resolves. */
export function respondWithFirstEventUntil(
  releaseRest: Promise<void>,
): (request: http.IncomingMessage, response: http.ServerResponse) => void {
  return (_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(MESSAGES_RESPONSE_EVENTS[0]);
    void releaseRest.then(() => response.end(MESSAGES_RESPONSE_EVENTS.slice(1).join("")));
  };
}

/** A promise with its resolve function exposed, for a test to release a waiting handler. */
export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => (resolve = resolvePromise));
  return { promise, resolve };
}
