// The words the views use for Side requests (GLOSSARY.md): the one-line
// tooltip shown wherever the term appears, each kind's label, and the count.
// Pure, type-only core imports (ADR-0002), so it unit-tests in node.

import type { SideRequestKind } from "@/core/api-request-kind";

/**
 * The one-line explanation shown wherever "Side requests" appears.
 *
 * @example <h3 title={SIDE_REQUESTS_TOOLTIP}>Side requests</h3>
 */
export const SIDE_REQUESTS_TOOLTIP =
  "Requests Claude Code makes on its own: naming, quota checks, safety monitor, suggestions.";

/** The display label of each Side request kind. */
const LABEL_BY_SIDE_REQUEST_KIND: Record<SideRequestKind, string> = {
  "session-naming": "Session naming",
  "quota-probe": "Quota probe",
  "safety-monitor": "Safety monitor",
  suggestion: "Suggestion",
  "token-count": "Token count",
  other: "Other",
};

/**
 * The display label of a Side request kind.
 *
 * @example sideRequestKindLabel("quota-probe") // "Quota probe"
 */
export function sideRequestKindLabel(kind: SideRequestKind): string {
  return LABEL_BY_SIDE_REQUEST_KIND[kind];
}

/**
 * The display label of one Side request: its kind's, or for `other` its own
 * label (the first line of its system prompt) when it has one.
 *
 * @example sideRequestLabel({ kind: "other", otherKindLabel: "Summarize the calls." }) // "Summarize the calls."
 */
export function sideRequestLabel(sideRequest: { kind: SideRequestKind; otherKindLabel: string | null }): string {
  return sideRequest.kind === "other" && sideRequest.otherKindLabel !== null
    ? sideRequest.otherKindLabel
    : sideRequestKindLabel(sideRequest.kind);
}

/**
 * How many Side requests, in words.
 *
 * @example sideRequestCountLabel(1) // "1 Side request"
 */
export function sideRequestCountLabel(count: number): string {
  return `${count} Side request${count === 1 ? "" : "s"}`;
}
