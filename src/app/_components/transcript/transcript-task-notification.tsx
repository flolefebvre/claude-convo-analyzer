import { ChevronRight } from "lucide-react";

import type { AgentLabel } from "@/app/_lib/transcript";
import { agentHref, agentSectionHref, withListReturn } from "@/app/_lib/transcript-url";
import type { TranscriptMessage } from "@/core/read";

import { ErrorBadge, type MessageAnchor, OpenTranscriptLink, RowTime, labelledBy } from "./transcript-parts";
import { TurnMarkdown } from "./turn-markdown";

/** Statuses of a task that did not finish on its own — flagged, not just stated. */
const FLAGGED_STATUSES = new Set(["failed", "killed", "stopped"]);

/**
 * A Task notification: one compact line — `<summary> · <status>`, the status
 * flagged when the task failed or was killed or stopped, and a link to the
 * Sub-agent's transcript when the task was one. Its result, when it has one,
 * waits behind an expander (open when the row is the `?msg=` target).
 */
export function TaskNotificationRow({
  message,
  time,
  anchor,
  sessionId,
  labels,
  listReturn,
  agentLinksAreInFile = false,
}: {
  message: TranscriptMessage;
  time: string;
  anchor: MessageAnchor;
  sessionId: string;
  /** Every agent's display name, from `agentLabels(view.tree)`: the Agents of this Conversation. */
  labels: Map<string, AgentLabel>;
  /** The list view this transcript was opened from (`?from=`), carried on links. */
  listReturn?: string;
  /** True in the Conversation export: the Sub-agent's link points at its
   *  section of the file, and is left out when it has none. */
  agentLinksAreInFile?: boolean;
}) {
  const origin = message.origin;
  const status = origin?.taskStatus;
  const taskAgentId = origin?.taskAgentId;
  const openTranscriptHref = !taskAgentId
    ? undefined
    : !agentLinksAreInFile
      ? withListReturn(agentHref(sessionId, taskAgentId), listReturn)
      : labels.has(taskAgentId)
        ? agentSectionHref(taskAgentId)
        : undefined;
  const className = ["notice", anchor.anchored && "anchored"].filter(Boolean).join(" ");

  return (
    <article id={anchor.id} className={className} aria-labelledby={labelledBy(anchor, time)}>
      <span className="kind kind-tool">Task</span>
      <span id={`${anchor.labelId}-who`} className="notice-summary">
        {origin?.taskSummary ?? "Task notification"}
      </span>
      {status &&
        (FLAGGED_STATUSES.has(status) ? (
          <ErrorBadge>{status}</ErrorBadge>
        ) : (
          <span className="notice-status">
            <span aria-hidden>· </span>
            {status}
          </span>
        ))}
      {openTranscriptHref !== undefined && (
        <OpenTranscriptLink href={openTranscriptHref} isInFile={agentLinksAreInFile} />
      )}
      <span className="spacer" />
      <RowTime time={time} timestamp={message.timestamp} labelId={anchor.labelId} />
      {message.text && (
        <details className="notice-result" open={anchor.anchored || undefined}>
          <summary>
            <ChevronRight aria-hidden className="chev" />
            Result
          </summary>
          <div className="turn-body">
            <TurnMarkdown text={message.text} />
          </div>
        </details>
      )}
    </article>
  );
}
