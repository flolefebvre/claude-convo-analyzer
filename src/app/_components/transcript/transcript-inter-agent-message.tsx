import { ChevronRight } from "lucide-react";

import { PendingLink } from "@/app/_components/pending-link";
import type { AgentLabel } from "@/app/_lib/transcript";
import { agentHref, withListReturn } from "@/app/_lib/transcript-url";
import type { TranscriptMessage } from "@/core/read";

import { AgentName, type MessageAnchor, MidTurnBadge, RowHead, agentLabelText, labelledBy } from "./transcript-parts";
import { TurnMarkdown } from "./turn-markdown";

/**
 * An Inter-agent message: a prompt-style row in the agent accent, labelled with
 * its sender — a Sub-agent of this conversation or the parent agent, linked to
 * its transcript, else the other session's name — and its body as markdown
 * (agents write it). A hand-back is tagged and starts collapsed, unless it is
 * the `?msg=` target.
 */
export function InterAgentMessageRow({
  message,
  time,
  anchor,
  sessionId,
  rootAgentId,
  labels,
  listReturn,
  linksAreText = false,
}: {
  message: TranscriptMessage;
  time: string;
  anchor: MessageAnchor;
  sessionId: string;
  /** The main agent's tree key: its transcript is the bare route. */
  rootAgentId: string;
  /** Every agent's display name, from `agentLabels(view.tree)`. */
  labels: Map<string, AgentLabel>;
  /** The list view this transcript was opened from (`?from=`), carried on links. */
  listReturn?: string;
  /** True in the Conversation export: the sender is named as plain text. */
  linksAreText?: boolean;
}) {
  const origin = message.origin;
  const className = ["prompt", "is-agent", anchor.anchored && "anchored"].filter(Boolean).join(" ");
  const body = <TurnMarkdown text={message.text ?? ""} />;

  return (
    <article id={anchor.id} className={className} aria-labelledby={labelledBy(anchor, time)}>
      <RowHead
        speaker={
          <>
            From{" "}
            <Sender
              message={message}
              sessionId={sessionId}
              rootAgentId={rootAgentId}
              labels={labels}
              listReturn={listReturn}
              linksAreText={linksAreText}
            />
          </>
        }
        speakerClass="speaker"
        time={time}
        timestamp={message.timestamp}
        labelId={anchor.labelId}
      >
        {origin?.handback && <span className="badge-note">hand-back</span>}
        {origin?.midTurn && <MidTurnBadge />}
      </RowHead>
      {origin?.handback ? (
        <details className="handback" open={anchor.anchored || undefined}>
          <summary>
            <ChevronRight aria-hidden className="chev" />
            Report
          </summary>
          <div className="turn-body">{body}</div>
        </details>
      ) : (
        <div className="turn-body">{body}</div>
      )}
    </article>
  );
}

/** The sender's name: linked when it is an agent of this conversation. */
function Sender({
  message,
  sessionId,
  rootAgentId,
  labels,
  listReturn,
  linksAreText,
}: {
  message: TranscriptMessage;
  sessionId: string;
  rootAgentId: string;
  labels: Map<string, AgentLabel>;
  listReturn: string | undefined;
  linksAreText: boolean;
}) {
  const origin = message.origin;
  const agentId = origin?.senderAgentId ?? null;
  const label = agentId === null ? undefined : labels.get(agentId);
  if (label !== undefined && linksAreText) return <AgentName label={label} />;
  if (agentId !== null && label !== undefined) {
    return (
      <PendingLink
        className="sender-link"
        href={withListReturn(agentHref(sessionId, agentId === rootAgentId ? undefined : agentId), listReturn)}
        title={agentLabelText(label)}
      >
        <AgentName label={label} />
      </PendingLink>
    );
  }
  return <>{origin?.senderName ?? origin?.senderFrom ?? "another agent"}</>;
}
