import { describe, expect, it } from "vitest";

import type { ConversationDetail } from "@/core/refresh";

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
  it("maps per-model rows through as-is, flagging non-empty", () => {
    const sections = detailSections(
      detail({
        perModel: [
          { model: "sonnet", tokens: TOKENS, costUsd: 1.5, unpriced: false },
        ],
      }),
    );
    expect(sections.perModel.isEmpty).toBe(false);
    expect(sections.perModel.rows).toEqual([
      { model: "sonnet", tokens: TOKENS, costUsd: 1.5, unpriced: false },
    ]);
  });

  it("labels sub-agent rows, mapping the empty root type to 'main'", () => {
    const sections = detailSections(
      detail({
        subAgents: [
          {
            agentId: "a1",
            agentType: "",
            model: "haiku",
            tokens: TOKENS,
            costUsd: 0.5,
          },
          {
            agentId: "a2",
            agentType: "explorer",
            model: "sonnet",
            tokens: TOKENS,
            costUsd: 0.7,
          },
        ],
      }),
    );
    expect(sections.subAgents.isEmpty).toBe(false);
    expect(sections.subAgents.rows.map((r) => r.label)).toEqual([
      "main",
      "explorer",
    ]);
  });

  it("flags empty sections so the renderer can show a none-note", () => {
    const sections = detailSections(detail());
    expect(sections.perModel.isEmpty).toBe(true);
    expect(sections.subAgents.isEmpty).toBe(true);
    expect(sections.perSkill.isEmpty).toBe(true);
  });

  it("passes per-skill rows through, flagging non-empty", () => {
    const sections = detailSections(
      detail({
        perSkill: [{ skill: "commit", tokens: TOKENS, costUsd: 0.25 }],
      }),
    );
    expect(sections.perSkill.isEmpty).toBe(false);
    expect(sections.perSkill.rows).toEqual([
      { skill: "commit", tokens: TOKENS, costUsd: 0.25 },
    ]);
  });
});
