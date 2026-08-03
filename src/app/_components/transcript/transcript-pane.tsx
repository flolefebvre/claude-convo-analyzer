import Link from "next/link";
import { Fragment } from "react";

import { RefreshButton } from "@/app/_components/refresh-button";
import { subAgentLabel } from "@/app/_lib/detail";
import { formatCost } from "@/app/_lib/format";
import { agentLineage, effortSummary } from "@/app/_lib/transcript";
import { agentHref } from "@/app/_lib/transcript-url";
import type { TranscriptView } from "@/core/read";

import { TranscriptMessageRow } from "./transcript-message";

/**
 * The right pane: the selected agent's transcript, topped by a sticky header
 * with the lineage breadcrumb (root → selected; ancestors are links), the
 * turn/tool/model/cost stats, and a Refresh control (re-scan the logs without
 * leaving an ongoing conversation). Below it, the agent's messages render in order,
 * with a trailing "N meta records hidden" divider when the reader dropped meta
 * rows for this agent.
 */
export function TranscriptPane({ view }: { view: TranscriptView }) {
  const lineage = agentLineage(view.tree, view.selectedAgentId);
  const selected = lineage[lineage.length - 1] ?? view.tree;

  const turnCount = view.messages.filter((m) => m.role === "assistant").length;
  const toolCount = view.messages.reduce(
    (sum, m) => sum + m.toolCalls.length,
    0,
  );
  // Reasoning effort across this agent's turns: one stat here (the level, or
  // "mixed"), and a badge on each turn that changed it. Nothing at all when the
  // log recorded no effort.
  const effort = effortSummary(view.messages);
  const effortLabel = effort.mixed ? "mixed" : effort.uniform;

  return (
    <main className="pane">
      <div className="pane-header">
        <nav className="crumb" aria-label="Agent lineage">
          {lineage.map((node, i) => {
            const isLast = i === lineage.length - 1;
            const label = subAgentLabel({ agentType: node.agentType ?? "" });
            return (
              <Fragment key={node.id}>
                {isLast ? (
                  <span className="here">{label}</span>
                ) : (
                  <>
                    <Link
                      href={agentHref(view.sessionId, i === 0 ? undefined : node.id)}
                    >
                      {label}
                    </Link>
                    <span className="sep" aria-hidden>
                      /
                    </span>
                  </>
                )}
              </Fragment>
            );
          })}
        </nav>
        <div className="stats">
          <span className="num">
            {turnCount} turn{turnCount === 1 ? "" : "s"}
          </span>
          <span className="num">
            {toolCount} tool call{toolCount === 1 ? "" : "s"}
          </span>
          {selected.resolvedModel && (
            <span className="model">{selected.resolvedModel}</span>
          )}
          {effortLabel && <span className="effort">{effortLabel} effort</span>}
          <span className="cost num turn-cost">
            {formatCost(selected.costUsd)}
          </span>
        </div>
        {/* Re-scan the logs without leaving an ongoing conversation. The action
            revalidates the whole tree, so this page re-renders with the new
            messages; compact variant to sit inside the sticky stats header. */}
        <RefreshButton variant="outline" size="sm" />
      </div>

      <div className="transcript">
        {view.messages.map((message) => (
          <TranscriptMessageRow
            key={message.id}
            message={message}
            view={view}
            effortChanged={effort.changedIds.has(message.id)}
          />
        ))}
        {view.metaHiddenCount > 0 && (
          <div className="meta-hidden">
            {view.metaHiddenCount} meta record
            {view.metaHiddenCount === 1 ? "" : "s"} hidden
          </div>
        )}
      </div>
    </main>
  );
}
