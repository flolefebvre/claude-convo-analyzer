import { formatClock, formatCost } from "@/app/_lib/format";
import { parseSlashCommand } from "@/app/_lib/transcript";
import type { TranscriptMessage, TranscriptView } from "@/core/read";

import { TranscriptToolCallRow } from "./transcript-tool-call";
import { TurnMarkdown } from "./turn-markdown";

/**
 * One transcript row: a human prompt (plain text, or a pretty slash command) or
 * an assistant turn (markdown body + per-turn cost/model, with its tool calls
 * nested and collapsed). Which branch is chosen by `role` — the reader only
 * emits `user`(=prompt) and `assistant` messages.
 */
export function TranscriptMessageRow({
  message,
  view,
  effortChanged,
}: {
  message: TranscriptMessage;
  view: TranscriptView;
  /** True when this turn's effort differs from the previous effort-carrying
   *  turn (computed once for the whole transcript by the pane). */
  effortChanged: boolean;
}) {
  const time = formatClock(message.timestamp);

  if (message.role === "user") {
    return <PromptRow message={message} time={time} />;
  }
  return (
    <AssistantTurn
      message={message}
      time={time}
      view={view}
      effortChanged={effortChanged}
    />
  );
}

/** A human prompt. Rendered PLAIN (never markdown) — humans don't write reliable
 *  markdown — except an invoked slash command, shown as a command chip + args. */
function PromptRow({
  message,
  time,
}: {
  message: TranscriptMessage;
  time: string;
}) {
  const parsed = parseSlashCommand(message.text);
  const commandLabel =
    parsed.commandName && !parsed.commandName.startsWith("/")
      ? `/${parsed.commandName}`
      : parsed.commandName;
  const args = parsed.commandArgs ?? parsed.rest;

  return (
    <article className="prompt">
      <div className="prompt-head">
        <span className="microlabel">You</span>
        {time && <span className="call-meta num">{time}</span>}
      </div>
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

/** An assistant turn: markdown body (or an API-error note when the turn failed
 *  empty), the per-turn model/cost header, and its nested tool calls. */
function AssistantTurn({
  message,
  time,
  view,
  effortChanged,
}: {
  message: TranscriptMessage;
  time: string;
  view: TranscriptView;
  effortChanged: boolean;
}) {
  const text = message.text ?? "";
  const errorOnly = message.isApiError && text.trim() === "";

  return (
    <article className="turn">
      <div className="turn-head">
        <span className="microlabel" style={{ color: "var(--agent)" }}>
          Assistant
        </span>
        {message.model && <span className="model">{message.model}</span>}
        {/* Only on a turn that CHANGED effort (a mid-conversation `/effort`
            flip); the pane's header stat covers the steady state. */}
        {effortChanged && message.effort && (
          <span className="badge-effort">{message.effort} effort</span>
        )}
        {message.isApiError && <span className="badge-err">API error</span>}
        <span className="spacer" />
        {time && <span className="call-meta num">{time}</span>}
        <span className="cost num turn-cost">{formatCost(message.costUsd)}</span>
      </div>

      <div className="turn-body">
        {errorOnly ? (
          <p className="api-error-note">
            turn failed{message.apiErrorMessage ? ` — ${message.apiErrorMessage}` : ""}
          </p>
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
            />
          ))}
        </div>
      )}
    </article>
  );
}
