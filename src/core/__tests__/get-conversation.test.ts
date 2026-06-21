import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConversation, refresh } from "@/core/refresh";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

describe("getConversation detail read API", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-detail-"));
    dbPath = path.join(tmpDir, "analyzer.db");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null for an unknown conversation id", async () => {
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath });
    const detail = await getConversation("does-not-exist", { dbPath });
    expect(detail).toBeNull();
  });

  it("extends the summary and breaks tokens down per model and per sub-agent", async () => {
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath });
    const detail = await getConversation("sess-sub", { dbPath });
    expect(detail).not.toBeNull();
    if (!detail) return;

    // Base summary fields are present and match the summarizer.
    expect(detail.id).toBe("sess-sub");
    expect(detail.subAgentCount).toBe(1);
    expect(detail.tokens.total).toBe(225); // no double-count

    // perModel: opus (main) + haiku (sub).
    const opus = detail.perModel.find((p) => p.model === "claude-opus-4-8");
    const haiku = detail.perModel.find(
      (p) => p.model === "claude-haiku-4-5-20251001",
    );
    expect(opus?.tokens.input).toBe(10);
    expect(opus?.tokens.output).toBe(15);
    expect(haiku?.tokens.input).toBe(50);
    expect(haiku?.tokens.output).toBe(130);
    expect(haiku?.tokens.cacheRead).toBe(20);
    expect(opus?.costUsd).toBeGreaterThan(0);
    expect(opus?.unpriced).toBe(false);

    // subAgents: one entry for the spawned Explore agent.
    expect(detail.subAgents).toHaveLength(1);
    const sa = detail.subAgents[0];
    expect(sa?.agentId).toBe("sub1");
    expect(sa?.agentType).toBe("Explore");
    expect(sa?.model).toBe("claude-haiku-4-5-20251001");
    expect(sa?.tokens.output).toBe(130);
    expect(sa?.costUsd).toBeGreaterThan(0);
  });

  it("attributes exact per-skill token cost via the attribution field", async () => {
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath });
    const detail = await getConversation("sess-tools", { dbPath });
    expect(detail).not.toBeNull();
    if (!detail) return;

    // The single assistant turn is attributed to the `commit` skill.
    expect(detail.perSkill).toHaveLength(1);
    const commit = detail.perSkill[0];
    expect(commit?.skill).toBe("commit");
    expect(commit?.tokens.input).toBe(10);
    expect(commit?.tokens.output).toBe(20);
    expect(commit?.costUsd).toBeGreaterThan(0);
  });
});
