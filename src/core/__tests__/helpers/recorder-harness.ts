// A Recorder started per test in front of a fake upstream, with a scratch
// Recordings root, both torn down after the test.

import { mkdtempSync, rmSync } from "node:fs";
import type http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import { startRecorder, type RecorderOptions, type RunningRecorder } from "@/core/recorder";
import {
  deferred,
  MESSAGES_REQUEST_JSON,
  respondWithFirstEventUntil,
  startFakeUpstream,
  type FakeUpstream,
} from "./fake-upstream";

/** The bearer token every test request carries; it must never reach a Recording. */
export const AUTH_TOKEN = "sk-ant-oat01-secret";

/** The per-test state `setUpRecorderHarness` maintains. */
export type RecorderHarness = {
  /** A scratch directory, removed after the test. */
  readonly tmpDir: string;
  /** The default Recordings root, inside `tmpDir`. */
  readonly recordingsRoot: string;
  /** What the Recorder logged. */
  readonly loggedMessages: string[];
  /** Start a fake upstream answering with `respond`. */
  startUpstream(respond: (request: http.IncomingMessage, response: http.ServerResponse) => void): Promise<FakeUpstream>;
  /** Start a Recorder on a free port in front of `upstreamUrl`. */
  startRecorder(upstreamUrl: string, options?: Partial<RecorderOptions>): Promise<RunningRecorder>;
  /**
   * Start a Recorder in front of an upstream that streams the SSE fixture's
   * first event, then holds the rest until `releaseRest()`; send it one API
   * request of session `sess-in-flight` and read up to that first event.
   */
  startHeldStream(): Promise<HeldStream>;
};

/** An API request whose streamed response is held after its first event. */
export type HeldStream = {
  recorder: RunningRecorder;
  /** The response body's reader, past the first event. */
  reader: ReadableStreamDefaultReader<Uint8Array>;
  firstChunk: string;
  releaseRest: () => void;
};

/** Register the hooks that give each test of the file a fresh harness. */
export function setUpRecorderHarness(): RecorderHarness {
  let tmpDir = "";
  let loggedMessages: string[] = [];
  let upstreams: FakeUpstream[] = [];
  let recorders: RunningRecorder[] = [];

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-recorder-"));
    loggedMessages = [];
  });

  afterEach(async () => {
    await Promise.all(recorders.map((recorder) => recorder.stop()));
    await Promise.all(upstreams.map((upstream) => upstream.close()));
    recorders = [];
    upstreams = [];
    rmSync(tmpDir, { recursive: true, force: true });
  });

  return {
    get tmpDir() {
      return tmpDir;
    },
    get recordingsRoot() {
      return path.join(tmpDir, "recordings");
    },
    get loggedMessages() {
      return loggedMessages;
    },
    async startUpstream(respond) {
      const upstream = await startFakeUpstream(respond);
      upstreams.push(upstream);
      return upstream;
    },
    async startRecorder(upstreamUrl, options = {}) {
      const recorder = await startRecorder({
        port: 0,
        upstreamUrl,
        recordingsRoot: path.join(tmpDir, "recordings"),
        log: (message) => loggedMessages.push(message),
        ...options,
      });
      recorders.push(recorder);
      return recorder;
    },
    async startHeldStream() {
      const releaseRest = deferred();
      const upstream = await this.startUpstream(respondWithFirstEventUntil(releaseRest.promise));
      const recorder = await this.startRecorder(upstream.url);
      const response = await postMessages(recorder, { headers: { "x-claude-code-session-id": "sess-in-flight" } });
      const reader = response.body!.getReader();
      const firstChunk = new TextDecoder().decode((await reader.read()).value);
      return { recorder, reader, firstChunk, releaseRest: releaseRest.resolve };
    },
  };
}

/** POST `body` (the fixture by default) to the Recorder's Messages endpoint, as Claude Code does. */
export function postMessages(
  recorder: RunningRecorder,
  { headers = {}, body = MESSAGES_REQUEST_JSON }: { headers?: Record<string, string>; body?: string } = {},
): Promise<Response> {
  return fetch(`http://127.0.0.1:${recorder.port}/v1/messages?beta=true`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${AUTH_TOKEN}`,
      "content-type": "application/json",
      cookie: "session=cookie-secret",
      ...headers,
    },
    body,
  });
}
