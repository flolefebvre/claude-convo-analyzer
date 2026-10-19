"use client";

// The "What was sent" disclosure of one recorded Turn. The page ships only the
// Turn's `api_request` row id; what its API request sent is fetched from
// `GET /api/api-request/<id>` the first time the reader opens it, and kept for
// every later open. Native `<details>` stays the disclosure, as for tool calls.
//
// ADR-0002: no core import — the payload comes over the route, its types from
// the core-free `_lib/transcript`.

import { callRoute } from "@flefebvre/next-pipe/client";
import { ChevronRight } from "lucide-react";

import { formatLatency } from "@/app/_lib/format";
import type { DiffLine, SentBlock, SentMessage, SentTool, WhatWasSent } from "@/app/_lib/transcript";
import { Skeleton } from "@/components/ui/skeleton";
import { routes } from "@/generated/routes";

import { type ReadOnFirstOpenState, useReadOnFirstOpen } from "./use-read-on-first-open";

/** The +/− marker of a diff line, so a change never reads by colour alone. */
const MARKER_BY_CHANGE: Record<DiffLine["change"], string> = { added: "+", removed: "-", unchanged: " " };

/**
 * A recorded Turn's "What was sent" `<details>`, fetched by `api_request` row
 * `apiRequestId` on the first open.
 *
 * @example {message.apiRequestId !== null && <WhatWasSentDisclosure apiRequestId={message.apiRequestId} />}
 */
export function WhatWasSentDisclosure({ apiRequestId }: { apiRequestId: number }) {
  const { state, onToggle, detailsRef } = useReadOnFirstOpen<WhatWasSent>(() =>
    callRoute(routes.api["api-request"](String(apiRequestId)).GET()),
  );

  return (
    <details ref={detailsRef} className="call sent" onToggle={onToggle}>
      <summary>
        <ChevronRight aria-hidden className="chev" />
        <span className="call-name">What was sent</span>
      </summary>
      <div className="call-body sent-body">
        <Body state={state} />
      </div>
    </details>
  );
}

function Body({ state }: { state: ReadOnFirstOpenState<WhatWasSent> }) {
  switch (state.status) {
    case "idle":
      return null;
    case "loading":
      return (
        <div role="status" aria-label="Loading what was sent" className="flex flex-col gap-2.5">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-16 w-full" />
        </div>
      );
    case "stale":
      return (
        <p className="call-body-note">This transcript changed since the page loaded — reload to see what was sent.</p>
      );
    case "failed":
      return <p className="call-body-note">Couldn&rsquo;t load what was sent — try again.</p>;
    case "loaded":
      return <WhatWasSentView whatWasSent={state.value} />;
  }
}

function WhatWasSentView({ whatWasSent }: { whatWasSent: WhatWasSent }) {
  const { newMessages, previousApiRequestId, systemPromptDiff, toolsDiff, fullRequest } = whatWasSent;
  const messageCount = `${newMessages.length} message${newMessages.length === 1 ? "" : "s"}`;
  return (
    <>
      <Facts whatWasSent={whatWasSent} />

      <section className="sent-section">
        <h4 className="io-label">
          {previousApiRequestId === null
            ? `No earlier API request of this Agent was recorded: every message is new (${messageCount})`
            : `New since the previous API request (${messageCount})`}
        </h4>
        {newMessages.map((message, index) => (
          <MessageBlocks key={index} message={message} />
        ))}
      </section>

      {systemPromptDiff && (
        <section className="sent-section">
          <h4 className="io-label">
            {systemPromptDiff.isVolatileOnly
              ? "System prompt: only volatile changes (dates, git status, working directory)"
              : "System prompt changed"}
          </h4>
          <Diff hunks={systemPromptDiff.hunks} />
        </section>
      )}

      {toolsDiff && (
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
      )}

      <details className="sent-full">
        <summary>
          <ChevronRight aria-hidden className="chev" />
          Full request: {fullRequest.systemBlocks.length} system blocks, {fullRequest.tools.length} tools
        </summary>
        <section className="sent-section">
          <h4 className="io-label">System prompt</h4>
          {fullRequest.systemBlocks.map((block, index) => (
            <div key={index}>
              <BlockText block={block} />
              {block.cacheControl && <p className="sent-breakpoint">Cache breakpoint: {block.cacheControl}</p>}
            </div>
          ))}
        </section>
        <section className="sent-section">
          <h4 className="io-label">Tools</h4>
          {fullRequest.tools.map((tool) => (
            <pre key={tool.name} className="sent-pre">
              {tool.definitionJson}
            </pre>
          ))}
        </section>
        <section className="sent-section">
          <h4 className="io-label">Parameters</h4>
          <pre className="sent-pre">{fullRequest.parametersJson}</pre>
        </section>
      </details>
    </>
  );
}

/** The request parameters and timings, as one line of facts. */
function Facts({ whatWasSent }: { whatWasSent: WhatWasSent }) {
  const { parameters, timings } = whatWasSent;
  const facts = [
    parameters.model,
    parameters.maxTokens !== null && `max_tokens ${parameters.maxTokens}`,
    parameters.thinking !== null && `thinking ${parameters.thinking}`,
    parameters.effort !== null && `effort ${parameters.effort}`,
    parameters.betas.length > 0 && `betas ${parameters.betas.join(", ")}`,
    timings.timeToFirstByteMs !== null && `first byte ${formatLatency(timings.timeToFirstByteMs)}`,
    `total ${formatLatency(timings.durationMs)}`,
  ].filter(Boolean);
  return <p className="sent-line">{facts.join(" · ")}</p>;
}

function MessageBlocks({ message }: { message: SentMessage }) {
  return (
    <div className="sent-message">
      <span className="sent-role">{message.role}</span>
      {message.blocks.map((block, index) => (
        <BlockText key={index} block={block} />
      ))}
    </div>
  );
}

/** A block as plain text: text as sent, any other block as its pretty-printed JSON. */
function BlockText({ block }: { block: SentBlock }) {
  return <pre className="sent-pre">{block.kind === "text" ? block.text : block.json}</pre>;
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
