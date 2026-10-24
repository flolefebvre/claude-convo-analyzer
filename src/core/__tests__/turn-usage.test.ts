import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { priceTokenSplit } from "@/core/cost";
import { getConversation } from "@/core/read";
import { refresh } from "@/core/refresh";

/**
 * A Sub-agent's Turn is written as several Records whose `output_tokens` grows
 * as the response streams (log-format §3, GOTCHA 1): its stored usage, and so
 * its Cost, is the highest of each bucket across them.
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

    // The Sub-agent's one Turn: three Records, output 12 → 26 → 40.
    const subAgent = detail?.subAgents.find((s) => s.agentId === "grow1");
    expect(subAgent?.tokens).toEqual({ input: 6, output: 40, cacheWrite: 300, cacheRead: 900, total: 1246 });
    const highestUsageCost = priceTokenSplit(
      { input: 6, output: 40, cacheWrite5m: 300, cacheWrite1h: 0, cacheRead: 900 },
      "claude-haiku-4-5-20251001",
    );
    expect(subAgent?.costUsd).toBeCloseTo(highestUsageCost.usd, 12);
    // The Conversation's output adds the Main thread's 10.
    expect(detail?.tokens.output).toBe(50);
  });
});
