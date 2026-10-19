// The Recorder (ADR-0006): a proxy on 127.0.0.1 between Claude Code and the
// Anthropic API. It forwards every request unchanged, streams the response back
// as it arrives, and appends each API request to a Recording. Under `/_recorder/`
// it answers its own health and stop endpoints instead. It never opens the
// database; `scripts/recorder.ts` runs it in its own process.

import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import {
  openRecordingWriter,
  sessionIdInUserId,
  type RecordedApiRequest,
  type RecordedHeaders,
} from "@/core/recording";

/** The interface the Recorder listens on, and nothing else. */
const LISTEN_HOST = "127.0.0.1";
const DEFAULT_RECORDER_PORT = 4242;
const DEFAULT_RECORDER_UPSTREAM = "https://api.anthropic.com";
/** The Recorder's own health endpoint, outside every upstream path. */
export const RECORDER_HEALTH_PATH = "/_recorder/health";
/** The Recorder's stop endpoint: a POST stops it as `stop()` does. */
export const RECORDER_STOP_PATH = "/_recorder/stop";
/** The prefix of the Recorder's own endpoints; nothing under it is ever forwarded. */
const RECORDER_OWN_PATH_PREFIX = "/_recorder/";
/** How long a session counts as active after its last API request. */
const ACTIVE_SESSION_WINDOW_MS = 15 * 60 * 1000;
/** How long a stop waits for in-flight API requests before cutting them. */
const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;
/** Request headers that describe one connection, not the request; never forwarded. */
const HOP_BY_HOP_HEADER_NAMES = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** How to start a Recorder. */
export type RecorderOptions = {
  /** The port on 127.0.0.1; 0 picks a free one. */
  port: number;
  /** The API the Recorder forwards to, possibly with a base path (a gateway). */
  upstreamUrl: string;
  recordingsRoot: string;
  /** Where failures that never break forwarding are reported; `console.error` by default. */
  log?: (message: string) => void;
  /** How long `stop()` lets in-flight API requests finish; 10 s by default. */
  drainTimeoutMs?: number;
  /** The clock, in epoch ms; `Date.now` by default. */
  now?: () => number;
};

/** A Recorder that is listening. */
export type RunningRecorder = {
  /** The port it listens on, resolved when started with 0. */
  port: number;
  /**
   * Stop accepting connections, let in-flight API requests finish (up to the
   * drain timeout, then cut them), and flush every Recording append.
   */
  stop(): Promise<void>;
  /** Settles once a stop — from `stop()` or the stop endpoint — has completed, as that stop did. */
  stopped: Promise<void>;
};

/** A session that sent an API request recently, as the health endpoint reports it. */
export type RecentSession = { sessionId: string; lastRequestAt: string };

/** What the health endpoint answers. */
export type RecorderHealth = {
  status: "running";
  port: number;
  recordingsRoot: string;
  /** Sessions that sent an API request in the last 15 minutes, most recent first. */
  recentSessions: RecentSession[];
};

/**
 * The port the Recorder listens on: `CCA_RECORDER_PORT` (empty counts as
 * unset), else 4242. Throws on a value that is not a port number.
 *
 * @example
 * const recorder = await startRecorder({ port: defaultRecorderPort(), upstreamUrl, recordingsRoot });
 */
export function defaultRecorderPort(): number {
  const configuredPort = process.env.CCA_RECORDER_PORT;
  if (!configuredPort) return DEFAULT_RECORDER_PORT;
  const port = Number(configuredPort);
  if (!/^\d+$/.test(configuredPort) || port > 65535) {
    throw new Error(`CCA_RECORDER_PORT must be a port number (0-65535), got "${configuredPort}"`);
  }
  return port;
}

/**
 * The API the Recorder forwards to: `CCA_RECORDER_UPSTREAM` (empty counts as
 * unset), else `https://api.anthropic.com`.
 *
 * @example
 * // CCA_RECORDER_UPSTREAM=https://gateway.example/anthropic → that URL
 * const upstreamUrl = defaultRecorderUpstream();
 */
export function defaultRecorderUpstream(): string {
  return process.env.CCA_RECORDER_UPSTREAM || DEFAULT_RECORDER_UPSTREAM;
}

/**
 * Start a Recorder listening on 127.0.0.1 and forwarding to `upstreamUrl`.
 *
 * @example
 * const recorder = await startRecorder({ port: 4242, upstreamUrl: defaultRecorderUpstream(), recordingsRoot: defaultRecordingsRoot() });
 * await recorder.stop();
 */
export async function startRecorder(options: RecorderOptions): Promise<RunningRecorder> {
  const upstream = new URL(options.upstreamUrl);
  const upstreamBasePath = upstream.pathname.replace(/\/+$/, "");
  const log = options.log ?? ((message: string) => console.error(message));
  const now = options.now ?? Date.now;
  const writer = openRecordingWriter(options.recordingsRoot);
  const lastRequestAtBySessionId = new Map<string, number>();
  const inFlightApiRequests = new Set<Promise<void>>();
  let port = options.port;

  function recentSessions(): RecentSession[] {
    const since = now() - ACTIVE_SESSION_WINDOW_MS;
    return [...lastRequestAtBySessionId]
      .filter(([, lastRequestAt]) => lastRequestAt >= since)
      .sort(([, a], [, b]) => b - a)
      .map(([sessionId, lastRequestAt]) => ({ sessionId, lastRequestAt: new Date(lastRequestAt).toISOString() }));
  }

  /** The session of an API request: its header, its `metadata.user_id`, else the only active session. */
  function sessionIdOf(headers: http.IncomingHttpHeaders, body: unknown): string | null {
    const attributedSessionId = singleHeader(headers["x-claude-code-session-id"]) ?? sessionIdInBody(body);
    if (attributedSessionId) {
      lastRequestAtBySessionId.set(attributedSessionId, now());
      return attributedSessionId;
    }
    const activeSessions = recentSessions();
    return activeSessions.length === 1 ? activeSessions[0].sessionId : null;
  }

  async function forwardAndRecord(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const arrivedAt = now();
    const requestBody = await readBody(request);
    if (requestBody === null) return; // the client went away before sending its body
    const parsedRequestBody = parsedBody(requestBody);
    const url = new URL(request.url ?? "/", "http://recorder");
    const apiRequest: Omit<RecordedApiRequest, "response" | "timings"> = {
      sessionId: sessionIdOf(request.headers, parsedRequestBody),
      agentId: singleHeader(request.headers["x-claude-code-agent-id"]),
      method: request.method ?? "GET",
      path: url.pathname,
      query: url.search.replace(/^\?/, ""),
      headers: headersOf(request.headers),
      body: parsedRequestBody,
    };
    const outcome = await forward(request, response, requestBody, upstreamBasePath + (request.url ?? "/"));
    writer
      .append({
        ...apiRequest,
        ...outcome.flags,
        response: outcome.response,
        timings: {
          arrivedAt: new Date(arrivedAt).toISOString(),
          firstByteAt: outcome.firstByteAt === null ? null : new Date(outcome.firstByteAt).toISOString(),
          endedAt: new Date(now()).toISOString(),
        },
      })
      .catch((error: unknown) =>
        log(`Recorder: could not record ${apiRequest.method} ${apiRequest.path}: ${errorMessage(error)}`),
      );
  }

  /** Forward one request upstream and stream its response back; resolves with what to record once it ends. */
  function forward(
    request: http.IncomingMessage,
    response: http.ServerResponse,
    requestBody: Buffer,
    upstreamPath: string,
  ): Promise<ForwardOutcome> {
    return new Promise((resolve) => {
      const responseChunks: Buffer[] = [];
      let upstreamResponse: http.IncomingMessage | null = null;
      let firstByteAt: number | null = null;
      let isSettled = false;
      const settle = (flags: ForwardOutcome["flags"] = {}) => {
        if (isSettled) return;
        isSettled = true;
        resolve({ firstByteAt, flags, response: recordedResponse(upstreamResponse, Buffer.concat(responseChunks)) });
      };

      const transport = upstream.protocol === "https:" ? https : http;
      const upstreamRequest = transport.request({
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port,
        method: request.method,
        path: upstreamPath,
        headers: forwardedRequestHeaders(request.headers, upstream.host, requestBody.length),
      });

      upstreamRequest.on("response", (incoming) => {
        upstreamResponse = incoming;
        firstByteAt = now();
        response.writeHead(incoming.statusCode ?? 502, forwardedResponseHeaders(incoming.headers));
        incoming.on("data", (chunk: Buffer) => {
          responseChunks.push(chunk);
          if (!response.write(chunk)) {
            incoming.pause();
            response.once("drain", () => incoming.resume());
          }
        });
        incoming.on("end", () => {
          response.end();
          settle();
        });
        incoming.on("error", (error) => breakMidResponse(error.message));
        incoming.on("close", () => {
          if (!incoming.complete) breakMidResponse("the upstream connection closed mid-response");
        });
      });

      /** Cut the client's response short, and record it flagged as broken. */
      const breakMidResponse = (message: string) => {
        if (isSettled) return;
        response.destroy();
        settle({ proxyError: message });
      };

      upstreamRequest.on("error", (error) => {
        if (isSettled) return;
        if (upstreamResponse || response.headersSent) {
          breakMidResponse(error.message);
          return;
        }
        const proxyErrorBody = {
          type: "error",
          error: { type: "proxy_error", message: `The Recorder could not reach ${upstream.origin}: ${error.message}` },
        };
        if (!response.destroyed) {
          response.writeHead(502, { "content-type": "application/json" });
          response.end(JSON.stringify(proxyErrorBody));
        }
        isSettled = true;
        resolve({
          firstByteAt: null,
          flags: { proxyError: error.message },
          response: { status: 502, requestId: null, headers: {}, body: proxyErrorBody, isStreamed: false },
        });
      });

      response.on("close", () => {
        if (response.writableFinished) return;
        upstreamRequest.destroy();
        settle({ isClientAborted: true });
      });

      upstreamRequest.end(requestBody);
    });
  }

  /** Answer a request to one of the Recorder's own endpoints. */
  function answerOwnEndpoint(request: http.IncomingMessage, response: http.ServerResponse): void {
    const pathname = new URL(request.url ?? "/", "http://recorder").pathname;
    const method = pathname === RECORDER_HEALTH_PATH ? "GET" : pathname === RECORDER_STOP_PATH ? "POST" : null;
    if (method === null) {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== method) {
      response.writeHead(405, { allow: method }).end();
      return;
    }
    if (pathname === RECORDER_STOP_PATH) {
      response.writeHead(202, { connection: "close" }).end();
      void stop().catch(() => {}); // its outcome is `stopped`'s
      return;
    }
    const health: RecorderHealth = {
      status: "running",
      port,
      recordingsRoot: options.recordingsRoot,
      recentSessions: recentSessions(),
    };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(health));
  }

  const server = http.createServer((request, response) => {
    if (request.url?.startsWith(RECORDER_OWN_PATH_PREFIX)) {
      answerOwnEndpoint(request, response);
      return;
    }
    const inFlight = forwardAndRecord(request, response).catch((error: unknown) => {
      log(`Recorder: failed to forward ${request.method} ${request.url}: ${errorMessage(error)}`);
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
    inFlightApiRequests.add(inFlight);
    void inFlight.finally(() => inFlightApiRequests.delete(inFlight));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, LISTEN_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  port = (server.address() as AddressInfo).port;

  let stopping: Promise<void> | null = null;
  let settleStopped!: { resolve: () => void; reject: (error: unknown) => void };
  const stopped = new Promise<void>((resolve, reject) => (settleStopped = { resolve, reject }));
  stopped.catch(() => {}); // a caller that never awaits `stopped` still hears of a failure through `stop()`

  function stop(): Promise<void> {
    if (!stopping) {
      stopping = (async () => {
        const closed = new Promise<void>((resolve) => server.close(() => resolve()));
        server.closeIdleConnections();
        let drainTimer: NodeJS.Timeout | undefined;
        await Promise.race([
          Promise.all(inFlightApiRequests),
          new Promise<void>(
            (resolve) => (drainTimer = setTimeout(resolve, options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS)),
          ),
        ]);
        clearTimeout(drainTimer);
        server.closeAllConnections();
        await closed;
        await Promise.all(inFlightApiRequests);
        await writer.flush();
      })();
      stopping.then(settleStopped.resolve, settleStopped.reject);
    }
    return stopping;
  }

  return { port, stop, stopped };
}

/** What one forwarded request leaves to record. */
type ForwardOutcome = {
  firstByteAt: number | null;
  flags: Pick<RecordedApiRequest, "proxyError" | "isClientAborted">;
  response: RecordedApiRequest["response"];
};

/** The response as recorded: an event stream reassembled, anything else parsed. */
function recordedResponse(incoming: http.IncomingMessage | null, body: Buffer): RecordedApiRequest["response"] {
  const headers = incoming ? headersOf(incoming.headers) : {};
  const isStreamed = String(incoming?.headers["content-type"] ?? "").startsWith("text/event-stream");
  return {
    status: incoming?.statusCode ?? 0,
    requestId: singleHeader(incoming?.headers["request-id"]),
    headers,
    body: isStreamed ? reassembledMessage(body.toString("utf8")) : parsedBody(body),
    isStreamed,
  };
}

/**
 * The message an SSE stream of the Messages API spells out, in the shape of a
 * non-streamed response: deltas concatenated into their block, tool input
 * parsed at `content_block_stop`, `message_delta` merged in (usage deep-merged,
 * so the cache-creation split survives). An `error` event is kept as `error`.
 */
function reassembledMessage(eventStreamText: string): unknown {
  let message: Record<string, unknown> | null = null;
  const contentBlocks: Record<string, unknown>[] = [];
  const partialJsonByIndex = new Map<number, string>();
  for (const event of eventsIn(eventStreamText)) {
    switch (event.type) {
      case "message_start":
        message = { ...(event.message as Record<string, unknown>), content: contentBlocks };
        break;
      case "content_block_start":
        contentBlocks[event.index as number] = { ...(event.content_block as Record<string, unknown>) };
        break;
      case "content_block_delta":
        applyDelta(contentBlocks[event.index as number], event.delta as Record<string, unknown>, (partialJson) =>
          partialJsonByIndex.set(
            event.index as number,
            (partialJsonByIndex.get(event.index as number) ?? "") + partialJson,
          ),
        );
        break;
      case "content_block_stop": {
        const partialJson = partialJsonByIndex.get(event.index as number);
        const block = contentBlocks[event.index as number];
        if (partialJson !== undefined && block) block.input = parsedJsonOrText(partialJson || "{}");
        break;
      }
      case "message_delta":
        message ??= { content: contentBlocks };
        Object.assign(message, event.delta);
        message.usage = deepMerged(message.usage, event.usage);
        break;
      case "error":
        message ??= { type: "error" };
        message.error = event.error;
        break;
    }
  }
  return message;
}

function applyDelta(
  block: Record<string, unknown> | undefined,
  delta: Record<string, unknown>,
  appendPartialJson: (partialJson: string) => void,
): void {
  if (!block) return;
  const append = (field: string, text: unknown) => (block[field] = String(block[field] ?? "") + String(text ?? ""));
  switch (delta.type) {
    case "text_delta":
      append("text", delta.text);
      break;
    case "thinking_delta":
      append("thinking", delta.thinking);
      break;
    case "signature_delta":
      append("signature", delta.signature);
      break;
    case "input_json_delta":
      appendPartialJson(String(delta.partial_json ?? ""));
      break;
    case "citations_delta":
      block.citations = [...((block.citations as unknown[] | undefined) ?? []), delta.citation];
      break;
  }
}

/** The JSON `data` of each event of an SSE stream; events whose data is not JSON are skipped. */
function eventsIn(eventStreamText: string): Record<string, unknown>[] {
  return eventStreamText.split(/\r?\n\r?\n/).flatMap((eventText) => {
    const data = eventText
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).replace(/^ /, ""))
      .join("\n");
    const event = parsedJsonOrText(data);
    return typeof event === "object" && event !== null && !Array.isArray(event)
      ? [event as Record<string, unknown>]
      : [];
  });
}

/** `base` with `patch`'s fields merged in, nested objects merged rather than replaced, and a null never erasing a value. */
function deepMerged(base: unknown, patch: unknown): unknown {
  if (!isPlainObject(patch)) return patch ?? base;
  const merged: Record<string, unknown> = isPlainObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null && merged[key] !== undefined) continue;
    merged[key] = isPlainObject(value) ? deepMerged(merged[key], value) : value;
  }
  return merged;
}

/** The headers sent upstream: hop-by-hop and `accept-encoding` dropped, `host` and the length rewritten. */
function forwardedRequestHeaders(
  headers: http.IncomingHttpHeaders,
  upstreamHost: string,
  bodyLength: number,
): http.OutgoingHttpHeaders {
  const connectionTokens = String(headers.connection ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase());
  const forwarded: http.OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADER_NAMES.has(name) || connectionTokens.includes(name)) continue;
    if (name === "accept-encoding" || name === "host" || name === "content-length") continue;
    forwarded[name] = value;
  }
  forwarded.host = upstreamHost;
  if (bodyLength > 0 || headers["content-length"] !== undefined) forwarded["content-length"] = bodyLength;
  return forwarded;
}

/** The upstream response's headers, minus those that describe its connection. */
function forwardedResponseHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !HOP_BY_HOP_HEADER_NAMES.has(name)));
}

function headersOf(headers: http.IncomingHttpHeaders): RecordedHeaders {
  return Object.fromEntries(
    Object.entries(headers).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined),
  );
}

function singleHeader(value: string | string[] | undefined): string | null {
  return (Array.isArray(value) ? value[0] : value) || null;
}

function sessionIdInBody(body: unknown): string | null {
  if (!isPlainObject(body) || !isPlainObject(body.metadata) || typeof body.metadata.user_id !== "string") return null;
  return sessionIdInUserId(body.metadata.user_id);
}

/** A body as recorded: parsed JSON, else its text, or null when empty. */
function parsedBody(body: Buffer): unknown {
  return body.length === 0 ? null : parsedJsonOrText(body.toString("utf8"));
}

function parsedJsonOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** The whole body of `request`, or null if the client disconnected first. */
function readBody(request: http.IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", () => resolve(null));
    request.on("close", () => {
      if (!request.complete) resolve(null);
    });
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
