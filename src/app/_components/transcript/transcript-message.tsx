import { ChevronRight } from "lucide-react";

import { formatClock, formatLatency, formatModelName } from "@/app/_lib/format";
import { type AgentLabel, parseSlashCommand, type TranscriptExport } from "@/app/_lib/transcript";
import { messageAnchorId } from "@/app/_lib/transcript-url";
import type { TranscriptMessage, TranscriptView } from "@/core/read";

import { InterAgentMessageRow } from "./transcript-inter-agent-message";
import { CostFigure, ErrorBadge, type MessageAnchor, MidTurnBadge, RowHead, labelledBy } from "./transcript-parts";
import { TaskNotificationRow } from "./transcript-task-notification";
import { TranscriptToolCallRow } from "./transcript-tool-call";
import { WhatWasSentDisclosure } from "./transcript-what-was-sent";
import { TurnMarkdown } from "./turn-markdown";

/**
 * One transcript row: a prompt (plain text when the human wrote it, markdown
 * when an agent did, or a pretty slash command), an
 * Inter-agent message, a Task notification, or an assistant turn (markdown
 * body + per-turn cost, with its tool calls nested and collapsed). Which
 * branch is chosen by `kind`, then `role`. Each row is an `<article>` named by
 * its speaker and time.
 */
export function TranscriptMessageRow({
  message,
  view,
  labels,
  agentModel,
  promptAuthor,
  effortChanged,
  anchoredCall,
  anchoredMessage,
  listReturn,
  transcriptExport,
}: {
  message: TranscriptMessage;
  view: TranscriptView;
  /** Every agent's display name, for the Agent calls' spawned-agent names. */
  labels: Map<string, AgentLabel>;
  /** The model this agent runs on: a turn names its model only when it differs. */
  agentModel: string | null;
  /** Who wrote the prompts: null for the person, else the parent agent's name. */
  promptAuthor: string | null;
  /** The `?call=` deep-link target, threaded down to the tool calls. */
  anchoredCall?: string;
  /** The `?msg=` deep-link target (a search hit): THIS row is highlighted when
   *  its uuid matches, and carries the `#msg-<uuid>` fragment's element id. */
  anchoredMessage?: string;
  /** True when this turn's effort differs from the previous effort-carrying
   *  turn (computed once for the whole transcript by the pane). */
  effortChanged: boolean;
  /** The list view this transcript was opened from (`?from=`), carried on
   *  every link to another transcript. */
  listReturn?: string;
  /** Set in the Conversation export: Tool call bodies inlined, agent links to
   *  their sections of the file, and no What was sent. */
  transcriptExport?: TranscriptExport;
}) {
  const time = formatClock(message.timestamp);
  const agentLinksAreInFile = transcriptExport !== undefined;
  // A search result links here as `?msg=<uuid>#msg-<uuid>`: the query
  // highlights the row server-side (a fragment never reaches the server), and
  // the pane's `ScrollToAnchor` scrolls to the id. Same idiom as `?call=`.
  const anchor = anchorProps(message, anchoredMessage);

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
      />
    );
  }
  if (message.role === "user") {
    // A Prompt sent while the agent was working is the person's, even in a
    // sub-agent's transcript, where the other prompts come from its parent.
    const author = message.origin?.midTurn ? null : promptAuthor;
    return <PromptRow message={message} time={time} anchor={anchor} author={author} />;
  }
  return (
    <AssistantTurn
      message={message}
      time={time}
      view={view}
      labels={labels}
      agentModel={agentModel}
      effortChanged={effortChanged}
      anchoredCall={anchoredCall}
      anchor={anchor}
      listReturn={listReturn}
      transcriptExport={transcriptExport}
    />
  );
}

/** The element id + highlight flag for one row, given the `?msg=` target, and
 *  the id prefix of its speaker/time labels. */
function anchorProps(message: TranscriptMessage, anchoredMessage: string | undefined): MessageAnchor {
  const labelId = `turn-${message.id}`;
  if (message.uuid === null) return { anchored: false, labelId };
  return {
    id: messageAnchorId(message.uuid),
    anchored: message.uuid === anchoredMessage,
    labelId,
  };
}

/** A Prompt, rendered by its author: one the human authored stays PLAIN —
 *  humans don't write reliable markdown — while a Task prompt, authored by the
 *  parent agent, renders as markdown, labelled with that agent's name and ruled
 *  in the agent accent. An invoked slash command shows as a command chip + args
 *  whoever sent it. A plugin's prompt says which plugin sent it; one that
 *  arrived while the agent was working says so. */
function PromptRow({
  message,
  time,
  anchor,
  author,
}: {
  message: TranscriptMessage;
  time: string;
  anchor: MessageAnchor;
  author: string | null;
}) {
  const parsed = parseSlashCommand(message.text);
  const commandLabel =
    parsed.commandName && !parsed.commandName.startsWith("/") ? `/${parsed.commandName}` : parsed.commandName;
  const args = parsed.commandArgs ?? parsed.rest;
  const className = ["prompt", author !== null && "is-agent", anchor.anchored && "anchored"].filter(Boolean).join(" ");

  return (
    <article id={anchor.id} className={className} aria-labelledby={labelledBy(anchor, time)}>
      <RowHead
        speaker={author === null ? "You" : `From ${author}`}
        speakerClass="speaker"
        time={time}
        timestamp={message.timestamp}
        labelId={anchor.labelId}
      >
        {message.origin?.plugin && <span className="badge-note">via {message.origin.plugin}</span>}
        {message.origin?.midTurn && <MidTurnBadge />}
      </RowHead>
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
    </article>
  );
}

/** An assistant turn: its thinking, then its markdown body (or the API error when the turn failed),
 *  a quiet header (model only when it differs from the agent's, effort only on
 *  a change, the cost as plain figures), its nested tool calls, and, when it
 *  the logs hold its API request, what that request sent. */
function AssistantTurn({
  message,
  time,
  view,
  labels,
  agentModel,
  effortChanged,
  anchoredCall,
  anchor,
  listReturn,
  transcriptExport,
}: {
  message: TranscriptMessage;
  time: string;
  view: TranscriptView;
  labels: Map<string, AgentLabel>;
  agentModel: string | null;
  effortChanged: boolean;
  /** The `?call=` deep-link target, threaded down to the tool calls. */
  anchoredCall?: string;
  anchor: MessageAnchor;
  listReturn: string | undefined;
  transcriptExport: TranscriptExport | undefined;
}) {
  const text = message.text ?? "";
  const errorOnly = message.isApiError && text.trim() === "";
  const className = ["turn", message.isApiError && "is-failed", anchor.anchored && "anchored"]
    .filter(Boolean)
    .join(" ");

  return (
    <article id={anchor.id} className={className} aria-labelledby={labelledBy(anchor, time)}>
      <RowHead
        speaker="Assistant"
        speakerClass="speaker is-assistant"
        time={time}
        timestamp={message.timestamp}
        labelId={anchor.labelId}
        trailing={<TurnCost message={message} />}
      >
        {message.model && message.model !== agentModel && (
          <span className="model" title={message.model}>
            {formatModelName(message.model)}
          </span>
        )}
        {/* Only on a turn that CHANGED effort (a mid-conversation `/effort`
            flip); the pane's header stat covers the steady state. */}
        {effortChanged && message.effort && <span className="badge-effort">{message.effort} effort</span>}
        {message.isApiError && <ErrorBadge>API error</ErrorBadge>}
      </RowHead>

      <div className="turn-body">
        <ThinkingLine text={message.thinkingText} durationMs={message.thinkingDurationMs} />
        {errorOnly ? (
          <p className="api-error-note">Turn failed{message.apiErrorMessage ? `: ${message.apiErrorMessage}` : "."}</p>
        ) : (
          <TurnMarkdown text={text} />
        )}
      </div>

      {message.toolCalls.length > 0 && (
        <div className="calls">
          {message.toolCalls.map((call) => (
            <TranscriptToolCallRow
              key={call.id}
              call={call}
              messageId={message.id}
              view={view}
              labels={labels}
              anchoredCall={anchoredCall}
              listReturn={listReturn}
              transcriptExport={transcriptExport}
            />
          ))}
        </div>
      )}

      {/* The export leaves What was sent out: it holds the user's CLAUDE.md
          files, environment and system prompt. */}
      {message.apiRequestId !== null && transcriptExport === undefined && (
        <div className="calls">
          <WhatWasSentDisclosure
            apiRequestId={message.apiRequestId}
            failedAttemptCount={message.failedAttemptCount}
            failedAttemptsLostMs={message.failedAttemptsLostMs}
          />
        </div>
      )}
    </article>
  );
}

/** A Turn's thinking, before its text: "Thinking · 1.3s", folding the summary
 *  the model left when there is one, a plain line when there is none; nothing
 *  on a Turn without thinking. */
function ThinkingLine({ text, durationMs }: { text: string | null; durationMs: number | null }) {
  if (text === null && durationMs === null) return null;
  const label = durationMs === null ? "Thinking" : `Thinking · ${formatLatency(durationMs)}`;
  if (text === null) return <p className="thinking">{label}</p>;
  return (
    <details className="thinking">
      <summary>
        <ChevronRight aria-hidden className="chev" />
        {label}
      </summary>
      <p className="thinking-text">{text}</p>
    </details>
  );
}

/** The turn's own cost, or "unpriced" for a model without a known price. */
function TurnCost({ message }: { message: TranscriptMessage }) {
  if (message.unpriced) {
    return (
      <span className="turn-cost is-unpriced" title="No known price for this model: counted as $0 in every total.">
        unpriced
      </span>
    );
  }
  return <CostFigure usd={message.costUsd} lowerBound={false} className="turn-cost" />;
}
