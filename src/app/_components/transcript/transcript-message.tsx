import { formatClock, formatCost } from "@/app/_lib/format";
import { parseSlashCommand } from "@/app/_lib/transcript";
import { messageAnchorId } from "@/app/_lib/transcript-url";
import type { TranscriptMessage, TranscriptView } from "@/core/read";

import { TranscriptToolCallRow } from "./transcript-tool-call";
import { TurnMarkdown } from "./turn-markdown";

export function TranscriptMessageRow({
  message,
  view,
  effortChanged,
  anchoredCall,
  anchoredMessage,
}: {
  message: TranscriptMessage;
  view: TranscriptView;
  anchoredCall?: string;
  anchoredMessage?: string;
  effortChanged: boolean;
}) {
  const time = formatClock(message.timestamp);
  const anchor = anchorProps(message, anchoredMessage);

  if (message.role === "user") {
    return <PromptRow message={message} time={time} anchor={anchor} />;
  }
  return (
    <AssistantTurn
      message={message}
      time={time}
      view={view}
      effortChanged={effortChanged}
      anchoredCall={anchoredCall}
      anchor={anchor}
    />
  );
}

type MessageAnchor = { id?: string; anchored: boolean };

function anchorProps(message: TranscriptMessage, anchoredMessage: string | undefined): MessageAnchor {
  if (message.uuid === null) return { anchored: false };
  return {
    id: messageAnchorId(message.uuid),
    anchored: message.uuid === anchoredMessage,
  };
}

function PromptRow({ message, time, anchor }: { message: TranscriptMessage; time: string; anchor: MessageAnchor }) {
  const parsed = parseSlashCommand(message.text);
  const commandLabel =
    parsed.commandName && !parsed.commandName.startsWith("/") ? `/${parsed.commandName}` : parsed.commandName;
  const args = parsed.commandArgs ?? parsed.rest;

  return (
    <article id={anchor.id} className={anchor.anchored ? "prompt anchored" : "prompt"}>
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

function AssistantTurn({
  message,
  time,
  view,
  effortChanged,
  anchoredCall,
  anchor,
}: {
  message: TranscriptMessage;
  time: string;
  view: TranscriptView;
  effortChanged: boolean;
  anchoredCall?: string;
  anchor: MessageAnchor;
}) {
  const text = message.text ?? "";
  const errorOnly = message.isApiError && text.trim() === "";

  return (
    <article id={anchor.id} className={anchor.anchored ? "turn anchored" : "turn"}>
      <div className="turn-head">
        <span className="microlabel" style={{ color: "var(--agent)" }}>
          Assistant
        </span>
        {message.model && <span className="model">{message.model}</span>}
        {effortChanged && message.effort && <span className="badge-effort">{message.effort} effort</span>}
        {message.isApiError && <span className="badge-err">API error</span>}
        <span className="spacer" />
        {time && <span className="call-meta num">{time}</span>}
        <span className="cost num turn-cost">{formatCost(message.costUsd)}</span>
      </div>

      <div className="turn-body">
        {errorOnly ? (
          <p className="api-error-note">turn failed{message.apiErrorMessage ? ` — ${message.apiErrorMessage}` : ""}</p>
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
              anchoredCall={anchoredCall}
            />
          ))}
        </div>
      )}
    </article>
  );
}
