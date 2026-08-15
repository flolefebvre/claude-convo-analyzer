import type { CostByType, Tokens } from "@/core/cost";
import type { ConversationDetail } from "@/core/read";

export function subAgentLabel(sub: { agentType: string }): string {
  const type = sub.agentType.trim();
  return type === "" ? "main" : type;
}

export type LabeledSubAgent = ConversationDetail["subAgents"][number] & {
  label: string;
};

export type RankedSection<Row> = {
  rows: Row[];
  isEmpty: boolean;
  totalCost: number;
};

export type SubAgentGroup = {
  label: string;
  count: number;
  tokens: Tokens;
  costUsd: number;
  agents: LabeledSubAgent[];
};

export type SubAgentSection = {
  groups: SubAgentGroup[];
  isEmpty: boolean;
  totalCost: number;
};

export type CompositionBucket = {
  key: keyof CostByType;
  label: string;
  costUsd: number;
  tokens: number;
  percent: number;
};

const BUCKETS: { key: keyof CostByType; label: string; token: keyof Tokens }[] = [
  { key: "input", label: "Input", token: "input" },
  { key: "output", label: "Output", token: "output" },
  { key: "cacheWrite", label: "Cache-write", token: "cacheWrite" },
  { key: "cacheRead", label: "Cache-read", token: "cacheRead" },
];

export function tokenComposition(tokens: Tokens, costByType: CostByType): CompositionBucket[] {
  const total = tokens.total || 1;
  return BUCKETS.map(({ key, label, token }) => ({
    key,
    label,
    costUsd: costByType[key],
    tokens: tokens[token],
    percent: Math.round((tokens[token] / total) * 100),
  }));
}

const byCostDesc = (a: { costUsd: number }, b: { costUsd: number }): number => b.costUsd - a.costUsd;

function zeroTokens(): Tokens {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 };
}

function addTokens(a: Tokens, b: Tokens): Tokens {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheRead: a.cacheRead + b.cacheRead,
    total: a.total + b.total,
  };
}

function rank<Row extends { costUsd: number }>(rows: Row[]): RankedSection<Row> {
  const sorted = [...rows].sort(byCostDesc);
  const totalCost = sorted.reduce((sum, row) => sum + row.costUsd, 0);
  return { rows: sorted, isEmpty: sorted.length === 0, totalCost };
}

function groupSubAgents(subAgents: LabeledSubAgent[]): SubAgentSection {
  const byLabel = new Map<string, SubAgentGroup>();
  for (const sub of subAgents) {
    const group = byLabel.get(sub.label);
    if (group) {
      group.count += 1;
      group.tokens = addTokens(group.tokens, sub.tokens);
      group.costUsd += sub.costUsd;
      group.agents.push(sub);
    } else {
      byLabel.set(sub.label, {
        label: sub.label,
        count: 1,
        tokens: addTokens(zeroTokens(), sub.tokens),
        costUsd: sub.costUsd,
        agents: [sub],
      });
    }
  }
  const groups = [...byLabel.values()].sort(byCostDesc);
  for (const group of groups) group.agents.sort(byCostDesc);
  const totalCost = groups.reduce((sum, group) => sum + group.costUsd, 0);
  return { groups, isEmpty: groups.length === 0, totalCost };
}

export function detailSections(detail: ConversationDetail): {
  perModel: RankedSection<ConversationDetail["perModel"][number]>;
  subAgents: SubAgentSection;
  perSkill: RankedSection<ConversationDetail["perSkill"][number]>;
} {
  const labeled = detail.subAgents.map((sub) => ({
    ...sub,
    label: subAgentLabel(sub),
  }));
  return {
    perModel: rank(detail.perModel),
    subAgents: groupSubAgents(labeled),
    perSkill: rank(detail.perSkill),
  };
}
