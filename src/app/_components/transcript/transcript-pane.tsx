import Link from "next/link";
import { Fragment } from "react";

import { RefreshButton } from "@/app/_components/refresh-button";
import { SearchBox } from "@/app/_components/search-box";
import { subAgentLabel } from "@/app/_lib/detail";
import { formatCost } from "@/app/_lib/format";
import { agentLineage, effortSummary } from "@/app/_lib/transcript";
import { agentHref } from "@/app/_lib/transcript-url";
import type { ConversationFamily } from "@/core/family";
import type { TranscriptView } from "@/core/read";

import { FamilyBanner } from "./family-banner";
import { TranscriptMessageRow } from "./transcript-message";

export function TranscriptPane({
  view,
  family,
  anchoredCall,
  anchoredMessage,
}: {
  view: TranscriptView;
  family?: ConversationFamily | null;
  anchoredCall?: string;
  anchoredMessage?: string;
}) {
  const lineage = agentLineage(view.tree, view.selectedAgentId);
  const selected = lineage[lineage.length - 1] ?? view.tree;

  const turnCount = view.messages.filter((m) => m.role === "assistant").length;
  const toolCount = view.messages.reduce((sum, m) => sum + m.toolCalls.length, 0);
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
                    <Link href={agentHref(view.sessionId, i === 0 ? undefined : node.id)}>{label}</Link>
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
          {selected.resolvedModel && <span className="model">{selected.resolvedModel}</span>}
          {effortLabel && <span className="effort">{effortLabel} effort</span>}
          <span className="cost num turn-cost">{formatCost(selected.costUsd)}</span>
        </div>
        <SearchBox className="w-44" />
        <RefreshButton variant="outline" size="sm" />
      </div>

      {family && <FamilyBanner parent={family.parent} continuations={family.children} />}

      <div className="transcript">
        {view.messages.map((message) => (
          <TranscriptMessageRow
            key={message.id}
            message={message}
            view={view}
            effortChanged={effort.changedIds.has(message.id)}
            anchoredCall={anchoredCall}
            anchoredMessage={anchoredMessage}
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
