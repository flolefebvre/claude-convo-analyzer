// A clean stop of the Recorder: no new connections, in-flight API requests
// finish (up to the drain timeout), and their Recordings are flushed — whether
// `stop()` or a POST to the stop endpoint asked for it.

import { describe, expect, it } from "vitest";
import { RECORDER_HEALTH_PATH, RECORDER_STOP_PATH, type RunningRecorder } from "@/core/recorder";
import { readRecordings } from "@/core/recording";
import {
  MESSAGES_RESPONSE_EVENTS,
  respondWithEventStream,
  respondWithFirstEventUntil,
  textUntilEnd,
} from "./helpers/fake-upstream";
import { postMessages, setUpRecorderHarness } from "./helpers/recorder-harness";

const harness = setUpRecorderHarness();

/** The two ways to ask a Recorder to stop; neither waits for the stop to complete. */
const askToStopBy: Record<string, (recorder: RunningRecorder) => Promise<void>> = {
  "stop()": async (recorder) => void recorder.stop(),
  "a POST to the stop endpoint, answered at once": async (recorder) => {
    const stopResponse = await fetch(`http://127.0.0.1:${recorder.port}${RECORDER_STOP_PATH}`, { method: "POST" });
    expect(stopResponse.status).toBe(202);
  },
};

describe("stopping the Recorder", () => {
  it.each(Object.entries(askToStopBy))(
    "lets an in-flight streamed API request finish, then records it, when asked by %s",
    async (_, askToStop) => {
      const { recorder, reader, releaseRest } = await harness.startHeldStream();

      let isStopped = false;
      await askToStop(recorder);
      void recorder.stopped.then(() => (isStopped = true));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(isStopped).toBe(false);
      releaseRest();

      expect(await textUntilEnd(reader)).toBe(MESSAGES_RESPONSE_EVENTS.slice(1).join(""));
      await recorder.stopped;
      expect(readRecordings(harness.recordingsRoot).map((recorded) => recorded.sessionId)).toEqual(["sess-in-flight"]);
    },
  );

  it("accepts no new connection once stopping", async () => {
    const { recorder, reader, releaseRest } = await harness.startHeldStream();

    const stopped = recorder.stop();
    await expect(fetch(`http://127.0.0.1:${recorder.port}/v1/messages`)).rejects.toThrow();
    releaseRest();
    await textUntilEnd(reader);
    await stopped;
  });

  it("settles `stopped` once stop() has completed", async () => {
    const upstream = await harness.startUpstream(respondWithEventStream);
    const recorder = await harness.startRecorder(upstream.url);

    await recorder.stop();

    await expect(recorder.stopped).resolves.toBeUndefined();
  });

  it("refuses anything but a POST on the stop endpoint, and forwards nothing under /_recorder/", async () => {
    const upstream = await harness.startUpstream(respondWithEventStream);
    const recorder = await harness.startRecorder(upstream.url);

    const getStop = await fetch(`http://127.0.0.1:${recorder.port}${RECORDER_STOP_PATH}`);
    const unknownPath = await fetch(`http://127.0.0.1:${recorder.port}/_recorder/elsewhere`, { method: "POST" });

    expect(getStop.status).toBe(405);
    expect(unknownPath.status).toBe(404);
    expect(upstream.receivedRequests).toEqual([]);
    const health = await fetch(`http://127.0.0.1:${recorder.port}${RECORDER_HEALTH_PATH}`);
    expect(health.status).toBe(200);
  });

  it.each<Record<string, string>>([{ origin: "https://example.com" }, { "sec-fetch-site": "cross-site" }])(
    "refuses a stop request a web page sent (%o), and keeps running",
    async (browserHeaders) => {
      const upstream = await harness.startUpstream(respondWithEventStream);
      const recorder = await harness.startRecorder(upstream.url);

      const stopResponse = await fetch(`http://127.0.0.1:${recorder.port}${RECORDER_STOP_PATH}`, {
        method: "POST",
        headers: browserHeaders,
      });

      expect(stopResponse.status).toBe(403);
      const health = await fetch(`http://127.0.0.1:${recorder.port}${RECORDER_HEALTH_PATH}`);
      expect(health.status).toBe(200);
    },
  );

  it("cuts an API request still in flight after the drain timeout", async () => {
    const upstream = await harness.startUpstream(respondWithFirstEventUntil(new Promise(() => {})));
    const recorder = await harness.startRecorder(upstream.url, { drainTimeoutMs: 100 });
    const response = await postMessages(recorder);

    await recorder.stop();

    await expect(response.text()).rejects.toThrow();
  });
});
