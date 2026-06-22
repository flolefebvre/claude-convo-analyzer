import { describe, expect, it } from "vitest";

import type { ConversationDetail } from "@/core/read";

import { detailSections, subAgentLabel } from "@/app/_lib/detail";

describe("subAgentLabel", () => {
  it("returns the agent type when present", () => {
    expect(subAgentLabel({ agentType: "code-reviewer" })).toBe("code-reviewer");
  });

  it("falls back to 'main' for the root/empty agent type", () => {
    expect(subAgentLabel({ agentType: "" })).toBe("main");
  });

  it("treats whitespace-only agent types as the root", () => {
    expect(subAgentLabel({ agentType: "   " })).toBe("main");
  });
});

const TOKENS = { input: 1, output: 2, cacheWrite: 3, cacheRead: 4, total: 10 };

function detail(partial: Partial<ConversationDetail> = {}): ConversationDetail {
  return {
    id: "s1",
    title: "T",
    project: { folder: "f", path: "/p" },
    startedAt: "",
    endedAt: "",
    models: { dominant: "sonnet", distinctCount: 1 },
    tokens: TOKENS,
    costUsd: 1,
    unpriced: false,
    subAgentCount: 0,
    continuedFromId: null,
    perModel: [],
    subAgents: [],
    perSkill: [],
    ...partial,
  };
}

describe("detailSections", () => {
  it("ranks per-model rows by cost (desc) and totals the cost for share bars", () => {
    const sections = detailSections(
      detail({
        perModel: [
          { model: "haiku", tokens: TOKENS, costUsd: 0.5, unpriced: false },
          { model: "opus", tokens: TOKENS, costUsd: 9.5, unpriced: false },
          { model: "sonnet", tokens: TOKENS, costUsd: 2, unpriced: false },
        ],
      }),
    );
    expect(sections.perModel.isEmpty).toBe(false);
    expect(sections.perModel.rows.map((r) => r.model)).toEqual([
      "opus",
      "sonnet",
      "haiku",
    ]);
    expect(sections.perModel.totalCost).toBeCloseTo(12);
  });

  it("ranks per-skill rows by cost (desc) and totals the cost", () => {
    const sections = detailSections(
      detail({
        perSkill: [
          { skill: "commit", tokens: TOKENS, costUsd: 0.25 },
          { skill: "orchestrate", tokens: TOKENS, costUsd: 7.75 },
        ],
      }),
    );
    expect(sections.perSkill.rows.map((r) => r.skill)).toEqual([
      "orchestrate",
      "commit",
    ]);
    expect(sections.perSkill.totalCost).toBeCloseTo(8);
  });

  it("groups sub-agents by label, summing tokens/cost and counting members", () => {
    const t = (n: number) => ({ ...TOKENS, total: n });
    const sections = detailSections(
      detail({
        subAgents: [
          {
            agentId: "a1",
            agentType: "",
            model: "haiku",
            tokens: t(100),
            costUsd: 1,
          },
          {
            agentId: "a2",
            agentType: "general-purpose",
            model: "opus",
            tokens: t(200),
            costUsd: 3,
          },
          {
            agentId: "a3",
            agentType: "general-purpose",
            model: "opus",
            tokens: t(50),
            costUsd: 5,
          },
        ],
      }),
    );
    expect(sections.subAgents.isEmpty).toBe(false);
    // Groups ranked by summed cost desc: general-purpose ($8) before main ($1).
    expect(sections.subAgents.groups.map((g) => g.label)).toEqual([
      "general-purpose",
      "main",
    ]);
    const gp = sections.subAgents.groups[0];
    expect(gp.count).toBe(2);
    expect(gp.costUsd).toBeCloseTo(8);
    expect(gp.tokens.total).toBe(250);
    // Members within a group are ranked by cost desc.
    expect(gp.agents.map((a) => a.agentId)).toEqual(["a3", "a2"]);
    expect(sections.subAgents.totalCost).toBeCloseTo(9);
  });

  it("flags empty sections (and zero totals) so the renderer can show a note", () => {
    const sections = detailSections(detail());
    expect(sections.perModel.isEmpty).toBe(true);
    expect(sections.perModel.totalCost).toBe(0);
    expect(sections.subAgents.isEmpty).toBe(true);
    expect(sections.subAgents.groups).toEqual([]);
    expect(sections.perSkill.isEmpty).toBe(true);
  });
});
