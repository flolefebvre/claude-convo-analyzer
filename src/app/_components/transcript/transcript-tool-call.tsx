import { ArrowRight, ChevronRight, Scissors } from "lucide-react";
import Link from "next/link";

import { formatTokens } from "@/app/_lib/format";
import {
  type AgentLabel,
  classifyToolCall,
  findSpawnedNode,
  prettyToolText,
  toolCallSnippet,
  truncationNote,
} from "@/app/_lib/transcript";
import { agentHref, callAnchorId, withListReturn } from "@/app/_lib/transcript-url";
import type { TranscriptToolCall, TranscriptView } from "@/core/read";

import { AgentName, CostFigure, ErrorBadge } from "./transcript-parts";

/** Badge label per visual kind (set in small caps by the CSS). */
const KIND_LABEL = { agent: "Agent", skill: "Skill", tool: "Tool" } as const;

/**
 * One collapsed-by-default tool call, rendered as a native `<details>` so the
 * disclosure needs no client JS (the page stays a server component). Three
 * visual kinds — generic tool, skill load, and Agent call — share the summary
 * shell but differ in the badge and body: an Agent call correlates to the
 * sub-agent it spawned to show that agent's name (as the tree shows it), exact
 * cost and an "Open transcript" deep-link. Inputs and results are shown
 * wrapped, height-capped, and pretty-printed when they are JSON.
 */
export function TranscriptToolCallRow({
  call,
  messageId,
  view,
  labels,
  anchoredCall,
  listReturn,
}: {
  call: TranscriptToolCall;
  messageId: number;
  view: TranscriptView;
  /** Every agent's display name, from `agentLabels(view.tree)`. */
  labels: Map<string, AgentLabel>;
  /** The `?call=` deep-link target: THIS call renders open and highlighted. */
  anchoredCall?: string;
  /** The list view this transcript was opened from (`?from=`), carried on
   *  every link to another transcript. */
  listReturn?: string;
}) {
  const kind = classifyToolCall(call);
  const snippet = toolCallSnippet(call);
  // A Tools-page drill-down links here as `?call=<id>#call-<id>`: the query
  // opens + highlights the call server-side (a fragment never reaches the
  // server), the fragment scrolls to the `id` below.
  const anchored = call.toolUseId !== null && call.toolUseId === anchoredCall;
  const anchorProps = call.toolUseId === null ? {} : { id: callAnchorId(call.toolUseId) };
  const className = anchored ? "call anchored" : "call";

  if (kind === "agent") {
    const spawned = findSpawnedNode(view.tree, {
      toolUseId: call.toolUseId,
      messageId,
    });
    const label = spawned ? labels.get(spawned.id) : undefined;
    return (
      <details {...anchorProps} open={anchored || undefined} className={className}>
        <summary>
          <ChevronRight aria-hidden className="chev" />
          <span className="kind kind-agent">{KIND_LABEL.agent}</span>
          <span className="call-name">{label ? <AgentName label={label} /> : "Agent"}</span>
          <span className="call-snippet">{snippet}</span>
          {call.isError && <ErrorBadge>error</ErrorBadge>}
          {spawned && <CostFigure usd={spawned.costUsd} lowerBound={spawned.unpriced} />}
        </summary>
        <div className="call-body">
          <IoBlock label="Prompt" text={call.inputJson} />
          {call.resultText !== null && <IoBlock label="Returned" text={call.resultText} isError={call.isError} />}
          {spawned && (
            <Link className="open-agent" href={withListReturn(agentHref(view.sessionId, spawned.id), listReturn)}>
              Open transcript
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          )}
        </div>
      </details>
    );
  }

  const kindClass = kind === "skill" ? "kind-skill" : "kind-tool";
  const note = truncationNote(call);
  const resultSize = call.resultCharSize ?? (call.resultText !== null ? call.resultText.length : null);

  return (
    <details {...anchorProps} open={anchored || undefined} className={className}>
      <summary>
        <ChevronRight aria-hidden className="chev" />
        <span className={`kind ${kindClass}`}>{KIND_LABEL[kind]}</span>
        <span className="call-name">{call.name}</span>
        <span className="call-snippet">{snippet}</span>
        {call.isError ? (
          <ErrorBadge>error</ErrorBadge>
        ) : (
          resultSize !== null && <span className="call-meta">{formatTokens(resultSize)} chars</span>
        )}
      </summary>
      <div className="call-body">
        <IoBlock label="Input" text={call.inputJson} />
        {call.resultText !== null && (
          <IoBlock label="Result" text={call.resultText} isError={call.isError}>
            {note && (
              <div className="trunc">
                <Scissors aria-hidden className="size-3" />
                Truncated: {note}
              </div>
            )}
          </IoBlock>
        )}
      </div>
    </details>
  );
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
