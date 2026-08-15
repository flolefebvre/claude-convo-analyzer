import Link from "next/link";

import { subAgentLabel } from "@/app/_lib/detail";
import { formatCost, formatTokens } from "@/app/_lib/format";
import { classifyToolCall, findSpawnedNode, toolCallSnippet, truncationNote } from "@/app/_lib/transcript";
import { agentHref, callAnchorId } from "@/app/_lib/transcript-url";
import type { TranscriptToolCall, TranscriptView } from "@/core/read";

function prettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw) as unknown, null, 2);
  } catch {
    return raw;
  }
}

const KIND_LABEL = { agent: "Agent", skill: "Skill", tool: "Tool" } as const;

export function TranscriptToolCallRow({
  call,
  messageId,
  view,
  anchoredCall,
}: {
  call: TranscriptToolCall;
  messageId: number;
  view: TranscriptView;
  anchoredCall?: string;
}) {
  const kind = classifyToolCall(call);
  const snippet = toolCallSnippet(call);
  const anchored = call.toolUseId !== null && call.toolUseId === anchoredCall;
  const anchorProps = call.toolUseId === null ? {} : { id: callAnchorId(call.toolUseId) };

  if (kind === "agent") {
    const spawned = findSpawnedNode(view.tree, {
      toolUseId: call.toolUseId,
      messageId,
    });
    const name = spawned ? subAgentLabel({ agentType: spawned.agentType ?? "" }) : "Agent";
    return (
      <details {...anchorProps} open={anchored || undefined} className={anchored ? "call anchored" : "call"}>
        <summary>
          <span className="chev" aria-hidden>
            ▶
          </span>
          <span className="kind kind-agent">{KIND_LABEL.agent}</span>
          <span className="call-name">{name}</span>
          <span className="call-snippet">{snippet}</span>
          {spawned && <span className="cost num">{formatCost(spawned.costUsd)}</span>}
        </summary>
        <div className="call-body">
          <div className="io-block">
            <span className="microlabel">Prompt</span>
            <pre>{prettyJson(call.inputJson)}</pre>
          </div>
          {call.resultText !== null && (
            <div className="io-block">
              <span className="microlabel">Returned</span>
              <pre className={call.isError ? "err" : undefined}>{call.resultText}</pre>
            </div>
          )}
          {spawned && (
            <Link className="open-agent" href={agentHref(view.sessionId, spawned.id)}>
              Open transcript <span aria-hidden>→</span>
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
    <details {...anchorProps} open={anchored || undefined} className={anchored ? "call anchored" : "call"}>
      <summary>
        <span className="chev" aria-hidden>
          ▶
        </span>
        <span className={`kind ${kindClass}`}>{KIND_LABEL[kind]}</span>
        <span className="call-name">{call.name}</span>
        <span className="call-snippet">{snippet}</span>
        {call.isError ? (
          <span className="call-err">error</span>
        ) : (
          resultSize !== null && <span className="call-meta num">{formatTokens(resultSize)} chars</span>
        )}
      </summary>
      <div className="call-body">
        <div className="io-block">
          <span className="microlabel">Input</span>
          <pre>{prettyJson(call.inputJson)}</pre>
        </div>
        {call.resultText !== null && (
          <div className="io-block">
            <span className="microlabel">Result</span>
            <pre className={call.isError ? "err" : undefined}>{call.resultText}</pre>
            {note && (
              <div className="trunc">
                <span aria-hidden>✂</span> truncated — {note}
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
