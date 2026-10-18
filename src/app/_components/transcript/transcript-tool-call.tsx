import { ArrowRight, ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ComponentProps } from "react";

import { loadToolCallBody } from "@/app/_lib/conversations";
import { formatTokens } from "@/app/_lib/format";
import { type AgentLabel, classifyToolCall, findSpawnedNode, toolCallSnippet } from "@/app/_lib/transcript";
import { agentHref, callAnchorId, withListReturn } from "@/app/_lib/transcript-url";
import type { TranscriptToolCall, TranscriptView } from "@/core/read";

import { AgentName, CostFigure, ErrorBadge } from "./transcript-parts";
import { ToolCallDisclosure } from "./transcript-tool-call-body";

/** Badge label per visual kind (set in small caps by the CSS). */
const KIND_LABEL = { agent: "Agent", skill: "Skill", tool: "Tool" } as const;

/**
 * One collapsed-by-default tool call. Its summary — and an Agent call's link to
 * the sub-agent it spawned — render here; the body (input and result) is left
 * to the {@link ToolCallDisclosure} leaf, which fetches it when the reader opens
 * the call. Three visual kinds — generic tool, skill load, and Agent call —
 * share the summary shell but differ in the badge: an Agent call correlates to
 * the sub-agent it spawned to show that agent's name (as the tree shows it),
 * exact cost and an "Open transcript" deep-link.
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
  // server), with its body read server-side, and the pane's `ScrollToAnchor`
  // scrolls to the `id`.
  const anchored = call.toolUseId !== null && call.toolUseId === anchoredCall;
  const Disclosure = anchored ? PreloadedToolCallDisclosure : ToolCallDisclosure;
  const disclosure = {
    id: call.id,
    anchorId: call.toolUseId === null ? undefined : callAnchorId(call.toolUseId),
    anchored,
  };

  if (kind === "agent") {
    const spawned = findSpawnedNode(view.tree, {
      toolUseId: call.toolUseId,
      messageId,
    });
    const label = spawned ? labels.get(spawned.id) : undefined;
    return (
      <Disclosure
        {...disclosure}
        labels={{ input: "Prompt", result: "Returned" }}
        showTruncation={false}
        summary={
          <summary>
            <ChevronRight aria-hidden className="chev" />
            <span className="kind kind-agent">{KIND_LABEL.agent}</span>
            <span className="call-name">{label ? <AgentName label={label} /> : "Agent"}</span>
            <span className="call-snippet">{snippet}</span>
            {call.isError && <ErrorBadge>error</ErrorBadge>}
            {spawned && <CostFigure usd={spawned.costUsd} lowerBound={spawned.unpriced} />}
          </summary>
        }
        footer={
          spawned && (
            <Link className="open-agent" href={withListReturn(agentHref(view.sessionId, spawned.id), listReturn)}>
              Open transcript
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
          )
        }
      />
    );
  }

  const kindClass = kind === "skill" ? "kind-skill" : "kind-tool";
  return (
    <Disclosure
      {...disclosure}
      labels={{ input: "Input", result: "Result" }}
      summary={
        <summary>
          <ChevronRight aria-hidden className="chev" />
          <span className={`kind ${kindClass}`}>{KIND_LABEL[kind]}</span>
          <span className="call-name">{call.name}</span>
          <span className="call-snippet">{snippet}</span>
          {call.isError ? (
            <ErrorBadge>error</ErrorBadge>
          ) : (
            call.resultCharSize !== null && <span className="call-meta">{formatTokens(call.resultCharSize)} chars</span>
          )}
        </summary>
      }
    />
  );
}

/**
 * The `?call=` anchored call's disclosure, its body read server-side so the
 * deep link lands open with nothing to fetch. The summary and footer arrive
 * built by the row; only the body read waits here.
 */
async function PreloadedToolCallDisclosure(props: Omit<ComponentProps<typeof ToolCallDisclosure>, "body">) {
  const body = await loadToolCallBody(props.id);
  return <ToolCallDisclosure {...props} body={body ?? undefined} />;
}
