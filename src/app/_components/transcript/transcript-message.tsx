import { formatClock, formatModelName } from "@/app/_lib/format";
import { type AgentLabel, parseSlashCommand } from "@/app/_lib/transcript";
import { messageAnchorId } from "@/app/_lib/transcript-url";
import type { TranscriptMessage, TranscriptView } from "@/core/read";

import { CostFigure, ErrorBadge } from "./transcript-parts";
import { TranscriptToolCallRow } from "./transcript-tool-call";
import { TurnMarkdown } from "./turn-markdown";

/**
 * One transcript row: a prompt (plain text, or a pretty slash command) or an
 * assistant turn (markdown body + per-turn cost, with its tool calls nested and
 * collapsed). Which branch is chosen by `role` — the reader only emits
 * `user`(=prompt) and `assistant` messages. Each row is an `<article>` named
 * by its speaker and time.
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
}) {
  const time = formatClock(message.timestamp);
  // A search result links here as `?msg=<uuid>#msg-<uuid>`: the query
  // highlights the row server-side (a fragment never reaches the server), the
  // fragment scrolls to the id. Same idiom as `?call=` for tool calls.
  const anchor = anchorProps(message, anchoredMessage);

  if (message.role === "user") {
    return <PromptRow message={message} time={time} anchor={anchor} author={promptAuthor} />;
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
    />
  );
}

/** The element id + highlight flag for one row, given the `?msg=` target, and
 *  the id prefix of its speaker/time labels. */
type MessageAnchor = { id?: string; anchored: boolean; labelId: string };

function anchorProps(message: TranscriptMessage, anchoredMessage: string | undefined): MessageAnchor {
  const labelId = `turn-${message.id}`;
  if (message.uuid === null) return { anchored: false, labelId };
  return {
    id: messageAnchorId(message.uuid),
    anchored: message.uuid === anchoredMessage,
    labelId,
  };
}

/** The speaker label and clock time that head a row and name its article. */
function RowHead({
  speaker,
  speakerClass,
  time,
  timestamp,
  labelId,
  children,
  trailing,
}: {
  speaker: string;
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
      {time && (
        <time id={`${labelId}-at`} className="row-time" dateTime={timestamp ?? undefined}>
          {time}
        </time>
      )}
      {trailing}
    </div>
  );
}

/** The `aria-labelledby` of a row: its speaker, then its time when it has one. */
function labelledBy(anchor: MessageAnchor, time: string): string {
  return time ? `${anchor.labelId}-who ${anchor.labelId}-at` : `${anchor.labelId}-who`;
}

/** A prompt. Rendered PLAIN (never markdown) — humans don't write reliable
 *  markdown — except an invoked slash command, shown as a command chip + args.
 *  In a sub-agent's transcript the prompt comes from the parent agent: it is
 *  labelled with that agent's name and ruled in the agent accent. */
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
      />
      {parsed.isSlashCommand ? (
        <div className="slash">
          <span className="slash-cmd">{commandLabel}</span>
          {args && <span className="slash-args">{args}</span>}
        </div>
      ) : (
        <div className="prompt-body">{message.text ?? ""}</div>
      )}
    </article>
  );
}

/** An assistant turn: markdown body (or the API error when the turn failed),
 *  a quiet header (model only when it differs from the agent's, effort only on
 *  a change, the cost as plain figures), and its nested tool calls. */
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
        {errorOnly ? (
          <p className="api-error-note">Turn failed{message.apiErrorMessage ? `: ${message.apiErrorMessage}` : "."}</p>
        ) : (
          <TurnMarkdown text={text} />
        )}
      </div>

      {message.toolCalls.length > 0 && (
        <div className="calls">
          {message.toolCalls.map((call, i) => (
            <TranscriptToolCallRow
              key={call.toolUseId ?? `${message.id}-${i}`}
              call={call}
              messageId={message.id}
              view={view}
              labels={labels}
              anchoredCall={anchoredCall}
              listReturn={listReturn}
            />
          ))}
        </div>
      )}
    </article>
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
