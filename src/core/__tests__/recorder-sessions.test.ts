// Which session the Recorder files an API request under, and the health
// endpoint that reports the recent sessions.

import { describe, expect, it } from "vitest";
import { RECORDER_HEALTH_PATH, type RecorderHealth, type RunningRecorder } from "@/core/recorder";
import { readRecordings } from "@/core/recording";
import { respondWithEventStream } from "./helpers/fake-upstream";
import { postMessages, setUpRecorderHarness } from "./helpers/recorder-harness";

const harness = setUpRecorderHarness();

/** A request body whose `metadata.user_id`, in its legacy shape, names `sessionId`. */
function bodyOfSession(sessionId: string): string {
  return JSON.stringify({
    model: "claude-haiku-4-5",
    metadata: { user_id: `user_abc_account__session_${sessionId}` },
    messages: [{ role: "user", content: "hi" }],
  });
}

const MINUTE_MS = 60 * 1000;

/** A Recorder whose clock starts at 2026-10-18T10:00Z and moves only when advanced. */
async function startRecorderOnFakeClock(): Promise<{
  recorder: RunningRecorder;
  advanceClockMs: (durationMs: number) => void;
}> {
  let nowMs = Date.parse("2026-10-18T10:00:00.000Z");
  const recorder = await harness.startRecorder((await harness.startUpstream(respondWithEventStream)).url, {
    now: () => nowMs,
  });
  return { recorder, advanceClockMs: (durationMs) => (nowMs += durationMs) };
}

async function sendRequestOfSession(recorder: RunningRecorder, sessionId: string): Promise<void> {
  await (await postMessages(recorder, { body: bodyOfSession(sessionId) })).text();
}

/** A body naming no session, like Claude Code's connectivity check. */
const SESSIONLESS_BODY = JSON.stringify({ model: "claude-haiku-4-5", messages: [] });

/** Send each request in turn, then stop the Recorder and read back the session each was filed under. */
async function sessionIdsRecorded(
  recorder: RunningRecorder,
  requests: { headers?: Record<string, string>; body?: string }[],
): Promise<(string | null)[]> {
  for (const [order, { headers, body }] of requests.entries()) {
    await (await postMessages(recorder, { headers: { ...headers, "x-test-order": String(order) }, body })).text();
  }
  await recorder.stop();
  return readRecordings(harness.recordingsRoot)
    .filter((recorded) => recorded.headers["x-test-order"] !== undefined)
    .sort((a, b) => Number(a.headers["x-test-order"]) - Number(b.headers["x-test-order"]))
    .map((recorded) => recorded.sessionId);
}

describe("the session of an API request", () => {
  it("is the x-claude-code-session-id header, over metadata.user_id", async () => {
    const recorder = await harness.startRecorder((await harness.startUpstream(respondWithEventStream)).url);

    expect(
      await sessionIdsRecorded(recorder, [
        { headers: { "x-claude-code-session-id": "sess-header" }, body: bodyOfSession("sess-user-id") },
      ]),
    ).toEqual(["sess-header"]);
  });

  it("falls back to the session in metadata.user_id", async () => {
    const recorder = await harness.startRecorder((await harness.startUpstream(respondWithEventStream)).url);

    expect(await sessionIdsRecorded(recorder, [{ body: bodyOfSession("sess-user-id") }])).toEqual(["sess-user-id"]);
  });

  it("falls back to the only active session", async () => {
    const recorder = await harness.startRecorder((await harness.startUpstream(respondWithEventStream)).url);

    expect(
      await sessionIdsRecorded(recorder, [{ body: bodyOfSession("sess-only") }, { body: SESSIONLESS_BODY }]),
    ).toEqual(["sess-only", "sess-only"]);
  });

  it("is unattributed when several sessions are active, or none", async () => {
    const recorder = await harness.startRecorder((await harness.startUpstream(respondWithEventStream)).url);

    expect(
      await sessionIdsRecorded(recorder, [
        { body: SESSIONLESS_BODY },
        { body: bodyOfSession("sess-a") },
        { body: bodyOfSession("sess-b") },
        { body: SESSIONLESS_BODY },
      ]),
    ).toEqual([null, "sess-a", "sess-b", null]);
  });

  it("is unattributed once the only session has been quiet for 15 minutes", async () => {
    const { recorder, advanceClockMs } = await startRecorderOnFakeClock();

    await sendRequestOfSession(recorder, "sess-quiet");
    advanceClockMs(15 * MINUTE_MS + 1);
    expect(await sessionIdsRecorded(recorder, [{ body: SESSIONLESS_BODY }])).toEqual([null]);
  });

  it("keeps the x-claude-code-agent-id header of a sub-agent", async () => {
    const recorder = await harness.startRecorder((await harness.startUpstream(respondWithEventStream)).url);

    await (await postMessages(recorder, { headers: { "x-claude-code-agent-id": "agent-sub-1" } })).text();
    await recorder.stop();

    expect(readRecordings(harness.recordingsRoot)[0].agentId).toBe("agent-sub-1");
  });
});

describe("the health endpoint", () => {
  it("reports that the Recorder runs, its port, its Recordings root and the sessions of the last 15 minutes", async () => {
    const { recorder, advanceClockMs } = await startRecorderOnFakeClock();
    await sendRequestOfSession(recorder, "sess-old");
    advanceClockMs(10 * MINUTE_MS);
    await sendRequestOfSession(recorder, "sess-new");
    advanceClockMs(6 * MINUTE_MS);

    const response = await fetch(`http://127.0.0.1:${recorder.port}${RECORDER_HEALTH_PATH}`);
    const health: RecorderHealth = await response.json();

    expect(health).toEqual({
      status: "running",
      port: recorder.port,
      recordingsRoot: harness.recordingsRoot,
      recentSessions: [{ sessionId: "sess-new", lastRequestAt: "2026-10-18T10:10:00.000Z" }],
    });
  });

  it("is answered by the Recorder itself, never forwarded or recorded", async () => {
    const upstream = await harness.startUpstream(respondWithEventStream);
    const recorder = await harness.startRecorder(upstream.url);

    await (await fetch(`http://127.0.0.1:${recorder.port}${RECORDER_HEALTH_PATH}`)).text();
    await recorder.stop();

    expect(upstream.receivedRequests).toEqual([]);
    expect(readRecordings(harness.recordingsRoot)).toEqual([]);
  });
});
