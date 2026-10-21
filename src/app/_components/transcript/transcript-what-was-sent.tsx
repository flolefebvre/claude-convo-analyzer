"use client";

// The "What was sent" disclosure of one Turn, or of one Side request. The page
// ships only where to read it — a `logged_api_request` row id for an API
// request the logs hold, else an `api_request` row id for one a Recording
// holds — and the Turn's failed-attempt count; what the API request sent is
// fetched from `GET /api/logged-api-request/<id>` or `GET /api/api-request/<id>`
// the first time the reader opens it, and kept for every later open. Native
// `<details>` stays the disclosure, as for tool calls. Under the request's
// facts, a switch picks the view: Changes (what this request added), Request
// (all of it, by part) or Raw (its JSON, fetched from the route's `/raw`
// sibling the first time Raw opens). What the logs do not keep — timings,
// failed attempts, headers, the response — is left out; a message they could
// not rebuild is shown missing at its place, and counted.
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
  JsonValue,
  RawApiRequest,
  SentBlock,
  SentMessage,
  SentTool,
  WhatWasSent,
  WhatWasSentSource,
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
 * A Turn's "What was sent" `<details>`, fetched on the first open from its
 * `source` — its API request in the logs, else in a Recording; its summary
 * counts the Turn's failed attempts, which the page ships.
 *
 * @example
 * {message.whatWasSentSource !== null && (
 *   <WhatWasSentDisclosure source={message.whatWasSentSource} failedAttemptCount={message.failedAttemptCount} />
 * )}
 */
export function WhatWasSentDisclosure({
  source,
  failedAttemptCount,
  isOpenInitially = false,
}: {
  source: WhatWasSentSource;
  failedAttemptCount: number;
  /** Rendered open, reading what was sent at once: a Side request's pane, which shows nothing else. */
  isOpenInitially?: boolean;
}) {
  const { state, onToggle, detailsRef } = useReadOnFirstOpen<WhatWasSent>(() =>
    source.from === "logs"
      ? callRoute(routes.api["logged-api-request"](String(source.loggedApiRequestId)).GET())
      : callRoute(routes.api["api-request"](String(source.apiRequestId)).GET()),
  );

  return (
    <details ref={detailsRef} className="call sent" onToggle={onToggle} open={isOpenInitially || undefined}>
      <summary>
        <ChevronRight aria-hidden className="chev" />
        <span className="call-name">What was sent</span>
        {failedAttemptCount > 0 && <span className="call-meta">{failedAttemptCountLabel(failedAttemptCount)}</span>}
      </summary>
      <div className="call-body sent-body">
        <ReadBody state={state} subject="what was sent">
          {(whatWasSent) => <WhatWasSentView whatWasSent={whatWasSent} source={source} />}
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
function WhatWasSentView({ whatWasSent, source }: { whatWasSent: WhatWasSent; source: WhatWasSentSource }) {
  // Held here, not in the Raw view, which unmounts with its tab: switching away and back reads nothing again.
  const raw = useReadOnFirstOpen<RawApiRequest>(() =>
    source.from === "logs"
      ? callRoute(routes.api["logged-api-request"](String(source.loggedApiRequestId)).raw.GET())
      : callRoute(routes.api["api-request"](String(source.apiRequestId)).raw.GET()),
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
            {(rawApiRequest) => <RawView rawApiRequest={rawApiRequest} source={source} />}
          </ReadBody>
        </TabsContent>
      </Tabs>
    </>
  );
}

/** The request parameters and timings, as a key/value grid; the betas as a count that expands to their list. */
function Facts({ whatWasSent }: { whatWasSent: WhatWasSent }) {
  const { parameters, timings } = whatWasSent;
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
    ["first byte", timings !== null && timings.timeToFirstByteMs !== null && formatLatency(timings.timeToFirstByteMs)],
    ["total", timings !== null && formatLatency(timings.durationMs)],
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

/** One failed attempt, as one line: its status, its error message and the time it lost. */
function FailedAttemptLine({ attempt }: { attempt: FailedAttempt }) {
  return (
    <p className="sent-line">
      <code>{attempt.status}</code> · {attempt.errorMessage ?? "no error message"} · lost{" "}
      {formatLatency(attempt.lostMs)}
    </p>
  );
}

/**
 * What this request added: its new messages, then how the system prompt and
 * the tool definitions changed — one "unchanged" line each when they did not.
 * Without a previous request everything is new, so there is nothing to compare.
 */
function ChangesView({ whatWasSent }: { whatWasSent: WhatWasSent }) {
  const { isSideRequest, firstNewMessageIndex, previousApiRequestId, systemPromptDiff, toolsDiff, fullRequest } =
    whatWasSent;
  const hasPreviousRequest = previousApiRequestId !== null;
  return (
    <>
      <NewMessages
        newMessages={fullRequest.messages.slice(firstNewMessageIndex)}
        isSideRequest={isSideRequest}
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
  isSideRequest,
  hasPreviousRequest,
}: {
  newMessages: (SentMessage | null)[];
  isSideRequest: boolean;
  hasPreviousRequest: boolean;
}) {
  const messageCount = countLabel(newMessages.length, "message");
  return (
    <section className="sent-section">
      <h4 className="io-label">
        {isSideRequest
          ? `Everything it sent (${messageCount})`
          : hasPreviousRequest
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

/** The parts of a raw API request, each a sub-tab, in order. */
const RAW_PARTS = [
  { value: "request-body", label: "Request body", valueOf: (raw: RawApiRequest): JsonValue => raw.requestBody },
  { value: "response-body", label: "Response body", valueOf: (raw: RawApiRequest): JsonValue => raw.responseBody },
  {
    value: "request-headers",
    label: "Request headers",
    valueOf: (raw: RawApiRequest): JsonValue => raw.requestHeaders,
  },
] as const;

/**
 * The API request as JSON: its request body, response body and request
 * headers, each a sub-tab with a copy button. An API request from the logs,
 * which keep no headers and no response, shows its request body alone, under
 * what it lacks: what the logs leave out, and the messages they could not rebuild.
 */
function RawView({ rawApiRequest, source }: { rawApiRequest: RawApiRequest; source: WhatWasSentSource }) {
  const parts = rawApiRequest.requestHeaders === null ? RAW_PARTS.slice(0, 1) : RAW_PARTS;
  const { missingMessageCount } = rawApiRequest;
  return (
    <Tabs defaultValue="request-body" className="sent-views">
      {source.from === "logs" && (
        <p className="sent-line">
          Rebuilt from the conversation log: it lacks the billing-header system block, <code>metadata</code> and{" "}
          <code>stream</code>
          {missingMessageCount > 0 &&
            `, and the ${countLabel(missingMessageCount, "message")} the logs could not rebuild`}
          .
        </p>
      )}
      <TabsList aria-label="Part of the raw request" className="sent-tab-list">
        {parts.map((part) => (
          <TabsTrigger key={part.value} value={part.value} className="sent-tab">
            {part.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {parts.map((part) => {
        const value = part.valueOf(rawApiRequest);
        return (
          <TabsContent key={part.value} value={part.value} className="sent-view">
            <div className="sent-raw-toolbar">
              <CopyButton text={() => JSON.stringify(value, null, 2)} label="Copy JSON" />
            </div>
            <JsonTree value={value} />
          </TabsContent>
        );
      })}
    </Tabs>
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
