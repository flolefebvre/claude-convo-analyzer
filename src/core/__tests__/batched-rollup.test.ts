import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConversation, listConversations, refresh } from "@/core/refresh";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

// Pins the Part B1 invariant: the BATCHED list rollup must equal the
// per-conversation detail rollup for a conversation that has BOTH a sub-agent
// on a DIFFERENT model than the main thread AND an unpriced model in scope.
// If batching mis-buckets by model, mishandles nulls (after dropping COALESCE),
// or misattributes the cross-model sub-agent, these assertions diverge.
describe("batched list rollup == per-conversation detail rollup", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-batched-"));
    dbPath = path.join(tmpDir, "analyzer.db");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("the list summary for sess-mix equals the detail's base summary", async () => {
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath });

    const list = await listConversations({ dbPath });
    const summary = list.find((c) => c.id === "sess-mix");
    expect(summary).toBeDefined();
    if (!summary) return;

    const detail = await getConversation("sess-mix", { dbPath });
    expect(detail).not.toBeNull();
    if (!detail) return;

    // The detail's base fields must be byte-identical to the list summary —
    // both come from the same rollup, batched vs single-id.
    const base = {
      id: detail.id,
      title: detail.title,
      project: detail.project,
      startedAt: detail.startedAt,
      endedAt: detail.endedAt,
      models: detail.models,
      tokens: detail.tokens,
      costUsd: detail.costUsd,
      unpriced: detail.unpriced,
      subAgentCount: detail.subAgentCount,
      continuedFromId: detail.continuedFromId,
    };
    expect(summary).toEqual(base);
  });

  it("rolls up cross-model tokens, the unpriced flag, and sub-agent attribution", async () => {
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath });

    const detail = await getConversation("sess-mix", { dbPath });
    expect(detail).not.toBeNull();
    if (!detail) return;

    // unpriced model (<synthetic>) is in scope → the conversation is unpriced,
    // yet the priced models still contribute real cost.
    expect(detail.unpriced).toBe(true);
    expect(detail.costUsd).toBeGreaterThan(0);

    // Three model groups: opus (main), haiku (sub), <synthetic> (main, unpriced).
    expect(detail.perModel).toHaveLength(3);
    const opus = detail.perModel.find((p) => p.model === "claude-opus-4-8");
    const haiku = detail.perModel.find(
      (p) => p.model === "claude-haiku-4-5-20251001",
    );
    const synth = detail.perModel.find((p) => p.model === "<synthetic>");
    expect(opus?.tokens.input).toBe(12);
    expect(opus?.tokens.output).toBe(18);
    expect(opus?.unpriced).toBe(false);
    // haiku tokens come ONLY from the sub-agent (cross-model attribution).
    expect(haiku?.tokens.input).toBe(50);
    expect(haiku?.tokens.output).toBe(130);
    expect(haiku?.tokens.cacheRead).toBe(20);
    expect(synth?.tokens.output).toBe(9);
    expect(synth?.unpriced).toBe(true);
    expect(synth?.costUsd).toBe(0);

    // Total = main(opus 12+18) + main(synth 7+9) + sub(haiku 50+130+20).
    expect(detail.tokens.total).toBe(12 + 18 + 7 + 9 + 50 + 130 + 20);

    // The sub-agent entry is the haiku Explore agent — counted once.
    expect(detail.subAgents).toHaveLength(1);
    const sa = detail.subAgents[0];
    expect(sa?.model).toBe("claude-haiku-4-5-20251001");
    expect(sa?.agentType).toBe("Explore");
    expect(sa?.tokens.output).toBe(130);
    expect(sa?.costUsd).toBeGreaterThan(0);
  });
});
