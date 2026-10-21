// Failed attempts (GLOSSARY.md) known from the conversation logs alone
// (Claude Code 2.1.300+, docs/conversation-log-format.md §9, "Retries"): an
// API request no Turn answered, whose next request of the same Agent sends the
// same body again from it, belongs to the Turn the chain ends in, which shows
// how many there were and the time they lost — never a status, an error, or
// any Cost.

import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { getConversation, getTranscript, type TranscriptMessage } from "@/core/read";
import { refresh } from "@/core/refresh";
import { getLoggedWhatWasSent } from "@/core/what-was-sent";

import { seededTempDb } from "./helpers/temp-db";

const LOGS_ROOT = path.join(import.meta.dirname, "fixtures", "failed-attempt-logs");
const SESSION_ID = "sess-retries";
const SUB_AGENT_ID = "rsub1";

const db = seededTempDb({ prefix: "cca-failed-attempts-from-logs-", logsRoot: LOGS_ROOT });

/** The assistant Turns of one Agent's transcript (`agentId` undefined: the Main thread). */
async function turnsOf(agentId?: string): Promise<TranscriptMessage[]> {
  const view = await getTranscript(SESSION_ID, { dbPath: db.dbPath, agentId });
  return (view?.messages ?? []).filter((message) => message.role === "assistant");
}

describe("a Turn's Failed attempts from the logs", () => {
  it("count each unanswered request its own request resent, along the whole chain", async () => {
    const turns = await turnsOf();

    expect(turns.map((turn) => turn.failedAttemptCount)).toEqual([1, 3, 0, 0]);
  });

  it("lost, in total, the time from the first attempt's sending to the Turn's own request's", async () => {
    const turns = await turnsOf();

    expect(turns.map((turn) => turn.failedAttemptsLostMs)).toEqual([300, 6_000, null, null]);
  });

  it("leave out a request the user interrupted, a request ending the file, and a request whose digest is unknown", async () => {
    const [, , interrupted, unknownDigest] = await turnsOf();

    expect(interrupted?.failedAttemptCount).toBe(0);
    expect(unknownDigest?.failedAttemptCount).toBe(0);
  });

  it("are a Sub-agent's own on its Turns", async () => {
    const [subAgentTurn] = await turnsOf(SUB_AGENT_ID);

    expect(subAgentTurn?.failedAttemptCount).toBe(1);
    expect(subAgentTurn?.failedAttemptsLostMs).toBe(250);
  });

  it("never change Cost", async () => {
    const withoutRequestsRoot = mkdtempSync(path.join(tmpdir(), "cca-failed-attempts-cost-"));
    try {
      // The same logs without their request records: no Failed attempt is known.
      cpSync(LOGS_ROOT, path.join(withoutRequestsRoot, "logs"), { recursive: true });
      for (const entry of readdirSync(path.join(withoutRequestsRoot, "logs"), {
        recursive: true,
        withFileTypes: true,
      })) {
        if (!entry.isFile()) continue;
        const logPath = path.join(entry.parentPath, entry.name);
        const lines = readFileSync(logPath, "utf8").split("\n");
        writeFileSync(logPath, lines.filter((line) => !line.includes('"type":"api-request"')).join("\n"));
      }
      const withoutRequestsDbPath = path.join(withoutRequestsRoot, "analyzer.db");
      await refresh({ logsRoot: path.join(withoutRequestsRoot, "logs"), dbPath: withoutRequestsDbPath });

      const conversation = await getConversation(SESSION_ID, { dbPath: db.dbPath });
      const withoutRequests = await getConversation(SESSION_ID, { dbPath: withoutRequestsDbPath });

      expect((await turnsOf())[1]?.failedAttemptCount).toBe(3);
      expect(conversation?.costUsd).toBeGreaterThan(0);
      expect(conversation?.costUsd).toBe(withoutRequests?.costUsd);
      expect(conversation?.tokens).toEqual(withoutRequests?.tokens);
      expect(conversation?.subAgents).toEqual(withoutRequests?.subAgents);
    } finally {
      rmSync(withoutRequestsRoot, { recursive: true, force: true });
    }
  });
});

describe("What was sent from the logs, for a Turn Failed attempts preceded", () => {
  /** What was sent for the `ordinal`-th (1-based) assistant Turn of an Agent. */
  async function whatWasSentForTurn(ordinal: number, agentId?: string) {
    const loggedApiRequestId = (await turnsOf(agentId))[ordinal - 1]?.loggedApiRequestId;
    if (loggedApiRequestId == null) throw new Error(`Turn ${ordinal} has no logged API request`);
    return getLoggedWhatWasSent(loggedApiRequestId, { dbPath: db.dbPath });
  }

  it("lists them oldest first, each with when it was sent and the time it lost, and no status or error", async () => {
    const sent = await whatWasSentForTurn(2);

    expect(sent?.failedAttempts).toEqual([
      { lostMs: 500, sentAt: "2026-10-21T10:01:01.000Z" },
      { lostMs: 1_500, sentAt: "2026-10-21T10:01:01.500Z" },
      { lostMs: 4_000, sentAt: "2026-10-21T10:01:03.000Z" },
    ]);
  });

  it("lists none for a Turn its first request answered", async () => {
    const sent = await whatWasSentForTurn(3);

    expect(sent?.failedAttempts).toEqual([]);
  });

  it("lists a Sub-agent's own", async () => {
    const sent = await whatWasSentForTurn(1, SUB_AGENT_ID);

    expect(sent?.failedAttempts).toEqual([{ lostMs: 250, sentAt: "2026-10-21T10:00:11.000Z" }]);
  });
});
