"use client";

// The disclosure of one tool call. The page ships only its summary; the body
// (input and result text) is fetched from `GET /api/tool-call/<id>` the first
// time the reader opens it, and kept for every later open. The `?call=`
// anchored call arrives with its body already read server-side, so it lands
// open and never fetches. Native `<details>` stays the disclosure.
//
// ADR-0002: no core import — the body comes over the route, the helpers from
// the core-free `_lib/transcript`.

import { callRoute } from "@flefebvre/next-pipe/client";
import { Scissors } from "lucide-react";

import { prettyToolText, type ToolCallBody, truncationNote } from "@/app/_lib/transcript";
import { Skeleton } from "@/components/ui/skeleton";
import { routes } from "@/generated/routes";

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
          <IoBlock label={labels.input} text={body.inputJson} />
          {body.resultText !== null && (
            <IoBlock label={labels.result} text={body.resultText} isError={body.isError}>
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

/** One labelled input/result block: wrapped, height-capped, JSON pretty-printed. */
function IoBlock({
  label,
  text,
  isError = false,
  children,
}: {
  label: string;
  text: string;
  isError?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="io-block">
      <span className="io-label">{label}</span>
      <pre className={isError ? "err" : undefined}>{prettyToolText(text)}</pre>
      {children}
    </div>
  );
}
