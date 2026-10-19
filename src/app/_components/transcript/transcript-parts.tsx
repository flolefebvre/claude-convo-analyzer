// Small presentational pieces shared by the transcript's tree, pane header,
// turns and tool calls, so an agent's name, an error and a cost read the same
// wherever they appear.

import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

import { formatCost } from "@/app/_lib/format";
import type { AgentLabel } from "@/app/_lib/transcript";

/**
 * The pane's top: the page's (visually hidden) h1, the conversation title,
 * then the sticky header strip — a breadcrumb named `crumbLabel`, and stats.
 *
 * @example <PaneHeader title={view.title} crumbLabel="Agent lineage" crumbs={…} stats={…} />
 */
export function PaneHeader({
  title,
  crumbLabel,
  crumbs,
  stats,
}: {
  title: string | null;
  crumbLabel: string;
  crumbs: ReactNode;
  stats: ReactNode;
}) {
  return (
    <>
      <h1 className="sr-only">{title ?? "Untitled conversation"}</h1>
      <div className="pane-header">
        <div className="pane-header-inner">
          <nav className="crumb" aria-label={crumbLabel}>
            {crumbs}
          </nav>
          <div className="stats">{stats}</div>
        </div>
      </div>
    </>
  );
}

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

/** A row's element id and `?msg=` highlight, and the id prefix of its speaker/time labels. */
export type MessageAnchor = { id?: string; anchored: boolean; labelId: string };

/**
 * The speaker label and clock time that head a row and name its article.
 *
 * @example <RowHead speaker="You" speakerClass="speaker" time={time} timestamp={message.timestamp} labelId={anchor.labelId} />
 */
export function RowHead({
  speaker,
  speakerClass,
  time,
  timestamp,
  labelId,
  children,
  trailing,
}: {
  speaker: React.ReactNode;
  speakerClass: string;
  time: string;
  timestamp: string | null;
  labelId: string;
  /** Badges after the speaker. */
  children?: React.ReactNode;
  /** Figures after the time, at the row's right edge. */
  trailing?: React.ReactNode;
}) {
  return (
    <div className="row-head">
      <span id={`${labelId}-who`} className={speakerClass}>
        {speaker}
      </span>
      {children}
      <span className="spacer" />
      <RowTime time={time} timestamp={timestamp} labelId={labelId} />
      {trailing}
    </div>
  );
}

/**
 * A row's clock time, the second half of its accessible name.
 *
 * @example <RowTime time={time} timestamp={message.timestamp} labelId={anchor.labelId} />
 */
export function RowTime({ time, timestamp, labelId }: { time: string; timestamp: string | null; labelId: string }) {
  if (!time) return null;
  return (
    <time id={`${labelId}-at`} className="row-time" dateTime={timestamp ?? undefined}>
      {time}
    </time>
  );
}

/**
 * The `aria-labelledby` of a row: its speaker, then its time when it has one.
 *
 * @example <article aria-labelledby={labelledBy(anchor, time)}>
 */
export function labelledBy(anchor: MessageAnchor, time: string): string {
  return time ? `${anchor.labelId}-who ${anchor.labelId}-at` : `${anchor.labelId}-who`;
}

/**
 * The marker on a Prompt or Inter-agent message that arrived while the agent
 * was working, landing mid-turn.
 *
 * @example {message.origin?.midTurn && <MidTurnBadge />}
 */
export function MidTurnBadge() {
  return <span className="badge-note">sent while working</span>;
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
