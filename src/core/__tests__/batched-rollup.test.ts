import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ConversationDetail, ConversationSummary } from "@/core/read";
import { getConversation, listConversations } from "@/core/read";

import { seededTempDb } from "./helpers/temp-db";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

/** The fixture conversation that mixes models, a sub-agent, and an unpriced turn. */
const SESSION = "sess-mix";

// Pins the Part B1 invariant: the BATCHED list rollup must equal the
// per-conversation detail rollup for a conversation that has BOTH a sub-agent
// on a DIFFERENT model than the main thread AND an unpriced model in scope.
// If batching mis-buckets by model, mishandles nulls (after dropping COALESCE),
// or misattributes the cross-model sub-agent, these assertions diverge.
describe("batched list rollup == per-conversation detail rollup", () => {
  const db = seededTempDb({ prefix: "cca-batched-", logsRoot: FIXTURES_ROOT });

  /** The mixed conversation as the LIST reads it (the batched rollup). */
  async function listSummary(): Promise<ConversationSummary> {
    const summary = (await listConversations({ dbPath: db.dbPath })).find((c) => c.id === SESSION);
    if (!summary) throw new Error(`${SESSION} is missing from the list rollup`);
    return summary;
  }

  /** The same conversation as the DETAIL reads it (the single-id rollup). */
  async function detailOf(): Promise<ConversationDetail> {
    const detail = await getConversation(SESSION, { dbPath: db.dbPath });
    if (!detail) throw new Error(`${SESSION} is missing from the detail rollup`);
    return detail;
  }

  it("the list summary for sess-mix equals the detail's base summary", async () => {
    const summary = await listSummary();
    const detail = await detailOf();

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
      costByType: detail.costByType,
      unpriced: detail.unpriced,
      subAgentCount: detail.subAgentCount,
      errorCount: detail.errorCount,
      continuedFromId: detail.continuedFromId,
    };
    expect(summary).toEqual(base);
  });

  it("rolls up cross-model tokens, the unpriced flag, and sub-agent attribution", async () => {
    const detail = await detailOf();

    // unpriced model (<synthetic>) is in scope → the conversation is unpriced,
    // yet the priced models still contribute real cost.
    expect(detail.unpriced).toBe(true);
    expect(detail.costUsd).toBeGreaterThan(0);

    // Three model groups: opus (main), haiku (sub), <synthetic> (main, unpriced).
    expect(detail.perModel).toHaveLength(3);
    const opus = detail.perModel.find((p) => p.model === "claude-opus-4-8");
    const haiku = detail.perModel.find((p) => p.model === "claude-haiku-4-5-20251001");
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

  it("carries a per-bucket costByType that sums exactly to costUsd across models", async () => {
    const summary = await listSummary();

    // sess-mix spans opus (main), haiku (sub), and <synthetic> (unpriced) — each
    // bucket is accumulated across every model at its OWN per-tier rate.
    const { input, output, cacheWrite, cacheRead } = summary.costByType;
    expect(input + output + cacheWrite + cacheRead).toBeCloseTo(summary.costUsd, 12);
    // Real priced usage → real per-bucket cost (opus input/output drive these).
    expect(input).toBeGreaterThan(0);
    expect(output).toBeGreaterThan(0);

    // The detail path (ConversationDetail extends ConversationSummary) carries it too.
    expect((await detailOf()).costByType).toEqual(summary.costByType);
  });
});
