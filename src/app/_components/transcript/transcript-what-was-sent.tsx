"use client";

// The "What was sent" disclosure of one Turn: a button on its marker line
// opening a panel under the Turn. The page ships only where to read it — the
// `api_request` row id of the Turn's API request in the logs; what it sent is
// fetched from `GET /api/api-request/<id>` the first time the reader opens it,
// and kept for every later open. Under the parameters line, the request reads
// in the order the model read it: the system prompt, the tools, the earlier
// messages as a count, then each part new for this Turn, every row one
// summary line that opens for detail. The "Raw JSON" toggle swaps all of it
// for the request body, fetched from the route's `/raw` sibling the first
// time it is pressed. A message the logs could not rebuild is shown missing
// at its place, and counted.
//
// ADR-0002: no core import — the payload comes over the route, its types from
// the core-free `_lib/transcript`.

import { callRoute } from "@flefebvre/next-pipe/client";
import { ChevronRight, Send } from "lucide-react";
import { createContext, use, useId, useState } from "react";

import { CopyButton } from "@/app/_components/copy-button";
import { JsonTree } from "@/app/_components/json-tree";
import { formatBytes, formatClock, formatCompactTokens, formatFailedAttempts, formatLatency } from "@/app/_lib/format";
import type { DiffLine, FailedAttempt, RawApiRequest, SentMessage, SentTool, WhatWasSent } from "@/app/_lib/transcript";
import { Skeleton } from "@/components/ui/skeleton";
import { routes } from "@/generated/routes";

import { type ReadOnFirstOpenState, useReadOnFirstOpen } from "./use-read-on-first-open";

/** The +/− marker of a diff line, so a change never reads by colour alone. */
const MARKER_BY_CHANGE: Record<DiffLine["change"], string> = { added: "+", removed: "-", unchanged: " " };

/** How many lines of a block show before it is clamped behind "Show all N lines". */
const BLOCK_CLAMP_LINES = 15;
/** How many characters of a block show, when its lines do not overflow, before it is clamped behind "Show all N characters". */
const BLOCK_CLAMP_CHARS = 2_000;

/** What a Turn's What was sent trigger and panel share: whether it is open, and its read. */
type WhatWasSentDisclosure = {
  apiRequestId: number;
  panelId: string;
  isOpen: boolean;
  toggle: () => void;
  state: ReadOnFirstOpenState<WhatWasSent>;
};

const WhatWasSentDisclosureContext = createContext<WhatWasSentDisclosure | null>(null);

function useWhatWasSentDisclosure(): WhatWasSentDisclosure {
  const disclosure = use(WhatWasSentDisclosureContext);
  if (disclosure === null) throw new Error("What was sent's trigger and panel render inside a WhatWasSentProvider");
  return disclosure;
}

/**
 * The open state and lazy read of one Turn's What was sent, shared by its
 * {@link WhatWasSentTrigger} on the marker line and its
 * {@link WhatWasSentPanel} under the Turn, both somewhere in the
 * server-rendered `children`. The read of `apiRequestId` starts on the first
 * open and is kept for every later one.
 *
 * @example <WhatWasSentProvider apiRequestId={message.apiRequestId}>{markerLine}{body}<WhatWasSentPanel /></WhatWasSentProvider>
 */
export function WhatWasSentProvider({ apiRequestId, children }: { apiRequestId: number; children: React.ReactNode }) {
  const panelId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const { state, startReading } = useReadOnFirstOpen<WhatWasSent>(() =>
    callRoute(routes.api["api-request"](String(apiRequestId)).GET()),
  );
  const disclosure: WhatWasSentDisclosure = {
    apiRequestId,
    panelId,
    isOpen,
    state,
    toggle() {
      if (!isOpen) startReading();
      setIsOpen(!isOpen);
    },
  };
  return <WhatWasSentDisclosureContext value={disclosure}>{children}</WhatWasSentDisclosureContext>;
}

/**
 * The "What was sent" button on a Turn's marker line, opening and closing the
 * Turn's {@link WhatWasSentPanel}.
 *
 * @example <WhatWasSentTrigger />
 */
export function WhatWasSentTrigger() {
  const { panelId, isOpen, toggle } = useWhatWasSentDisclosure();
  return (
    <button type="button" className="sent-trigger" aria-expanded={isOpen} aria-controls={panelId} onClick={toggle}>
      <Send aria-hidden />
      What was sent
    </button>
  );
}

/**
 * Under a Turn, what its API request sent, while its {@link WhatWasSentTrigger}
 * holds it open. Kept mounted when closed, so what the reader opened inside it
 * is still open on the next opening.
 *
 * @example <WhatWasSentPanel />
 */
export function WhatWasSentPanel() {
  const { apiRequestId, panelId, isOpen, state } = useWhatWasSentDisclosure();
  return (
    <div id={panelId} role="group" aria-label="What was sent" className="sent-panel" hidden={!isOpen}>
      <ReadBody state={state} subject="what was sent">
        {(whatWasSent) => <WhatWasSentView whatWasSent={whatWasSent} apiRequestId={apiRequestId} />}
      </ReadBody>
    </div>
  );
}

/** What a lazy read shows: nothing yet, a skeleton, why it could not load, or `children` of what it read. */
function ReadBody<Value>({
  state,
  subject,
  children,
}: {
  state: ReadOnFirstOpenState<Value>;
  /** What is read, in the sentence of its loading label and failure notes. */
  subject: string;
  children: (value: Value) => React.ReactNode;
}) {
  switch (state.status) {
    case "idle":
      return null;
    case "loading":
      return (
        <div role="status" aria-label={`Loading ${subject}`} className="flex flex-col gap-2.5">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-16 w-full" />
        </div>
      );
    case "stale":
      return <p className="call-body-note">This transcript changed since the page loaded — reload to see {subject}.</p>;
    case "failed":
      return <p className="call-body-note">Couldn&rsquo;t load {subject} — try again.</p>;
    case "loaded":
      return children(state.value);
  }
}

/** "1 message", "3 system blocks": `count`, then `noun`, plural past one. */
function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The parameters line with its Raw JSON toggle, the failed attempts and the
 * rebuild gaps, then the request in reading order — or, toggled, its body as JSON.
 */
function WhatWasSentView({ whatWasSent, apiRequestId }: { whatWasSent: WhatWasSent; apiRequestId: number }) {
  // Held here, not in the Raw view, which unmounts when toggled off: toggling back reads nothing again.
  const raw = useReadOnFirstOpen<RawApiRequest>(() =>
    callRoute(routes.api["api-request"](String(apiRequestId)).raw.GET()),
  );
  const [isRawShown, setIsRawShown] = useState(false);
  const { failedAttempts, missingMessageCount, fullRequest } = whatWasSent;
  return (
    <>
      <div className="sent-head">
        <p className="sent-parameters">{parameterLineOf(whatWasSent)}</p>
        <button
          type="button"
          className="io-raw-toggle"
          aria-pressed={isRawShown}
          onClick={() => {
            if (!isRawShown) raw.startReading();
            setIsRawShown(!isRawShown);
          }}
        >
          Raw JSON
        </button>
      </div>

      {missingMessageCount > 0 && (
        <p className="sent-line">
          {missingMessageCount} of {countLabel(fullRequest.messages.length, "message")} could not be rebuilt from the
          logs.
        </p>
      )}

      {failedAttempts.length > 0 && (
        <section className="sent-section">
          <h4 className="io-label">{formatFailedAttempts(failedAttempts.length, null)} before this request</h4>
          {failedAttempts.map((attempt, index) => (
            <FailedAttemptLine key={index} attempt={attempt} />
          ))}
        </section>
      )}

      {isRawShown ? (
        <ReadBody state={raw.state} subject="the raw request">
          {(rawApiRequest) => <RawView rawApiRequest={rawApiRequest} />}
        </ReadBody>
      ) : (
        <RequestInReadingOrder whatWasSent={whatWasSent} />
      )}
    </>
  );
}

/** "claude-opus-5-5 · effort high · max 32K tokens · thinking (adaptive) · 3 cache breakpoints · 2 betas · sent 14:02": each part the request has. */
function parameterLineOf({ parameters, sentAt }: WhatWasSent): string {
  const sentClock = formatClock(sentAt);
  return [
    parameters.model,
    parameters.effort !== null && `effort ${parameters.effort}`,
    parameters.maxTokens !== null && `max ${formatCompactTokens(parameters.maxTokens)} tokens`,
    // Its text joins its own fields with " · ": bracketed, it stays one part of the line.
    parameters.thinking !== null && `thinking (${parameters.thinking})`,
    parameters.cacheBreakpointCount > 0 && countLabel(parameters.cacheBreakpointCount, "cache breakpoint"),
    parameters.betas.length > 0 && countLabel(parameters.betas.length, "beta"),
    sentClock !== "" && `sent ${sentClock}`,
  ]
    .filter((part) => typeof part === "string")
    .join(" · ");
}

/** One failed attempt, as one line: the time it lost when known — an em dash when not, so the line still counts it. */
function FailedAttemptLine({ attempt }: { attempt: FailedAttempt }) {
  return <p className="sent-line">{attempt.lostMs === null ? "—" : `lost ${formatLatency(attempt.lostMs)}`}</p>;
}

/**
 * The request in the order the model read it: the system prompt, the tools,
 * how many earlier messages it repeated, then each part of the messages new
 * for this Turn. On the Agent's first request every message is new.
 */
function RequestInReadingOrder({ whatWasSent }: { whatWasSent: WhatWasSent }) {
  const { firstNewMessageIndex, previousApiRequestId, fullRequest } = whatWasSent;
  return (
    <div className="sent-rows">
      <SystemPromptRow whatWasSent={whatWasSent} />
      <ToolsRow whatWasSent={whatWasSent} />
      <p className="sent-row-static">
        {previousApiRequestId === null
          ? "First request of this Agent"
          : firstNewMessageIndex === 0
            ? "No earlier message shared with the previous request"
            : `${countLabel(firstNewMessageIndex, "earlier message")} · already sent with the previous request`}
      </p>
      <h4 className="sent-divider">New for this Turn</h4>
      {fullRequest.messages.slice(firstNewMessageIndex).map((message, index) => (
        <NewMessageRows key={index} message={message} />
      ))}
    </div>
  );
}

/**
 * The system prompt as one row: its block count and size, and how it changed
 * since the previous request — a badge for a real change, a muted note naming
 * what moved for a volatile one. It opens to its blocks in order, each with its
 * cache breakpoint; a changed one toggles to the diff.
 */
function SystemPromptRow({ whatWasSent }: { whatWasSent: WhatWasSent }) {
  const [isDiffShown, setIsDiffShown] = useState(false);
  const { systemPromptDiff, fullRequest } = whatWasSent;
  const { systemBlocks } = fullRequest;
  const systemText = systemBlocks.map((block) => (block.shownAs === "text" ? block.text : block.json)).join("\n");
  return (
    <details className="sent-row">
      <summary>
        <ChevronRight aria-hidden className="chev" />
        <span className="sent-row-name">System prompt</span>
        <span className="sent-row-meta">
          {countLabel(systemBlocks.length, "block")} · {formatBytes(new TextEncoder().encode(systemText).length)}
        </span>
        {systemPromptDiff &&
          (systemPromptDiff.isVolatileOnly ? (
            <span className="sent-row-note">volatile only: {listOf(systemPromptDiff.volatileChangeNames)} changed</span>
          ) : (
            <span className="sent-badge">changed since previous request</span>
          ))}
      </summary>
      <div className="sent-row-body">
        {systemPromptDiff && (
          <div className="sent-row-tools">
            <button
              type="button"
              className="io-raw-toggle"
              aria-pressed={isDiffShown}
              onClick={() => setIsDiffShown(!isDiffShown)}
            >
              Diff
            </button>
          </div>
        )}
        {systemPromptDiff && isDiffShown ? (
          <Diff hunks={systemPromptDiff.hunks} />
        ) : (
          systemBlocks.map((block, index) => (
            <div key={index}>
              <ClampedText text={block.shownAs === "text" ? block.text : block.json} />
              {block.cacheControl && <p className="sent-breakpoint">Cache breakpoint: {block.cacheControl}</p>}
            </div>
          ))
        )}
      </div>
    </details>
  );
}

/** "date", "date and git status", "date, working directory and git status". */
function listOf(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * The tools as one row: their count, and which were added, removed and
 * changed since the previous request. It opens to their names, each opening
 * to its definition, and a changed one's diff.
 */
function ToolsRow({ whatWasSent }: { whatWasSent: WhatWasSent }) {
  const { toolsDiff, fullRequest } = whatWasSent;
  const changedToolByName = new Map((toolsDiff?.changed ?? []).map((tool) => [tool.name, tool]));
  const addedToolNames = new Set((toolsDiff?.added ?? []).map((tool) => tool.name));
  return (
    <details className="sent-row">
      <summary>
        <ChevronRight aria-hidden className="chev" />
        <span className="sent-row-name">Tools</span>
        <span className="sent-row-meta">{fullRequest.tools.length}</span>
        {toolsDiff && toolsDiff.added.length > 0 && (
          <span className="sent-badge">
            +{toolsDiff.added.length} since previous: {toolNamesOf(toolsDiff.added)}
          </span>
        )}
        {toolsDiff && toolsDiff.removed.length > 0 && (
          <span className="sent-badge">
            −{toolsDiff.removed.length}: {toolNamesOf(toolsDiff.removed)}
          </span>
        )}
        {toolsDiff && toolsDiff.changed.length > 0 && (
          <span className="sent-badge">{toolsDiff.changed.length} changed</span>
        )}
      </summary>
      <div className="sent-row-body">
        {fullRequest.tools.map((tool) => {
          const changedTool = changedToolByName.get(tool.name);
          return (
            <details key={tool.name} className="sent-tool">
              <summary>
                <ChevronRight aria-hidden className="chev" />
                <code>{tool.name}</code>
                {addedToolNames.has(tool.name) && <span className="sent-row-note">added</span>}
                {changedTool && (
                  <span className="sent-row-note">changed: {changedTool.changedFields.join(" and ")}</span>
                )}
              </summary>
              <pre className="sent-pre">{tool.definitionJson}</pre>
              {changedTool && <Diff hunks={changedTool.hunks} />}
            </details>
          );
        })}
      </div>
    </details>
  );
}

function toolNamesOf(tools: SentTool[]): string {
  return tools.map((tool) => tool.name).join(", ");
}

/** The rows of one message new for this Turn: one per part, its label and preview, opening to its content as sent; one the logs could not rebuild, as a line saying so. */
function NewMessageRows({ message }: { message: SentMessage | null }) {
  if (message === null) return <p className="sent-row-static">A message the logs could not rebuild</p>;
  return message.parts.map((part, index) => (
    <details key={index} className="sent-row">
      <summary>
        <ChevronRight aria-hidden className="chev" />
        <span className={`sent-row-name sent-kind is-${part.kind}`}>{part.label}</span>
        <span className="sent-row-preview">{part.preview}</span>
      </summary>
      <div className="sent-row-body">
        <ClampedText text={part.shownAs === "text" ? part.text : part.json} />
      </div>
    </details>
  ));
}

/**
 * The API request's body as JSON, with a copy button, under what it lacks:
 * what the logs leave out, and the messages they could not rebuild.
 */
function RawView({ rawApiRequest }: { rawApiRequest: RawApiRequest }) {
  const { requestBody, missingMessageCount } = rawApiRequest;
  return (
    <div className="flex flex-col gap-2.5">
      <p className="sent-line">
        Rebuilt from the conversation log: it lacks the billing-header system block, <code>metadata</code> and{" "}
        <code>stream</code>
        {missingMessageCount > 0 &&
          `, and the ${countLabel(missingMessageCount, "message")} the logs could not rebuild`}
        .
      </p>
      <div className="sent-raw-toolbar">
        <CopyButton text={() => JSON.stringify(requestBody, null, 2)} label="Copy JSON" />
      </div>
      <JsonTree value={requestBody} />
    </div>
  );
}

/**
 * `text` in a block, clamped: past {@link BLOCK_CLAMP_LINES} lines, its first
 * lines with a "Show all N lines" toggle; else past {@link BLOCK_CLAMP_CHARS}
 * characters — a JSON block holds a tool result as one escaped line — its
 * first characters with a "Show all N characters" toggle.
 */
function ClampedText({ text }: { text: string }) {
  const [isShownWhole, setIsShownWhole] = useState(false);
  const lines = text.split("\n");
  const isClampedByLines = lines.length > BLOCK_CLAMP_LINES;
  const isClampedByChars = !isClampedByLines && text.length > BLOCK_CLAMP_CHARS;
  const clampedText = isClampedByLines
    ? lines.slice(0, BLOCK_CLAMP_LINES).join("\n")
    : isClampedByChars
      ? `${text.slice(0, BLOCK_CLAMP_CHARS)}…`
      : text;
  return (
    <div>
      <pre className="sent-pre">{isShownWhole ? text : clampedText}</pre>
      {(isClampedByLines || isClampedByChars) && (
        <button
          type="button"
          className="sent-clamp-toggle"
          aria-expanded={isShownWhole}
          onClick={() => setIsShownWhole(!isShownWhole)}
        >
          {isShownWhole
            ? "Show less"
            : isClampedByLines
              ? `Show all ${lines.length.toLocaleString("en-US")} lines`
              : `Show all ${text.length.toLocaleString("en-US")} characters`}
        </button>
      )}
    </div>
  );
}

/** A line diff: each hunk's lines, marked and coloured; a volatile changed line is muted. */
function Diff({ hunks }: { hunks: { lines: (DiffLine & { isVolatile?: boolean })[] }[] }) {
  return (
    <pre className="sent-pre sent-diff">
      {hunks.map((hunk, hunkIndex) => (
        <span key={hunkIndex} className="diff-hunk">
          {hunk.lines.map((line, lineIndex) => (
            <span
              key={lineIndex}
              className={["diff-line", `is-${line.change}`, line.isVolatile && "is-volatile"].filter(Boolean).join(" ")}
            >
              {MARKER_BY_CHANGE[line.change]} {line.text}
            </span>
          ))}
        </span>
      ))}
    </pre>
  );
}
