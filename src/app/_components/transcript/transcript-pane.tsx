import { Fragment } from "react";

import { PendingLink } from "@/app/_components/pending-link";
import { formatCount, formatModelName } from "@/app/_lib/format";
import { type AgentLabel, agentLineage, effortSummary } from "@/app/_lib/transcript";
import { agentHref, callAnchorId, messageAnchorId, withListReturn } from "@/app/_lib/transcript-url";
import type { ConversationFamily } from "@/core/family";
import type { TranscriptView } from "@/core/read";

import { FamilyBanner } from "./family-banner";
import { ScrollToAnchor } from "./scroll-to-anchor";
import { TranscriptMessageRow } from "./transcript-message";
import { TranscriptPager } from "./transcript-pager";
import { AgentName, CostFigure, PaneHeader, agentLabelText } from "./transcript-parts";
import type { TranscriptExport } from "./transcript-tool-call";

/**
 * The right pane: the selected agent's transcript, topped by a sticky header
 * with the lineage breadcrumb (root → selected; ancestors are links) and the
 * turn/tool/model/cost stats; search and Refresh live in the app bar above.
 * It renders inside the route's <main>, headed by the conversation title
 * (visually the agent tree shows it). Header, banner and transcript share one centred
 * column. Below the header one Transcript page of the agent's messages renders
 * in order, then a "N meta records hidden" divider on the last page when the
 * reader dropped meta rows for this agent, and the pager when the transcript
 * spans several pages. On the main agent of a conversation that belongs to a
 * continuation family, a one-line banner names the sitting before and the
 * sitting(s) after. The Conversation export renders the same pane over the
 * whole transcript (`transcriptExport`).
 */
export function TranscriptPane({
  view,
  labels,
  family,
  anchoredCall,
  anchoredMessage,
  listReturn,
  transcriptExport,
}: {
  view: TranscriptView;
  /** Every agent's display name, from `agentLabels(view.tree)`. */
  labels: Map<string, AgentLabel>;
  /** This conversation's continuation family (issue #46) — its DIRECT parent
   *  and continuations head the main agent's pane as a banner. `null` when standalone. */
  family?: ConversationFamily | null;
  /** The `?call=` deep-link target — that tool call renders open + highlighted. */
  anchoredCall?: string;
  /** The `?msg=` deep-link target — that message renders highlighted (a search
   *  result's landing spot). */
  anchoredMessage?: string;
  /** The list view this transcript was opened from (`?from=`), carried on
   *  every link to another transcript. */
  listReturn?: string;
  /** Set in the Conversation export: every Tool call body inlined, every link
   *  into the app as plain text, no What was sent. */
  transcriptExport?: TranscriptExport;
}) {
  const linksAreText = transcriptExport !== undefined;
  const lineage = agentLineage(view.tree, view.selectedAgentId);
  const selected = lineage[lineage.length - 1] ?? view.tree;
  const labelOf = (id: string): AgentLabel => labels.get(id) ?? { name: "main", ordinal: null };
  const selectedLabel = labelOf(selected.id);
  // In a sub-agent's transcript every prompt was written by the agent that
  // spawned it, not by the person.
  const parent = lineage.length > 1 ? lineage[lineage.length - 2] : null;
  const promptAuthor = parent === null ? null : agentLabelText(labelOf(parent.id));

  // The stats describe the agent's whole transcript, not this page.
  const turnCount = view.turnCount;
  const toolCount = view.toolCallCount;
  // Reasoning effort across this agent's turns: one stat here (the level, or
  // "mixed"), and a badge on each turn that changed it. Nothing at all when the
  // log recorded no effort.
  const effort = effortSummary(view.messages, { levels: view.effortLevels, before: view.effortBefore });
  const effortLabel = effort.mixed ? "mixed" : effort.uniform;
  // The deep-link target to scroll to: the `?msg=` message first, else the `?call=` call.
  const anchorId =
    anchoredMessage !== undefined
      ? messageAnchorId(anchoredMessage)
      : anchoredCall !== undefined
        ? callAnchorId(anchoredCall)
        : undefined;

  return (
    <>
      <PaneHeader
        title={view.title}
        crumbLabel="Agent lineage"
        crumbs={lineage.map((node, i) => {
          const label = labelOf(node.id);
          return (
            <Fragment key={node.id}>
              {i === lineage.length - 1 ? (
                <span className="here" aria-current="page" title={agentLabelText(label)}>
                  <AgentName label={label} />
                </span>
              ) : (
                <>
                  {linksAreText ? (
                    <span title={agentLabelText(label)}>
                      <AgentName label={label} />
                    </span>
                  ) : (
                    <PendingLink
                      href={withListReturn(agentHref(view.sessionId, i === 0 ? undefined : node.id), listReturn)}
                      title={agentLabelText(label)}
                    >
                      <AgentName label={label} />
                    </PendingLink>
                  )}
                  <span className="sep" aria-hidden>
                    /
                  </span>
                </>
              )}
            </Fragment>
          );
        })}
        stats={
          <>
            <span>
              {formatCount(turnCount)} turn{turnCount === 1 ? "" : "s"}
            </span>
            <span>
              {formatCount(toolCount)} tool call{toolCount === 1 ? "" : "s"}
            </span>
            {selected.resolvedModel && (
              <span className="model" title={selected.resolvedModel}>
                {formatModelName(selected.resolvedModel)}
              </span>
            )}
            {effortLabel && <span>{effortLabel} effort</span>}
            <CostFigure usd={selected.costUsd} lowerBound={selected.unpriced} className="stat-cost" />
          </>
        }
      />

      {family && parent === null && (
        <FamilyBanner
          parent={family.parent}
          continuations={family.children}
          listReturn={listReturn}
          linksAreText={linksAreText}
        />
      )}

      <h2 className="sr-only">{agentLabelText(selectedLabel)} transcript</h2>
      <div className="transcript">
        {view.messages.map((message) => (
          <TranscriptMessageRow
            key={message.id}
            message={message}
            view={view}
            labels={labels}
            agentModel={selected.resolvedModel}
            promptAuthor={promptAuthor}
            effortChanged={effort.changedIds.has(message.id)}
            anchoredCall={anchoredCall}
            anchoredMessage={anchoredMessage}
            listReturn={listReturn}
            transcriptExport={transcriptExport}
          />
        ))}
        {view.metaHiddenCount > 0 && view.page === view.pageCount && (
          <div className="meta-hidden">
            {view.metaHiddenCount} meta record
            {view.metaHiddenCount === 1 ? "" : "s"} hidden
          </div>
        )}
        <TranscriptPager view={view} listReturn={listReturn} className="justify-center" />
      </div>
      {anchorId !== undefined && <ScrollToAnchor id={anchorId} />}
    </>
  );
}
