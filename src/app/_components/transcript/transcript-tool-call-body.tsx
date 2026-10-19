"use client";

// The disclosure of one tool call. The page ships only its summary; the body
// (input and result text) is fetched from `GET /api/tool-call/<id>` the first
// time the reader opens it, and kept for every later open. The `?call=`
// anchored call arrives with its body already read server-side, so it lands
// open and never fetches. Native `<details>` stays the disclosure. Each block
// renders the parts the server shaped it into; no tool is special-cased here.
//
// ADR-0002: no core import — the body comes over the route, the helpers from
// the core-free `_lib/transcript`.

import { callRoute } from "@flefebvre/next-pipe/client";
import { Scissors } from "lucide-react";
import { useState } from "react";

import { prettyToolText, type ToolCallBody, type ToolCallPart, truncationNote } from "@/app/_lib/transcript";
import { Skeleton } from "@/components/ui/skeleton";
import { routes } from "@/generated/routes";

import { TurnMarkdown } from "./turn-markdown";
import { type ReadOnFirstOpenState, useReadOnFirstOpen } from "./use-read-on-first-open";

/**
 * A tool call's `<details>`: the server-rendered `summary`, then the body,
 * fetched by row `id` on the first open unless `body` is pre-loaded, then the
 * server-rendered `footer` (an Agent call's "Open transcript" link).
 *
 * @example <ToolCallDisclosure id={call.id} summary={<summary>…</summary>} labels={{ input: "Input", result: "Result" }} />
 */
export function ToolCallDisclosure({
  id,
  anchorId,
  anchored = false,
  body,
  summary,
  footer,
  labels,
  showTruncation = true,
}: {
  /** The Tool call's row id, the route's `[id]`. */
  id: number;
  /** The `#call-…` element id, when the call has a `tool_use` id. */
  anchorId?: string;
  /** The `?call=` target: renders open and highlighted. */
  anchored?: boolean;
  /** The body read server-side — the anchored call's only. */
  body?: ToolCallBody;
  summary: React.ReactNode;
  footer?: React.ReactNode;
  /** The input and result block labels ("Input"/"Result", or "Prompt"/"Returned" for an Agent call). */
  labels: { input: string; result: string };
  /** Whether a truncated result says so under its block. */
  showTruncation?: boolean;
}) {
  // The anchored call starts `loaded` and never fetches.
  const { state, onToggle, detailsRef } = useReadOnFirstOpen<ToolCallBody>(
    () => callRoute(routes.api["tool-call"](String(id)).GET()),
    body,
  );

  return (
    <details
      ref={detailsRef}
      id={anchorId}
      open={anchored || undefined}
      className={anchored ? "call anchored" : "call"}
      onToggle={onToggle}
    >
      {summary}
      <div className="call-body">
        <Body state={state} labels={labels} showTruncation={showTruncation} />
        {footer}
      </div>
    </details>
  );
}

/** The body for its state: the two blocks, a placeholder while loading, or a one-line note. */
function Body({
  state,
  labels,
  showTruncation,
}: {
  state: ReadOnFirstOpenState<ToolCallBody>;
  labels: { input: string; result: string };
  showTruncation: boolean;
}) {
  switch (state.status) {
    case "idle":
      return null;
    case "loading":
      return (
        <div role="status" aria-label="Loading tool call" className="flex flex-col gap-2.5">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-16 w-full" />
        </div>
      );
    case "stale":
      return <p className="call-body-note">This transcript changed since the page loaded — reload to see this call.</p>;
    case "failed":
      return <p className="call-body-note">Couldn&rsquo;t load this call — try again.</p>;
    case "loaded": {
      const body = state.value;
      const note = showTruncation ? truncationNote(body) : null;
      return (
        <>
          <IoBlock label={labels.input} text={body.inputJson} parts={body.inputParts} />
          {body.resultText !== null && (
            <IoBlock label={labels.result} text={body.resultText} parts={body.resultParts ?? []} isError={body.isError}>
              {note && (
                <div className="trunc">
                  <Scissors aria-hidden className="size-3" />
                  Truncated: {note}
                </div>
              )}
            </IoBlock>
          )}
        </>
      );
    }
  }
}

/**
 * One labelled input/result block, height-capped: its stored `text` (JSON
 * pretty-printed) when its only part is raw, else its rendered `parts` with a
 * "Raw" toggle back to that text.
 */
function IoBlock({
  label,
  text,
  parts,
  isError = false,
  children,
}: {
  label: string;
  /** The block's stored text — what a raw part, and the "Raw" toggle, show. */
  text: string;
  parts: ToolCallPart[];
  isError?: boolean;
  children?: React.ReactNode;
}) {
  const [isRawShown, setIsRawShown] = useState(false);
  const isRawOnly = parts.every((part) => part.kind === "raw");
  const rawText = <pre className={isError ? "err" : undefined}>{prettyToolText(text)}</pre>;

  if (isRawOnly) {
    return (
      <div className="io-block">
        <span className="io-label">{label}</span>
        {rawText}
        {children}
      </div>
    );
  }
  return (
    <div className="io-block">
      <div className="io-head">
        <span className="io-label">{label}</span>
        <button
          type="button"
          className="io-raw-toggle"
          aria-pressed={isRawShown}
          onClick={() => setIsRawShown((shown) => !shown)}
        >
          Raw
        </button>
      </div>
      {isRawShown ? (
        rawText
      ) : (
        <div className="io-view">
          {parts.map((part, index) => (
            <BodyPart key={index} part={part} text={text} />
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

/** One rendered part of a block; a raw part shows the block's stored `text`. */
function BodyPart({ part, text }: { part: ToolCallPart; text: string }) {
  switch (part.kind) {
    case "facts":
      return (
        <dl className="io-facts">
          {part.facts.map((fact) => (
            <div key={fact.key}>
              <dt>{fact.key}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      );
    case "markdown":
      return (
        <div className="turn-body">
          <TurnMarkdown text={part.text} />
        </div>
      );
    case "raw":
      return <pre className="io-raw-part">{prettyToolText(text)}</pre>;
  }
}
