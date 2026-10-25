import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { PendingLink } from "@/app/_components/pending-link";
import type { AgentLabel } from "@/app/_lib/transcript";
import { agentHref, agentSectionHref, withListReturn } from "@/app/_lib/transcript-url";
import type { TranscriptMessage } from "@/core/read";

import { AgentName, type MessageAnchor, MidTurnBadge, agentLabelText } from "./transcript-parts";
import { SpeakerRow } from "./speaker-row";
import { TurnMarkdown } from "./turn-markdown";

/**
 * An Inter-agent message: a row labelled with its sender and its body as
 * markdown (agents write it). A sender of this conversation — a Sub-agent or
 * the parent agent — is linked to its transcript, under the agent avatar in an
 * agent-tinted bubble; another Conversation's agent is named by its session,
 * under an outlined avatar in an outlined bubble. A hand-back is tagged and
 * starts collapsed, unless it is the `?msg=` target.
 */
export function InterAgentMessageRow({
  message,
  time,
  anchor,
  sessionId,
  rootAgentId,
  labels,
  listReturn,
  agentLinksAreInFile = false,
  copiedFrom,
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
  /** True in the Conversation export: the sender links to its section of the file. */
  agentLinksAreInFile?: boolean;
  /** The marker of a Copied Message (see `CopiedFrom`); absent on one this Agent owns. */
  copiedFrom?: ReactNode;
}) {
  const origin = message.origin;
  // A sender this Conversation does not hold is another Conversation's agent.
  const isFromOtherConversation = origin?.senderAgentId == null;
  const className = [
    "row inter",
    isFromOtherConversation && "is-other-conversation",
    message.copiedFrom !== null && "is-copied",
    anchor.anchored && "anchored",
  ]
    .filter(Boolean)
    .join(" ");
  const body = <TurnMarkdown text={message.text ?? ""} />;

  return (
    <SpeakerRow
      speaker={isFromOtherConversation ? "other-conversation" : "agent"}
      label={
        <>
          From{" "}
          <Sender
            message={message}
            sessionId={sessionId}
            rootAgentId={rootAgentId}
            labels={labels}
            listReturn={listReturn}
            agentLinksAreInFile={agentLinksAreInFile}
          />
        </>
      }
      className={className}
      anchor={anchor}
      time={time}
      timestamp={message.timestamp}
      trailing={copiedFrom}
      notes={
        <>
          {isFromOtherConversation && <span className="row-note">another Conversation</span>}
          {origin?.handback && <span className="badge-note">hand-back</span>}
          {origin?.midTurn && <MidTurnBadge />}
        </>
      }
    >
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
    </SpeakerRow>
  );
}

/** The sender's name: linked when it is an agent of this conversation. */
function Sender({
  message,
  sessionId,
  rootAgentId,
  labels,
  listReturn,
  agentLinksAreInFile,
}: {
  message: TranscriptMessage;
  sessionId: string;
  rootAgentId: string;
  labels: Map<string, AgentLabel>;
  listReturn: string | undefined;
  agentLinksAreInFile: boolean;
}) {
  const origin = message.origin;
  const agentId = origin?.senderAgentId ?? null;
  const label = agentId === null ? undefined : labels.get(agentId);
  if (agentId !== null && label !== undefined && agentLinksAreInFile) {
    return (
      <a className="sender-link" href={agentSectionHref(agentId)} title={agentLabelText(label)}>
        <AgentName label={label} />
      </a>
    );
  }
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
