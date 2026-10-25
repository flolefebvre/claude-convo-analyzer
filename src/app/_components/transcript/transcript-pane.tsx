import { ArrowLeft } from "lucide-react";
import { Fragment } from "react";

import { PendingLink } from "@/app/_components/pending-link";
import { formatCount, formatModelName } from "@/app/_lib/format";
import { type AgentLabel, agentLineage, effortSummary, type TranscriptExport } from "@/app/_lib/transcript";
import {
  TRANSCRIPT_FILTER_EVERYTHING,
  type TranscriptFilter,
  applyTranscriptFilter,
  transcriptFilterKey,
} from "@/app/_lib/transcript-filter";
import { groupTurnsIntoReplies } from "@/app/_lib/transcript-replies";
import { agentHref, agentSectionHref, callAnchorId, messageAnchorId, withListReturn } from "@/app/_lib/transcript-url";
import type { ConversationFamily } from "@/core/family";
import type { TranscriptMessage, TranscriptView } from "@/core/read";

import { FamilyBanner } from "./family-banner";
import { ScrollToAnchor } from "./scroll-to-anchor";
import { TranscriptFold } from "./transcript-fold";
import { TranscriptMessageRow } from "./transcript-message";
import { TranscriptPager } from "./transcript-pager";
import { TranscriptReply } from "./transcript-reply";
import { AgentName, CostFigure, PaneHeader, agentLabelText } from "./transcript-parts";

/**
 * The right pane: the selected agent's transcript, topped by a sticky header
 * with the lineage breadcrumb (root → selected; ancestors are links) and the
 * turn/tool/model/cost stats; search and Refresh live in the app bar above.
 * It renders inside the route's <main>, headed by the conversation title
 * (visually the agent tree shows it). Header, banner and transcript share one centred
 * column. Below the header one Transcript page of the agent's messages renders
 * in order on the Rail — each Message addressed to the agent a row, the Turns
 * between two of them one Reply — then a "N meta records hidden" divider on the last page when the
 * reader dropped meta rows for this agent, and the pager when the transcript
 * spans several pages. On the main agent of a conversation that belongs to a
 * continuation family, a one-line banner names the sitting before and the
 * sitting(s) after. The Conversation export renders the same pane over each
 * Agent's whole transcript (`transcriptExport`); there a Sub-agent's pane opens
 * with a link back to the Agent call that spawned it. The page renders under
 * the reader's Transcript filter: what it hides folds into lines that reveal it
 * in place, and the one holding a `?call=`/`?msg=` target renders revealed.
 */
export function TranscriptPane({
  view,
  labels,
  family,
  anchoredCall,
  anchoredMessage,
  listReturn,
  transcriptFilter = TRANSCRIPT_FILTER_EVERYTHING,
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
  /** The reader's Transcript filter; Everything when unset, as in the Conversation export. */
  transcriptFilter?: TranscriptFilter;
  /** Set in the Conversation export: every Tool call body inlined, agent links
   *  to their sections of the file, every other link into the app as plain
   *  text, no What was sent. */
  transcriptExport?: TranscriptExport;
}) {
  const agentLinksAreInFile = transcriptExport !== undefined;
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
  const filterKey = transcriptFilterKey(transcriptFilter);
  const entries = applyTranscriptFilter(groupTurnsIntoReplies(view.messages, view), transcriptFilter, {
    anchoredCall,
    anchoredMessage,
  });

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
                  {agentLinksAreInFile ? (
                    <a href={agentSectionHref(node.id)} title={agentLabelText(label)}>
                      <AgentName label={label} />
                    </a>
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
          // Other Conversations are not in the file.
          linksAreText={transcriptExport !== undefined}
        />
      )}
      {agentLinksAreInFile && parent !== null && (
        <p className="spawn-back">
          <a
            href={
              selected.spawnedByToolUseId === null
                ? agentSectionHref(parent.id)
                : `#${callAnchorId(selected.spawnedByToolUseId)}`
            }
          >
            <ArrowLeft aria-hidden className="size-3.5" />
            Back to the Agent call in {agentLabelText(labelOf(parent.id))}
          </a>
        </p>
      )}

      <h2 className="sr-only">{agentLabelText(selectedLabel)} transcript</h2>
      <div className="transcript">
        {entries.map((entry) => {
          if (entry.kind === "reply")
            return (
              <TranscriptReply
                key={`reply-${entry.reply.turns[0]?.id}`}
                reply={entry.reply}
                items={entry.items}
                filterKey={filterKey}
                speaker={parent === null ? "Assistant" : agentLabelText(selectedLabel)}
                view={view}
                labels={labels}
                agentModel={selected.resolvedModel}
                effortChangedIds={effort.changedIds}
                anchoredCall={anchoredCall}
                anchoredMessage={anchoredMessage}
                listReturn={listReturn}
                transcriptExport={transcriptExport}
              />
            );
          const row = (
            <TranscriptMessageRow
              key={entry.message.id}
              message={entry.message}
              view={view}
              labels={labels}
              promptAuthor={promptAuthor}
              anchoredMessage={anchoredMessage}
              listReturn={listReturn}
              transcriptExport={transcriptExport}
            />
          );
          if (entry.fold === null) return row;
          return (
            <TranscriptFold
              key={`${entry.message.id}-${filterKey}`}
              label={hiddenMessageLabel(entry.message, labels)}
              layout="row"
              isInitiallyRevealed={entry.fold.isRevealed}
            >
              {row}
            </TranscriptFold>
          );
        })}
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

/** What the fold line of a hidden Message addressed to the Agent holds: its kind, and an Inter-agent message's sender when this Conversation holds it. */
function hiddenMessageLabel(message: TranscriptMessage, labels: Map<string, AgentLabel>): string {
  if (message.kind === "task-notification") return "Task notification";
  const senderAgentId = message.origin?.senderAgentId;
  const sender = senderAgentId == null ? undefined : labels.get(senderAgentId);
  return sender === undefined ? "Inter-agent message" : `Inter-agent message from ${agentLabelText(sender)}`;
}
