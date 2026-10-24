import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { priceTokenSplit } from "@/core/cost";
import { getConversation } from "@/core/read";
import { refresh } from "@/core/refresh";

const HAIKU = "claude-haiku-4-5-20251001";

/**
 * A Sub-agent's Turn is written as several Records whose `output_tokens` grows
 * as the response streams (log-format §3, GOTCHA 1), and a file can keep a
 * partial count where a copy of it in another file holds the final one: a
 * Turn's usage, and so its Cost, is the highest of each bucket across every
 * Record of every file holding it (ADR-0011).
 */
describe("a Turn's usage", () => {
  const LOGS_ROOT = path.join(import.meta.dirname, "fixtures", "growing-turn-usage-logs");
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-turn-usage-"));
    dbPath = path.join(tmpDir, "analyzer.db");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("is the highest of its Records, and its Cost prices that", async () => {
    await refresh({ logsRoot: LOGS_ROOT, dbPath });
    const detail = await getConversation("sess-growing", { dbPath });

    // gsmsg-1: three Records of grow1's, output 12 → 26 → 40, copied whole into its fork grow2.
    // gsmsg-2: grow1's spawn of grow2, whose own file keeps output 8, its fork's copy 30.
    const spawner = detail?.subAgents.find((s) => s.agentId === "grow1");
    expect(spawner?.tokens).toEqual({ input: 8, output: 70, cacheWrite: 300, cacheRead: 2100, total: 2478 });
    const highestUsageCost =
      priceTokenSplit({ input: 6, output: 40, cacheWrite5m: 300, cacheWrite1h: 0, cacheRead: 900 }, HAIKU).usd +
      priceTokenSplit({ input: 2, output: 30, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 1200 }, HAIKU).usd;
    expect(spawner?.costUsd).toBeCloseTo(highestUsageCost, 12);
  });

  it("counts a Turn its spawner's file holds partially at the final count its fork's copy holds, in the spawner only", async () => {
    await refresh({ logsRoot: LOGS_ROOT, dbPath });
    const detail = await getConversation("sess-growing", { dbPath });

    // The fork's own Turn only: its copies of gsmsg-1 and gsmsg-2 are its spawner's.
    const fork = detail?.subAgents.find((s) => s.agentId === "grow2");
    expect(fork?.tokens).toEqual({ input: 1, output: 5, cacheWrite: 0, cacheRead: 1300, total: 1306 });
    // The Main thread's 10, grow1's 40 + 30, grow2's 5: each Turn once, at its highest.
    expect(detail?.tokens.output).toBe(85);
  });
});
