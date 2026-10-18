// A clean stop of the Recorder: no new connections, in-flight API requests
// finish (up to the drain timeout), and their Recordings are flushed.

import { describe, expect, it } from "vitest";
import { readRecordings } from "@/core/recording";
import { MESSAGES_RESPONSE_EVENTS, respondWithFirstEventUntil, textUntilEnd } from "./helpers/fake-upstream";
import { postMessages, setUpRecorderHarness } from "./helpers/recorder-harness";

const harness = setUpRecorderHarness();

describe("stopping the Recorder", () => {
  it("lets an in-flight streamed API request finish, then records it", async () => {
    const { recorder, reader, releaseRest } = await harness.startHeldStream();

    let isStopped = false;
    const stopped = recorder.stop().then(() => (isStopped = true));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(isStopped).toBe(false);
    releaseRest();

    expect(await textUntilEnd(reader)).toBe(MESSAGES_RESPONSE_EVENTS.slice(1).join(""));
    await stopped;
    expect(readRecordings(harness.recordingsRoot).map((recorded) => recorded.sessionId)).toEqual(["sess-in-flight"]);
  });

  it("accepts no new connection once stopping", async () => {
    const { recorder, reader, releaseRest } = await harness.startHeldStream();

    const stopped = recorder.stop();
    await expect(fetch(`http://127.0.0.1:${recorder.port}/v1/messages`)).rejects.toThrow();
    releaseRest();
    await textUntilEnd(reader);
    await stopped;
  });

  it("cuts an API request still in flight after the drain timeout", async () => {
    const upstream = await harness.startUpstream(respondWithFirstEventUntil(new Promise(() => {})));
    const recorder = await harness.startRecorder(upstream.url, { drainTimeoutMs: 100 });
    const response = await postMessages(recorder);

    await recorder.stop();

    await expect(response.text()).rejects.toThrow();
  });
});
