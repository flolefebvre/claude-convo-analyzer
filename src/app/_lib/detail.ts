// Pure presentation helpers for the expandable conversation-detail panel
// (slice 4). Like its sibling `format`/`sort`/`refresh-summary` modules this is
// free of React, I/O, and any runtime dependency on `src/core` (only type-only
// imports, erased at compile time, cross the ADR-0002 boundary). The detail
// shaping/labeling logic lives here so it is unit-tested in the node vitest
// environment; the client expansion component is a thin renderer over these.

import type { CostByType, Tokens } from "@/core/cost";
import type { ConversationDetail } from "@/core/read";

/**
 * Display label for a sub-agent row. The root/main thread carries an empty
 * `agentType` (see `subAgentBreakdown` in core), so an empty — or whitespace-only
 * — type renders as "main"; a real sub-agent shows its own type verbatim.
 */
export function subAgentLabel(sub: { agentType: string }): string {
  const type = sub.agentType.trim();
  return type === "" ? "main" : type;
}

/** A sub-agent row with its resolved display {@link subAgentLabel}. */
export type LabeledSubAgent = ConversationDetail["subAgents"][number] & {
  label: string;
};

/**
 * A cost breakdown ranked for display: rows sorted by cost (desc) so the
 * dominant contributor leads, plus `totalCost` — the denominator the renderer
 * uses to scale each row's **share-of-total** bar (every bar reads as a fraction
 * of this conversation's spend, NOT relative to the largest row).
 */
export type RankedSection<Row> = {
  rows: Row[];
  isEmpty: boolean;
  totalCost: number;
};

/**
 * Sub-agents of one type, collapsed into a single ranked entry: the summed
 * tokens/cost and member `count` drive the group's bar, while `agents` keeps the
 * individuals (cost desc) for the expandable disclosure.
 */
export type SubAgentGroup = {
  label: string;
  count: number;
  tokens: Tokens;
  costUsd: number;
  agents: LabeledSubAgent[];
};

/** The sub-agent breakdown: groups ranked by summed cost, plus the total. */
export type SubAgentSection = {
  groups: SubAgentGroup[];
  isEmpty: boolean;
  totalCost: number;
};

/**
 * One Token-composition bucket, render-ready: its label, the bucket's dollar
 * `costUsd` (the prominent figure — the renderer formats it with `formatCost`),
 * and the muted secondary `tokens` count plus its `percent` of the total. The
 * four buckets always appear in display order (input → output → cache-write →
 * cache-read), so a $0/empty bucket still renders for column alignment.
 */
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

/**
 * Pair each of the four token buckets with its dollar cost for the Token-
 * composition section. The dollar is the payload (rendered prominent); `tokens`
 * and `percent` are the demoted secondary facts. `percent` is the bucket's share
 * of `tokens.total` (0 when the conversation has no tokens, avoiding a divide by
 * zero). Unpriced handling (`~` prefix + lower-bound tooltip) stays in the
 * renderer, driven by the row's existing `unpriced` flag.
 */
export function tokenComposition(
  tokens: Tokens,
  costByType: CostByType,
): CompositionBucket[] {
  const total = tokens.total || 1;
  return BUCKETS.map(({ key, label, token }) => ({
    key,
    label,
    costUsd: costByType[key],
    tokens: tokens[token],
    percent: Math.round((tokens[token] / total) * 100),
  }));
}

const byCostDesc = (a: { costUsd: number }, b: { costUsd: number }): number =>
  b.costUsd - a.costUsd;

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

/** Sort a cost-bearing breakdown by cost (desc) and total it for share bars. */
function rank<Row extends { costUsd: number }>(rows: Row[]): RankedSection<Row> {
  const sorted = [...rows].sort(byCostDesc);
  const totalCost = sorted.reduce((sum, row) => sum + row.costUsd, 0);
  return { rows: sorted, isEmpty: sorted.length === 0, totalCost };
}

/** Collapse sub-agents by display label into ranked, member-preserving groups. */
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

/**
 * Shape a `ConversationDetail` into render-ready breakdowns. Per-model and
 * per-skill rows are ranked by cost (desc) with a `totalCost` for share-of-total
 * bars; sub-agents are labeled (root → "main") then grouped by type into ranked,
 * expandable {@link SubAgentGroup}s. Empty flags let the renderer show a note.
 */
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
