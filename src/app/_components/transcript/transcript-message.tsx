import type { ReactNode } from "react";

import { formatClock } from "@/app/_lib/format";
import { type AgentLabel, parseSlashCommand, type TranscriptExport } from "@/app/_lib/transcript";
import type { TranscriptMessage, TranscriptView } from "@/core/read";

import { CopiedFrom } from "./copied-from";
import { SpeakerRow } from "./speaker-row";
import { InterAgentMessageRow } from "./transcript-inter-agent-message";
import { type MessageAnchor, MidTurnBadge, anchorProps } from "./transcript-parts";
import { TaskNotificationRow } from "./transcript-task-notification";
import { TurnMarkdown } from "./turn-markdown";

/**
 * One Message addressed to the Agent, a row of its own between its Replies: a
 * Prompt (plain text when the person wrote it, markdown when an agent did, or a
 * pretty slash command), an Inter-agent message, or a Task notification. Which
 * branch is chosen by `kind`. Each row is an `<article>` named by its speaker
 * and time.
 */
export function TranscriptMessageRow({
  message,
  view,
  labels,
  promptAuthor,
  anchoredMessage,
  listReturn,
  transcriptExport,
}: {
  message: TranscriptMessage;
  view: TranscriptView;
  /** Every agent's display name, for senders and copied-from owners. */
  labels: Map<string, AgentLabel>;
  /** Who wrote the prompts: null for the person, else the parent agent's name. */
  promptAuthor: string | null;
  /** The `?msg=` deep-link target (a search hit): THIS row is highlighted when
   *  its uuid matches, and carries the `#msg-<uuid>` fragment's element id. */
  anchoredMessage?: string;
  /** The list view this transcript was opened from (`?from=`), carried on
   *  every link to another transcript. */
  listReturn?: string;
  /** Set in the Conversation export: agent links to their sections of the file. */
  transcriptExport?: TranscriptExport;
}) {
  const time = formatClock(message.timestamp);
  const agentLinksAreInFile = transcriptExport !== undefined;
  // The export holds every Agent's transcript in one document, where a Copied
  // Message repeats its owner's uuid: only the owner's rendering carries the
  // anchor, so it lands on the owner (ADR-0011).
  const anchor = anchorProps(message, anchoredMessage, transcriptExport === undefined || message.copiedFrom === null);
  const copiedFrom = message.copiedFrom && (
    <CopiedFrom
      owner={message.copiedFrom}
      sessionId={view.sessionId}
      rootAgentId={view.tree.id}
      labels={labels}
      listReturn={listReturn}
      agentLinksAreInFile={agentLinksAreInFile}
    />
  );

  if (message.kind === "inter-agent") {
    return (
      <InterAgentMessageRow
        message={message}
        time={time}
        anchor={anchor}
        sessionId={view.sessionId}
        rootAgentId={view.tree.id}
        labels={labels}
        listReturn={listReturn}
        agentLinksAreInFile={agentLinksAreInFile}
        copiedFrom={copiedFrom}
      />
    );
  }
  if (message.kind === "task-notification") {
    return (
      <TaskNotificationRow
        message={message}
        time={time}
        anchor={anchor}
        sessionId={view.sessionId}
        labels={labels}
        listReturn={listReturn}
        agentLinksAreInFile={agentLinksAreInFile}
        copiedFrom={copiedFrom}
      />
    );
  }
  // A Prompt sent while the agent was working is the person's, even in a
  // sub-agent's transcript, where the other prompts come from its parent.
  const author = message.origin?.midTurn ? null : promptAuthor;
  return <PromptRow message={message} time={time} anchor={anchor} author={author} copiedFrom={copiedFrom} />;
}

/** A Prompt, rendered by its author: one the person authored stays PLAIN —
 *  humans don't write reliable markdown — in a muted bubble under the person's
 *  avatar, while a Task prompt, authored by the parent agent, renders as
 *  markdown in an agent-tinted bubble, labelled with that agent's name. An
 *  invoked slash command shows as a command chip + args whoever sent it. A
 *  plugin's prompt says which plugin sent it; one that arrived while the agent
 *  was working says so. */
function PromptRow({
  message,
  time,
  anchor,
  author,
  copiedFrom,
}: {
  message: TranscriptMessage;
  time: string;
  anchor: MessageAnchor;
  author: string | null;
  /** The marker of a Copied Message (see `CopiedFrom`); absent on one this Agent owns. */
  copiedFrom: ReactNode;
}) {
  const parsed = parseSlashCommand(message.text);
  const commandLabel =
    parsed.commandName && !parsed.commandName.startsWith("/") ? `/${parsed.commandName}` : parsed.commandName;
  const args = parsed.commandArgs ?? parsed.rest;
  const className = [
    "row prompt",
    author !== null && "is-agent",
    message.copiedFrom !== null && "is-copied",
    anchor.anchored && "anchored",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <SpeakerRow
      speaker={author === null ? "person" : "agent"}
      label={author === null ? "You" : `From ${author}`}
      className={className}
      anchor={anchor}
      time={time}
      timestamp={message.timestamp}
      trailing={copiedFrom}
      notes={
        <>
          {message.origin?.plugin && <span className="badge-note">via {message.origin.plugin}</span>}
          {message.origin?.midTurn && <MidTurnBadge />}
        </>
      }
    >
      {parsed.isSlashCommand ? (
        <div className="slash">
          <span className="slash-cmd">{commandLabel}</span>
          {args && <span className="slash-args">{args}</span>}
        </div>
      ) : author === null ? (
        <div className="prompt-body">{message.text ?? ""}</div>
      ) : (
        <div className="turn-body">
          <TurnMarkdown text={message.text ?? ""} />
        </div>
      )}
    </SpeakerRow>
  );
}
