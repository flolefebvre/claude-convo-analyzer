import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFamily } from "@/core/family";
import { getConversation, getDailySpend, getTranscript, listConversations } from "@/core/read";
import { refresh } from "@/core/refresh";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");

/**
 * A Turn is one API response, however many log files hold it (ADR-0011): one
 * Agent owns it — the ancestor among its holders, else the one with the
 * smallest log path — and only its owner's Conversation counts it in its Cost.
 */
describe("a Turn's owner", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-turn-owner-"));
    dbPath = path.join(tmpDir, "analyzer.db");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** The total tokens of each Conversation of the list, by session id. */
  async function totalTokensBySessionId(): Promise<Record<string, number>> {
    const rows = await listConversations({ dbPath });
    return Object.fromEntries(rows.map((row) => [row.id, row.tokens.total]));
  }

  describe("in a family of resumed and forked Conversations", () => {
    beforeEach(async () => {
      await refresh({ logsRoot: path.join(FIXTURES_DIR, "family-logs"), dbPath });
    });

    it("is the continued-from parent: each copier counts only its own Turns", async () => {
      expect(await totalTokensBySessionId()).toEqual({
        // fam-a-msg-1 (20) and its Sub-agent's fam-helper-msg-1 (6), held by every sitting after it.
        "sess-fam-a": 26,
        // Its own fam-b-msg-1; its copy of sess-fam-a's Sub-agent transcript counts nothing.
        "sess-fam-b": 40,
        "sess-fam-c": 60,
        "sess-fam-d": 80,
        // Its own Turn and its own <synthetic> one.
        "sess-fam-e": 114,
        "sess-fam-solo": 18,
        "sess-legacy-a": 10,
        "sess-legacy-b": 12,
        // A near-fork no record links: leg-msg-1 goes to the smaller log path, sess-legacy-a's.
        "sess-legacy-fork": 0,
        // Its parent's file is gone: the only holder of gone-msg-1 owns it.
        "sess-orphan": 30,
      });
    });

    it("leaves a copier's breakdowns its own Turns only", async () => {
      const copier = await getConversation("sess-fam-b", { dbPath });
      expect(copier?.perModel).toEqual([
        expect.objectContaining({
          model: "claude-sonnet-4-6",
          tokens: { input: 20, output: 20, cacheWrite: 0, cacheRead: 0, total: 40 },
        }),
      ]);
      expect(copier?.subAgents).toEqual([
        expect.objectContaining({ agentId: "fam-helper", tokens: expect.objectContaining({ total: 0 }), costUsd: 0 }),
      ]);

      const parent = await getConversation("sess-fam-a", { dbPath });
      expect(parent?.subAgents).toEqual([
        expect.objectContaining({ agentId: "fam-helper", tokens: expect.objectContaining({ total: 6 }) }),
      ]);
    });

    it("prices a Turn in its owner's Transcript only, so a page's per-Turn costs sum to its Conversation's Cost", async () => {
      const copier = await getTranscript("sess-fam-b", { dbPath, page: "all" });
      const turnTokensByUuid = Object.fromEntries(
        (copier?.messages ?? []).filter((m) => m.role === "assistant").map((m) => [m.uuid, m.tokens?.total ?? null]),
      );
      // Its copy of fam-a-a1 shows no tokens, as a user row does.
      expect(turnTokensByUuid).toEqual({ "fam-a-a1": null, "fam-b-a1": 40 });

      for (const sessionId of ["sess-fam-a", "sess-fam-b"]) {
        const detail = await getConversation(sessionId, { dbPath });
        const agentIds = [undefined, ...(detail?.subAgents ?? []).map((subAgent) => subAgent.agentId)];
        let pagesCostUsd = 0;
        for (const agentId of agentIds) {
          const view = await getTranscript(sessionId, { dbPath, agentId, page: "all" });
          pagesCostUsd += (view?.messages ?? []).reduce((sum, m) => sum + m.costUsd, 0);
        }
        expect(pagesCostUsd).toBeCloseTo(detail!.costUsd, 12);
        expect(detail!.costUsd).toBeGreaterThan(0);
      }
    });

    it("makes the Overview the sum of own spend and a family's cumulative total count no Turn twice", async () => {
      const rows = await listConversations({ dbPath });
      // Every distinct Turn of the fixture root, once: 26 + 40 + 60 + 80 + 114 + 18 + 10 + 12 + 30.
      expect(rows.reduce((sum, row) => sum + row.tokens.total, 0)).toBe(390);

      const family = buildFamily(rows, "sess-fam-c");
      const familyIds = new Set(family?.members.map((member) => member.id));
      expect(familyIds).toEqual(new Set(["sess-fam-a", "sess-fam-b", "sess-fam-c", "sess-fam-d", "sess-fam-e"]));
      const ownCostSum = rows.filter((row) => familyIds.has(row.id)).reduce((sum, row) => sum + row.costUsd, 0);
      expect(family?.totalCostUsd).toBeCloseTo(ownCostSum, 12);
      // fam-a-msg-1 once, not five times: the family's tokens are its five distinct sittings' own.
      const familyTokens = rows.filter((row) => familyIds.has(row.id)).reduce((sum, row) => sum + row.tokens.total, 0);
      expect(familyTokens).toBe(26 + 40 + 60 + 80 + 114);
    });

    it("makes daily spend the sum of own spend", async () => {
      const spend = await getDailySpend({ dbPath, now: Date.parse("2026-07-01T12:00:00.000Z") });
      const rows = await listConversations({ dbPath });

      expect(spend.totalTokens.total).toBe(390);
      expect(spend.totalCostUsd).toBeCloseTo(
        rows.reduce((sum, row) => sum + row.costUsd, 0),
        12,
      );
    });
  });

  it("is its own file's without a requestId: a mock API's message id in two unrelated files is two Turns", async () => {
    await refresh({ logsRoot: path.join(FIXTURES_DIR, "requestless-turn-logs"), dbPath });

    // Both files hold msg_fake_1, neither with a requestId: each counts its own.
    expect(await totalTokensBySessionId()).toEqual({ "sess-mock-a": 7, "sess-mock-b": 11 });
  });

  describe("among a Sub-agent and its forks", () => {
    beforeEach(async () => {
      await refresh({ logsRoot: path.join(FIXTURES_DIR, "forked-agent-logs"), dbPath });
    });

    it("is the spawning Agent: a fork counts only its own Turns, and its re-written spawn record counts once, in its spawner", async () => {
      const detail = await getConversation("sess-forks", { dbPath });
      const totalBySubAgent = Object.fromEntries(
        (detail?.subAgents ?? []).map((subAgent) => [subAgent.agentId, subAgent.tokens.total]),
      );
      expect(totalBySubAgent).toEqual({
        "fork-lead": 30,
        // fork-a-msg-2, its spawn of fork-b, which fork-b re-writes under a new uuid, counts here.
        "fork-a": 24,
        "fork-b": 6,
      });
      // The Main thread's 40, and each Turn once.
      expect(detail?.tokens.total).toBe(100);
    });
  });
});
