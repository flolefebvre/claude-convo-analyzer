"use client";

// The "What was sent" disclosure of one Turn. The page ships only where to
// read it — the `api_request` row id of the Turn's API request in the
// logs — and the Turn's failed-attempt count and lost time; what it sent is
// fetched from `GET /api/api-request/<id>` the first time the reader
// opens it, and kept for every later open. Native `<details>` stays the
// disclosure, as for tool calls. Under the request's facts, a switch picks the
// view: Changes (what this request added), Request (all of it, by part) or Raw
// (its JSON, fetched from the route's `/raw` sibling the first time Raw
// opens). A message the logs could not rebuild is shown missing at its place,
// and counted.
//
// ADR-0002: no core import — the payload comes over the route, its types from
// the core-free `_lib/transcript`.

import { callRoute } from "@flefebvre/next-pipe/client";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { CopyButton } from "@/app/_components/copy-button";
import { JsonTree } from "@/app/_components/json-tree";
import { formatLatency } from "@/app/_lib/format";
import type {
  DiffLine,
  FailedAttempt,
  RawApiRequest,
  SentBlock,
  SentMessage,
  SentTool,
  WhatWasSent,
} from "@/app/_lib/transcript";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { routes } from "@/generated/routes";

import { type ReadOnFirstOpenState, useReadOnFirstOpen } from "./use-read-on-first-open";

/** The +/− marker of a diff line, so a change never reads by colour alone. */
const MARKER_BY_CHANGE: Record<DiffLine["change"], string> = { added: "+", removed: "-", unchanged: " " };

/** How many lines of a block show before it is clamped behind "Show all N lines". */
const BLOCK_CLAMP_LINES = 15;
/** How many characters of a block show, when its lines do not overflow, before it is clamped behind "Show all N characters". */
const BLOCK_CLAMP_CHARS = 2_000;

/**
 * A Turn's "What was sent" `<details>`, fetched on the first open from its API
 * request in the logs, `apiRequestId`; its summary counts the Turn's
 * failed attempts and the time they lost, which the page ships.
 *
 * @example
 * {message.apiRequestId !== null && (
 *   <WhatWasSentDisclosure
 *     apiRequestId={message.apiRequestId}
 *     failedAttemptCount={message.failedAttemptCount}
 *     failedAttemptsLostMs={message.failedAttemptsLostMs}
 *   />
 * )}
 */
export function WhatWasSentDisclosure({
  apiRequestId,
  failedAttemptCount,
  failedAttemptsLostMs,
}: {
  apiRequestId: number;
  failedAttemptCount: number;
  /** The time the failed attempts lost in all; null when unknown, or without any. */
  failedAttemptsLostMs: number | null;
}) {
  const { state, onToggle, detailsRef } = useReadOnFirstOpen<WhatWasSent>(() =>
    callRoute(routes.api["api-request"](String(apiRequestId)).GET()),
  );

  return (
    <details ref={detailsRef} className="call sent" onToggle={onToggle}>
      <summary>
        <ChevronRight aria-hidden className="chev" />
        <span className="call-name">What was sent</span>
        {failedAttemptCount > 0 && (
          <span className="call-meta">
            {failedAttemptCountLabel(failedAttemptCount)}
            {failedAttemptsLostMs !== null && ` · lost ${formatLatency(failedAttemptsLostMs)}`}
          </span>
        )}
      </summary>
      <div className="call-body sent-body">
        <ReadBody state={state} subject="what was sent">
          {(whatWasSent) => <WhatWasSentView whatWasSent={whatWasSent} apiRequestId={apiRequestId} />}
        </ReadBody>
      </div>
    </details>
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

/** "1 failed attempt", "2 failed attempts". */
function failedAttemptCountLabel(failedAttemptCount: number): string {
  return `${failedAttemptCount} failed attempt${failedAttemptCount === 1 ? "" : "s"}`;
}

/** "1 message", "3 system blocks": `count`, then `noun`, plural past one. */
function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The request's facts and failed attempts, then the switch between its three views. */
function WhatWasSentView({ whatWasSent, apiRequestId }: { whatWasSent: WhatWasSent; apiRequestId: number }) {
  // Held here, not in the Raw view, which unmounts with its tab: switching away and back reads nothing again.
  const raw = useReadOnFirstOpen<RawApiRequest>(() =>
    callRoute(routes.api["api-request"](String(apiRequestId)).raw.GET()),
  );
  const { failedAttempts, missingMessageCount, fullRequest } = whatWasSent;
  return (
    <>
      <Facts whatWasSent={whatWasSent} />

      {missingMessageCount > 0 && (
        <p className="sent-line">
          {missingMessageCount} of {countLabel(fullRequest.messages.length, "message")} could not be rebuilt from the
          logs.
        </p>
      )}

      {failedAttempts.length > 0 && (
        <section className="sent-section">
          <h4 className="io-label">{failedAttemptCountLabel(failedAttempts.length)} before this request</h4>
          {failedAttempts.map((attempt, index) => (
            <FailedAttemptLine key={index} attempt={attempt} />
          ))}
        </section>
      )}

      <Tabs
        defaultValue="changes"
        className="sent-views"
        onValueChange={(view) => {
          if (view === "raw") raw.startReading();
        }}
      >
        <TabsList aria-label="View of what was sent" className="sent-tab-list">
          <TabsTrigger value="changes" className="sent-tab">
            Changes
          </TabsTrigger>
          <TabsTrigger value="request" className="sent-tab">
            Request
          </TabsTrigger>
          <TabsTrigger value="raw" className="sent-tab">
            Raw
          </TabsTrigger>
        </TabsList>
        <TabsContent value="changes" className="sent-view">
          <ChangesView whatWasSent={whatWasSent} />
        </TabsContent>
        <TabsContent value="request" className="sent-view">
          <RequestView whatWasSent={whatWasSent} />
        </TabsContent>
        <TabsContent value="raw" className="sent-view">
          <ReadBody state={raw.state} subject="the raw request">
            {(rawApiRequest) => <RawView rawApiRequest={rawApiRequest} />}
          </ReadBody>
        </TabsContent>
      </Tabs>
    </>
  );
}

/** The request parameters, as a key/value grid; the betas as a count that expands to their list. */
function Facts({ whatWasSent }: { whatWasSent: WhatWasSent }) {
  const { parameters } = whatWasSent;
  const facts: [string, React.ReactNode][] = [
    ["model", parameters.model],
    ["max_tokens", parameters.maxTokens],
    ["thinking", parameters.thinking],
    ["effort", parameters.effort],
    [
      "betas",
      parameters.betas.length > 0 && (
        <details className="sent-betas">
          <summary>
            <ChevronRight aria-hidden className="chev" />
            {countLabel(parameters.betas.length, "beta")}
          </summary>
          <ul>
            {parameters.betas.map((beta) => (
              <li key={beta}>
                <code>{beta}</code>
              </li>
            ))}
          </ul>
        </details>
      ),
    ],
  ];
  return (
    <dl className="sent-facts">
      {facts
        .filter(([, value]) => value !== null && value !== false)
        .map(([name, value]) => (
          <div key={name} className="sent-fact">
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

/** One failed attempt, as one line: the time it lost when known — an em dash when not, so the line still counts it. */
function FailedAttemptLine({ attempt }: { attempt: FailedAttempt }) {
  return <p className="sent-line">{attempt.lostMs === null ? "—" : `lost ${formatLatency(attempt.lostMs)}`}</p>;
}

/**
 * What this request added: its new messages, then how the system prompt and
 * the tool definitions changed — one "unchanged" line each when they did not.
 * Without a previous request everything is new, so there is nothing to compare.
 */
function ChangesView({ whatWasSent }: { whatWasSent: WhatWasSent }) {
  const { firstNewMessageIndex, previousApiRequestId, systemPromptDiff, toolsDiff, fullRequest } = whatWasSent;
  const hasPreviousRequest = previousApiRequestId !== null;
  return (
    <>
      <NewMessages
        newMessages={fullRequest.messages.slice(firstNewMessageIndex)}
        hasPreviousRequest={hasPreviousRequest}
      />

      {systemPromptDiff ? (
        <section className="sent-section">
          <h4 className="io-label">
            {systemPromptDiff.isVolatileOnly
              ? "System prompt: only volatile changes (dates, git status, working directory)"
              : "System prompt changed"}
          </h4>
          <Diff hunks={systemPromptDiff.hunks} />
        </section>
      ) : (
        hasPreviousRequest && <p className="sent-line">System prompt: unchanged</p>
      )}

      {toolsDiff ? (
        <section className="sent-section">
          <h4 className="io-label">Tool definitions changed</h4>
          {toolsDiff.added.length > 0 && <ToolNames label="Added" tools={toolsDiff.added} />}
          {toolsDiff.removed.length > 0 && <ToolNames label="Removed" tools={toolsDiff.removed} />}
          {toolsDiff.changed.map((tool) => (
            <div key={tool.name} className="sent-tool-change">
              <p className="sent-line">
                Changed <code>{tool.name}</code>: {tool.changedFields.join(" and ")}
              </p>
              <Diff hunks={tool.hunks} />
            </div>
          ))}
        </section>
      ) : (
        hasPreviousRequest && <p className="sent-line">Tool definitions: unchanged</p>
      )}
    </>
  );
}

/** The messages new since the previous API request, under a heading saying what they are new against. */
function NewMessages({
  newMessages,
  hasPreviousRequest,
}: {
  newMessages: (SentMessage | null)[];
  hasPreviousRequest: boolean;
}) {
  const messageCount = countLabel(newMessages.length, "message");
  return (
    <section className="sent-section">
      <h4 className="io-label">
        {hasPreviousRequest
          ? `New since the previous API request (${messageCount})`
          : `No earlier API request of this Agent: every message is new (${messageCount})`}
      </h4>
      {newMessages.map((message, index) => (
        <MessageBlocks key={index} message={message} />
      ))}
    </section>
  );
}

/** The whole request by part: its parameters, system blocks, tool definitions and every message. */
function RequestView({ whatWasSent }: { whatWasSent: WhatWasSent }) {
  const { systemBlocks, tools, messages, parameterByName } = whatWasSent.fullRequest;
  return (
    <>
      <section className="sent-section">
        <h4 className="io-label">Parameters</h4>
        <JsonTree value={parameterByName} />
      </section>
      <section className="sent-section">
        <h4 className="io-label">System prompt ({countLabel(systemBlocks.length, "block")})</h4>
        {systemBlocks.map((block, index) => (
          <div key={index}>
            <BlockView block={block} />
            {block.cacheControl && <p className="sent-breakpoint">Cache breakpoint: {block.cacheControl}</p>}
          </div>
        ))}
      </section>
      <section className="sent-section">
        <h4 className="io-label">Tools ({countLabel(tools.length, "tool")})</h4>
        {tools.map((tool) => (
          <details key={tool.name} className="sent-tool">
            <summary>
              <ChevronRight aria-hidden className="chev" />
              <code>{tool.name}</code>
            </summary>
            <pre className="sent-pre">{tool.definitionJson}</pre>
          </details>
        ))}
      </section>
      <section className="sent-section">
        <h4 className="io-label">Messages ({countLabel(messages.length, "message")})</h4>
        {messages.map((message, index) => (
          <MessageBlocks key={index} message={message} />
        ))}
      </section>
    </>
  );
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

/** A message by its role and blocks; one the logs could not rebuild (null), as a line saying so, at its place. */
function MessageBlocks({ message }: { message: SentMessage | null }) {
  if (message === null) {
    return (
      <div className="sent-message">
        <p className="sent-line">A message the logs could not rebuild.</p>
      </div>
    );
  }
  return (
    <div className="sent-message">
      <span className="sent-role">{message.role}</span>
      {message.blocks.map((block, index) => (
        <BlockView key={index} block={block} />
      ))}
    </div>
  );
}

/** A block under its kind label, as plain text: text as sent, any other block as its pretty-printed JSON. */
function BlockView({ block }: { block: SentBlock }) {
  return (
    <div className="sent-block">
      <span className={`sent-kind is-${block.kind}`}>{block.kind}</span>
      <ClampedText text={block.shownAs === "text" ? block.text : block.json} />
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

function ToolNames({ label, tools }: { label: string; tools: SentTool[] }) {
  return (
    <p className="sent-line">
      {label}:{" "}
      {tools.map((tool, index) => (
        <span key={tool.name}>
          {index > 0 && ", "}
          <code>{tool.name}</code>
        </span>
      ))}
    </p>
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
