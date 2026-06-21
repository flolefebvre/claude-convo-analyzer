// Pure presentation helpers for the expandable conversation-detail panel
// (slice 4). Like its sibling `format`/`sort`/`refresh-summary` modules this is
// free of React, I/O, and any runtime dependency on `src/core` (only type-only
// imports, erased at compile time, cross the ADR-0002 boundary). The detail
// shaping/labeling logic lives here so it is unit-tested in the node vitest
// environment; the client expansion component is a thin renderer over these.

import type { ConversationDetail } from "@/core/refresh";

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

/** One detail section: its display rows plus whether it is empty (for a note). */
type Section<Row> = { rows: Row[]; isEmpty: boolean };

/**
 * Shape a `ConversationDetail` into the three render-ready sections. Per-model
 * and per-skill rows pass through unchanged; sub-agent rows gain a display
 * {@link subAgentLabel} (root → "main"). Each section carries an `isEmpty` flag
 * so the renderer can show a subtle "none" note instead of an empty table.
 */
export function detailSections(detail: ConversationDetail): {
  perModel: Section<ConversationDetail["perModel"][number]>;
  subAgents: Section<LabeledSubAgent>;
  perSkill: Section<ConversationDetail["perSkill"][number]>;
} {
  const subAgents = detail.subAgents.map((sub) => ({
    ...sub,
    label: subAgentLabel(sub),
  }));
  return {
    perModel: { rows: detail.perModel, isEmpty: detail.perModel.length === 0 },
    subAgents: { rows: subAgents, isEmpty: subAgents.length === 0 },
    perSkill: { rows: detail.perSkill, isEmpty: detail.perSkill.length === 0 },
  };
}
