// What was sent (GLOSSARY.md) for a Turn whose API request is logged in
// another Conversation's file (docs/conversation-log-format.md §9, "a request
// can live in another session's file"): a resumed or forked session's copied
// history names the requests of the session it came from.

import path from "node:path";
import { describe, expect, it } from "vitest";

import { getTranscript, type TranscriptMessage } from "@/core/read";
import { getRawApiRequest, getWhatWasSent } from "@/core/what-was-sent";

import { seededTempDb } from "./helpers/temp-db";

const LOGS_ROOT = path.join(import.meta.dirname, "fixtures", "resumed-request-logs");
/** Two Turns, the second one's API request preceded by a Failed attempt. */
const PARENT_SESSION_ID = "sess-resumed-parent";
/** A fork holding a copy of the parent's first API request record, and its Turn. */
const COPY_SESSION_ID = "sess-resumed-copy";
/** The parent's two Turns copied, a Turn whose API request no file holds, then a Turn of its own. */
const CHILD_SESSION_ID = "sess-resumed-child";

const db = seededTempDb({ prefix: "cca-what-was-sent-across-files-", logsRoot: LOGS_ROOT });

/** The assistant Turns of a Conversation's Main thread. */
async function turnsOf(sessionId: string): Promise<TranscriptMessage[]> {
  const view = await getTranscript(sessionId, { dbPath: db.dbPath });
  return (view?.messages ?? []).filter((message) => message.role === "assistant");
}

describe("a Turn copied into a resumed Conversation", () => {
  it("has the API request of the parent's file as its What was sent", async () => {
    const [, parentSecondTurn] = await turnsOf(PARENT_SESSION_ID);
    const [, childSecondTurn] = await turnsOf(CHILD_SESSION_ID);

    expect(childSecondTurn?.apiRequestId).toEqual(expect.any(Number));
    expect(childSecondTurn?.apiRequestId).toBe(parentSecondTurn?.apiRequestId);
    const whatWasSent = await getWhatWasSent(childSecondTurn!.apiRequestId!, { dbPath: db.dbPath });
    expect(whatWasSent?.fullRequest.messages.map((message) => message?.role)).toEqual(["user", "assistant", "user"]);
    expect(whatWasSent?.missingMessageCount).toBe(0);
  });

  it("has the Failed attempts of its API request, as the parent's Turn does", async () => {
    const [, parentSecondTurn] = await turnsOf(PARENT_SESSION_ID);
    const [, childSecondTurn] = await turnsOf(CHILD_SESSION_ID);

    expect(parentSecondTurn?.failedAttemptCount).toBe(1);
    expect(childSecondTurn?.failedAttemptCount).toBe(1);
    expect(childSecondTurn?.failedAttemptsLostMs).toBe(parentSecondTurn?.failedAttemptsLostMs);
    const whatWasSent = await getWhatWasSent(childSecondTurn!.apiRequestId!, { dbPath: db.dbPath });
    expect(whatWasSent?.failedAttempts).toHaveLength(1);
  });

  it("has no What was sent, and no error, when no file holds its API request", async () => {
    const childTurns = await turnsOf(CHILD_SESSION_ID);

    expect(childTurns.map((turn) => turn.apiRequestId !== null)).toEqual([true, true, false, true]);
    expect(childTurns[2]?.failedAttemptCount).toBe(0);
  });

  it("reads an API request two files hold from the file of the smallest path", async () => {
    const [copyFirstTurn] = await turnsOf(COPY_SESSION_ID);
    const [parentFirstTurn] = await turnsOf(PARENT_SESSION_ID);
    const [childFirstTurn] = await turnsOf(CHILD_SESSION_ID);

    // `sess-resumed-copy.jsonl` sorts before `sess-resumed-parent.jsonl`.
    expect(childFirstTurn?.apiRequestId).toBe(copyFirstTurn?.apiRequestId);
    expect(childFirstTurn?.apiRequestId).not.toBe(parentFirstTurn?.apiRequestId);
  });
});

describe("an API request two files hold", () => {
  it("is the same request in both: its own file's Turn reads it there", async () => {
    const [copyFirstTurn] = await turnsOf(COPY_SESSION_ID);
    const [parentFirstTurn] = await turnsOf(PARENT_SESSION_ID);

    const copyRequest = await getRawApiRequest(copyFirstTurn!.apiRequestId!, { dbPath: db.dbPath });
    const parentRequest = await getRawApiRequest(parentFirstTurn!.apiRequestId!, { dbPath: db.dbPath });
    expect(copyRequest).not.toBeNull();
    expect(copyRequest).toEqual(parentRequest);
  });
});

describe("a resumed Conversation's own Turn", () => {
  it("has the API request of its own file, against the request of the latest earlier Turn that has one", async () => {
    const [, parentSecondTurn] = await turnsOf(PARENT_SESSION_ID);
    const childTurns = await turnsOf(CHILD_SESSION_ID);

    const whatWasSent = await getWhatWasSent(childTurns[3]!.apiRequestId!, { dbPath: db.dbPath });
    expect(whatWasSent?.fullRequest.messages).toHaveLength(5);
    // The third Turn's request is in no file: the second Turn's, in the parent's file, is the baseline.
    expect(whatWasSent?.previousApiRequestId).toBe(parentSecondTurn?.apiRequestId);
  });

  it("shows as new only the messages after the copied history, with an unchanged system prompt and tools", async () => {
    const childTurns = await turnsOf(CHILD_SESSION_ID);

    const whatWasSent = await getWhatWasSent(childTurns[3]!.apiRequestId!, { dbPath: db.dbPath });
    expect(whatWasSent?.firstNewMessageIndex).toBe(3);
    expect(whatWasSent?.systemPromptDiff).toBeNull();
    expect(whatWasSent?.toolsDiff).toBeNull();
  });
});
