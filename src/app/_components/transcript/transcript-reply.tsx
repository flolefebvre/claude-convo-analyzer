// A Reply (GLOSSARY.md) on the Rail: one avatar and one header for the Turns
// the Agent ran in answer to one Message, each Turn keeping its own dot on the
// rail and its own marker line.

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import {
  formatClock,
  formatClockRange,
  formatCount,
  formatFailedAttempts,
  formatLatency,
  formatModelName,
} from "@/app/_lib/format";
import type { AgentLabel, TranscriptExport } from "@/app/_lib/transcript";
import {
  type FilteredTurn,
  type Fold,
  type HiddenTurnRun,
  hiddenTurnsLabel,
  toolCallCountLabel,
} from "@/app/_lib/transcript-filter";
import type { Reply } from "@/app/_lib/transcript-replies";
import type { TranscriptMessage, TranscriptView } from "@/core/read";

import { CopiedFrom } from "./copied-from";
import { SpeakerAvatar } from "./speaker-row";
import { TranscriptFold } from "./transcript-fold";
import { CostFigure, ErrorBadge, anchorProps } from "./transcript-parts";
import { TranscriptToolCallRow } from "./transcript-tool-call";
import { WhatWasSentPanel, WhatWasSentProvider, WhatWasSentTrigger } from "./transcript-what-was-sent";
import { TurnMarkdown } from "./turn-markdown";

/**
 * One Reply: the Agent's avatar in the speaker gutter with the rail running
 * down from it, a header — the speaker, `N turns · N tool calls`, the time
 * range and cost, or "copied from <owner>" when every Turn is copied — and its
 * Turns. Its figures describe the whole Reply, even when part of it lies on
 * another page; one begun on an earlier page says it continues from there.
 * Named by its header, so a Turn inside it is heard under its speaker. Its
 * Turns show as the Transcript filter leaves them (`items`): a run of Turns
 * left with nothing to show is one fold line, and the header still counts it.
 *
 * @example <TranscriptReply reply={entry.reply} items={entry.items} filterKey="11111" speaker="Assistant" view={view} labels={labels} agentModel={null} effortChangedIds={new Set()} />
 */
export function TranscriptReply({
  reply,
  items,
  filterKey,
  speaker,
  view,
  labels,
  agentModel,
  effortChangedIds,
  anchoredCall,
  anchoredMessage,
  listReturn,
  transcriptExport,
}: {
  reply: Reply;
  /** Its Turns under the Transcript filter, from `applyTranscriptFilter`. */
  items: (FilteredTurn | HiddenTurnRun)[];
  /** The Transcript filter's `transcriptFilterKey`: its fold lines are keyed on it. */
  filterKey: string;
  /** The Agent whose Transcript this is: "Assistant" on the Main thread, else its own label. */
  speaker: string;
  view: TranscriptView;
  /** Every agent's display name, for the Agent calls' spawned-agent names and the copied-from owner. */
  labels: Map<string, AgentLabel>;
  /** The model this agent runs on: a Turn names its model only when it differs. */
  agentModel: string | null;
  /** The Turns whose effort differs from the previous effort-carrying Turn's. */
  effortChangedIds: Set<number>;
  /** The `?call=` deep-link target, threaded down to the tool calls. */
  anchoredCall?: string;
  /** The `?msg=` deep-link target: the Turn it names is highlighted. */
  anchoredMessage?: string;
  /** The list view this transcript was opened from (`?from=`), carried on every link to another transcript. */
  listReturn?: string;
  /** Set in the Conversation export: Tool call bodies inlined, agent links to their sections of the file, no What was sent. */
  transcriptExport?: TranscriptExport;
}) {
  const { figures } = reply;
  const headId = `reply-${reply.turns[0]?.id ?? 0}`;
  const isWhollyCopied = figures.turnCount > 0 && figures.copiedTurnCount === figures.turnCount;
  // A wholly copied Reply names its owner once, in its header, by its first Turn whose owner is known.
  const ownerNamingTurn = isWhollyCopied ? reply.turns.find((turn) => turn.copiedFrom !== null) : undefined;
  const copiedFrom = (message: TranscriptMessage) =>
    message.copiedFrom && (
      <CopiedFrom
        owner={message.copiedFrom}
        sessionId={view.sessionId}
        rootAgentId={view.tree.id}
        labels={labels}
        listReturn={listReturn}
        agentLinksAreInFile={transcriptExport !== undefined}
      />
    );
  const timeRange = formatClockRange(figures.startedAt, figures.endedAt);

  return (
    <div
      role="group"
      aria-labelledby={`${headId}-who ${headId}-figures`}
      className={isWhollyCopied ? "row reply is-copied" : "row reply"}
    >
      <div className="gutter">
        <SpeakerAvatar speaker="assistant" />
      </div>
      <div className="row-main">
        <div className="row-head">
          <span id={`${headId}-who`} className="speaker">
            {speaker}
          </span>
          <span id={`${headId}-figures`} className="row-note">
            {formatCount(figures.turnCount)} turn{figures.turnCount === 1 ? "" : "s"} ·{" "}
            {formatCount(figures.toolCallCount)} tool call{figures.toolCallCount === 1 ? "" : "s"}
            {reply.continuesFromPreviousPage && " · continues from the previous page"}
          </span>
          <span className="spacer" />
          {ownerNamingTurn !== undefined ? (
            copiedFrom(ownerNamingTurn)
          ) : (
            <>
              {timeRange && (
                <span className="row-time">
                  <time dateTime={figures.startedAt ?? undefined}>{timeRange}</time>
                </span>
              )}
              <CostFigure usd={figures.costUsd} lowerBound={figures.unpriced} />
            </>
          )}
        </div>
        <div className="turns">
          {items.map((item) => {
            const replyTurn = ({ turn, showsThinking, showsWhatWasSent, toolCallsFold }: FilteredTurn) => (
              <ReplyTurn
                key={turn.id}
                message={turn}
                showsThinking={showsThinking}
                showsWhatWasSent={showsWhatWasSent}
                toolCallsFold={toolCallsFold}
                filterKey={filterKey}
                view={view}
                labels={labels}
                agentModel={agentModel}
                effortChanged={effortChangedIds.has(turn.id)}
                anchoredCall={anchoredCall}
                anchoredMessage={anchoredMessage}
                listReturn={listReturn}
                transcriptExport={transcriptExport}
                copiedFrom={isWhollyCopied ? null : copiedFrom(turn)}
              />
            );
            if (item.kind === "turn") return replyTurn(item);
            return (
              <TranscriptFold
                key={`hidden-${item.turns[0]?.turn.id}-${filterKey}`}
                label={hiddenTurnsLabel({ turnCount: item.turns.length, toolCallCount: item.toolCallCount })}
                layout="inline"
                isInitiallyRevealed={item.isRevealed}
              >
                {item.turns.map(replyTurn)}
              </TranscriptFold>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** One Turn of a Reply: its dot on the rail, its marker line, its thinking, its text (or the API error when it failed), its tool calls — or the fold line standing in for them — and, when the logs hold its own API request, what that request sent, opened from the marker line. */
function ReplyTurn({
  message,
  showsThinking,
  showsWhatWasSent,
  toolCallsFold,
  filterKey,
  view,
  labels,
  agentModel,
  effortChanged,
  anchoredCall,
  anchoredMessage,
  listReturn,
  transcriptExport,
  copiedFrom,
}: {
  message: TranscriptMessage;
  showsThinking: boolean;
  showsWhatWasSent: boolean;
  /** The fold line standing in for its hidden Tool calls; null when they show. */
  toolCallsFold: Fold | null;
  filterKey: string;
  view: TranscriptView;
  labels: Map<string, AgentLabel>;
  agentModel: string | null;
  effortChanged: boolean;
  anchoredCall: string | undefined;
  anchoredMessage: string | undefined;
  listReturn: string | undefined;
  transcriptExport: TranscriptExport | undefined;
  /** The marker of a copied Turn in a partly copied Reply, in its cost's place; null otherwise. */
  copiedFrom: ReactNode;
}) {
  const time = formatClock(message.timestamp);
  // The export holds every Agent's transcript in one document, where a copied
  // Turn repeats its owner's uuid and `tool_use` ids: only the owner's
  // rendering carries the anchors, so each lands on the owner (ADR-0011).
  const isAnchorTarget = transcriptExport === undefined || message.copiedFrom === null;
  const anchor = anchorProps(message, anchoredMessage, isAnchorTarget);
  const text = message.text ?? "";
  const errorOnly = message.isApiError && text.trim() === "";
  const name = `Turn ${message.turnNumber ?? ""}`.trim();
  const className = ["turn", message.isApiError && "is-failed", anchor.anchored && "anchored"]
    .filter(Boolean)
    .join(" ");
  // The export leaves What was sent out: it holds the user's CLAUDE.md files,
  // environment and system prompt. A copied Turn's request is its owner's.
  const whatWasSentRequestId =
    transcriptExport === undefined && message.copiedFrom === null && showsWhatWasSent ? message.apiRequestId : null;
  const toolCalls = message.toolCalls.length > 0 && (
    <div className="calls">
      {message.toolCalls.map((call) => (
        <TranscriptToolCallRow
          key={call.id}
          call={call}
          messageId={message.id}
          isAnchorTarget={isAnchorTarget}
          view={view}
          labels={labels}
          anchoredCall={anchoredCall}
          listReturn={listReturn}
          transcriptExport={transcriptExport}
        />
      ))}
    </div>
  );

  const content = (
    <>
      <div className="turn-marker">
        <span className="turn-number">{name}</span>
        {time && (
          <time className="row-time" dateTime={message.timestamp ?? undefined}>
            {time}
          </time>
        )}
        {copiedFrom || <TurnCost message={message} />}
        {message.model && message.model !== agentModel && (
          <span className="chip is-model" title={message.model}>
            {formatModelName(message.model)}
          </span>
        )}
        {/* Only on a Turn that CHANGED effort (a mid-conversation `/effort`
            flip); the pane's header stat covers the steady state. */}
        {effortChanged && message.effort && <span className="chip">{message.effort} effort</span>}
        {message.isApiError && <ErrorBadge title={message.apiErrorMessage ?? undefined}>API error</ErrorBadge>}
        {message.failedAttemptCount > 0 && (
          <span className="chip">{formatFailedAttempts(message.failedAttemptCount, message.failedAttemptsLostMs)}</span>
        )}
        {whatWasSentRequestId !== null && <WhatWasSentTrigger />}
      </div>

      <div className="turn-body">
        {showsThinking && <ThinkingLine text={message.thinkingText} durationMs={message.thinkingDurationMs} />}
        {errorOnly ? (
          <p className="api-error-note">Turn failed{message.apiErrorMessage ? `: ${message.apiErrorMessage}` : "."}</p>
        ) : (
          <TurnMarkdown text={text} />
        )}
      </div>

      {toolCallsFold === null ? (
        toolCalls
      ) : (
        <TranscriptFold
          key={`calls-${filterKey}`}
          label={toolCallCountLabel(message.toolCalls.length)}
          layout="inline"
          isInitiallyRevealed={toolCallsFold.isRevealed}
        >
          {toolCalls}
        </TranscriptFold>
      )}

      {whatWasSentRequestId !== null && <WhatWasSentPanel />}
    </>
  );

  return (
    <article id={anchor.id} className={className} aria-label={time ? `${name}, ${time}` : name}>
      {whatWasSentRequestId === null ? (
        content
      ) : (
        <WhatWasSentProvider apiRequestId={whatWasSentRequestId}>{content}</WhatWasSentProvider>
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

/**
 * The Turn's own cost, or "unpriced" for a model without a known price; nothing
 * on a copy whose Turn another occurrence owns (it has no tokens of its own).
 */
function TurnCost({ message }: { message: TranscriptMessage }) {
  if (message.tokens === null) return null;
  if (message.unpriced) {
    return (
      <span className="turn-cost is-unpriced" title="No known price for this model: counted as $0 in every total.">
        unpriced
      </span>
    );
  }
  return <CostFigure usd={message.costUsd} lowerBound={false} className="turn-cost" />;
}
