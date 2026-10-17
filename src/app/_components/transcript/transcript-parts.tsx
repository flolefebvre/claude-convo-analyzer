// Small presentational pieces shared by the transcript's tree, pane header,
// turns and tool calls, so an agent's name, an error and a cost read the same
// wherever they appear.

import { AlertTriangle } from "lucide-react";

import { formatCost } from "@/app/_lib/format";
import type { AgentLabel } from "@/app/_lib/transcript";

/**
 * An agent's name as plain text, ordinal included, for titles and labels.
 *
 * @example agentLabelText({ name: "Plan", ordinal: 2 }) // "Plan #2"
 */
export function agentLabelText(label: AgentLabel): string {
  return label.ordinal === null ? label.name : `${label.name} #${label.ordinal}`;
}

/**
 * An agent's name, with a muted ordinal when same-named siblings need telling
 * apart.
 *
 * @example <AgentName label={{ name: "Plan", ordinal: 2 }} />
 */
export function AgentName({ label }: { label: AgentLabel }) {
  return (
    <>
      {label.name}
      {label.ordinal !== null && <span className="agent-ordinal"> #{label.ordinal}</span>}
    </>
  );
}

/**
 * The transcript's one error marker: a warning icon and a short word on the
 * destructive tint. `iconOnly` keeps the word for screen readers only (the
 * tree's narrow rows).
 *
 * @example <ErrorBadge title={message.apiErrorMessage ?? undefined}>API error</ErrorBadge>
 */
export function ErrorBadge({
  children,
  title,
  iconOnly = false,
}: {
  children: React.ReactNode;
  title?: string;
  iconOnly?: boolean;
}) {
  return (
    <span className={iconOnly ? "badge-err is-icon" : "badge-err"} title={title}>
      <AlertTriangle aria-hidden className="size-3 shrink-0" />
      {/* Spaced, so the word stays separate inside a link's accessible name. */}
      <span className={iconOnly ? "sr-only" : undefined}>{iconOnly ? <> {children} </> : children}</span>
    </span>
  );
}

/** Hover text on a cost that leaves out unpriced usage — the list's wording. */
const LOWER_BOUND_TITLE = "Cost excludes unpriced model usage — lower bound.";

/**
 * A dollar figure in the clay text tone, prefixed `~` (with an explaining
 * title) when it is a lower bound because some usage has no known price.
 *
 * @example <CostFigure usd={node.costUsd} lowerBound={node.unpriced} />
 */
export function CostFigure({ usd, lowerBound, className }: { usd: number; lowerBound: boolean; className?: string }) {
  return (
    <span className={className ? `cost ${className}` : "cost"} title={lowerBound ? LOWER_BOUND_TITLE : undefined}>
      {lowerBound && "~"}
      {formatCost(usd)}
    </span>
  );
}
