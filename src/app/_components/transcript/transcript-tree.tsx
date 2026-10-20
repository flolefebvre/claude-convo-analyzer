import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { ActiveNowMarker } from "@/app/_components/active-now-marker";
import { formatClock } from "@/app/_lib/format";
import { SIDE_REQUESTS_TOOLTIP, sideRequestLabel } from "@/app/_lib/side-requests";
import type { AgentLabel } from "@/app/_lib/transcript";
import { agentHref, sideRequestHref, withListReturn } from "@/app/_lib/transcript-url";
import type { TranscriptAgentNode, TranscriptView } from "@/core/read";

import { AgentName, CostFigure, ErrorBadge, agentLabelText } from "./transcript-parts";
import { TreeNodeLink } from "./tree-node-link";

/**
 * The way back to the list view this transcript was opened from: the agent
 * tree's first row, above the conversation header.
 *
 * @example <BackLink href={resolveListReturn(from).href} />
 */
export function BackLink({ href }: { href: string }) {
  return (
    <Link className="back-link" href={href}>
      <ArrowLeft aria-hidden className="size-3.5" />
      All conversations
    </Link>
  );
}

/**
 * The agent tree below the back link: the conversation header (title + session
 * id), the lineage-nested agent nodes, the Side requests of a Recorded
 * Conversation (each with its kind, time and cost, linking to `?sideRequest=`),
 * and the grand-total footer. Each agent node links to its own transcript
 * (`?agent=`); the selected node carries `aria-current="page"`. Even a solo conversation shows its single main node.
 * Same-named siblings carry their spawn ordinal ("Plan #2"). Renders inside the
 * route's `<aside>`.
 *
 * @example <TranscriptTree view={view} labels={agentLabels(view.tree)} lowerBound={false} listReturn={undefined} />
 */
export function TranscriptTree({
  view,
  labels,
  lowerBound,
  listReturn,
  selectedSideRequestId,
  activeUntil = null,
}: {
  view: TranscriptView;
  /** Every agent's display name, from `agentLabels(view.tree)`. */
  labels: Map<string, AgentLabel>;
  /** True when some usage has no known price: the total is then a lower bound. */
  lowerBound: boolean;
  /** The list view this transcript was opened from (`?from=`), carried on
   *  every agent link. */
  listReturn: string | undefined;
  /** The `api_request` row id of the Side request the pane shows; no agent is then current. */
  selectedSideRequestId?: number;
  /** When the Conversation stops being active now (`activeNowUntil`), or `null` when it is not. */
  activeUntil?: number | null;
}) {
  return (
    <>
      <div className="tree-header">
        {/* The page's h1 is in the pane (<main>); here the title is a label. */}
        <p className="conv-title">
          {view.title ?? "Untitled conversation"}
          {activeUntil !== null && (
            <span className="ml-1.5 inline-block align-middle">
              <ActiveNowMarker activeUntil={activeUntil} />
            </span>
          )}
        </p>
        <div className="conv-meta" title="Session id">
          {view.sessionId}
        </div>
      </div>
      <div className="tree-caption" id="tree-caption">
        Agents
      </div>
      <nav className="tree-nodes" aria-labelledby="tree-caption">
        <TreeNode
          node={view.tree}
          depth={0}
          view={view}
          labels={labels}
          listReturn={listReturn}
          isAgentSelected={selectedSideRequestId === undefined}
        />
      </nav>
      {/* Only a Recorded Conversation has Side requests: an unrecorded one
          shows nothing more than before. */}
      {view.sideRequests.length > 0 && (
        <>
          <div className="tree-caption" id="side-requests-caption">
            <span className="term" title={SIDE_REQUESTS_TOOLTIP}>
              Side requests
            </span>
          </div>
          <nav className="tree-nodes" aria-labelledby="side-requests-caption">
            {view.sideRequests.map((sideRequest) => {
              const label = sideRequestLabel(sideRequest);
              return (
                <TreeNodeLink
                  key={sideRequest.apiRequestId}
                  href={withListReturn(sideRequestHref(view.sessionId, sideRequest.apiRequestId), listReturn)}
                  isCurrent={sideRequest.apiRequestId === selectedSideRequestId}
                  depth={0}
                  title={`${label}, at ${formatClock(sideRequest.arrivedAt)}`}
                >
                  <span className="node-dot is-side" aria-hidden />
                  <span className="node-label">{label}</span>
                  <span className="node-time">{formatClock(sideRequest.arrivedAt)}</span>
                  <CostFigure usd={sideRequest.costUsd} lowerBound={sideRequest.unpriced} />
                </TreeNodeLink>
              );
            })}
          </nav>
        </>
      )}
      <div className="tree-total">
        <div className="tree-total-row">
          <span className="tree-total-label">Conversation total</span>
          <CostFigure usd={view.totalCostUsd} lowerBound={lowerBound} />
        </div>
        {lowerBound && (
          <p className="lower-bound-note">
            <span className="tilde">~</span> marks a lower bound: some usage is on a model without a known price,
            counted as $0.
          </p>
        )}
      </div>
    </>
  );
}

/** One agent node plus its descendants, indented by `--depth`. */
function TreeNode({
  node,
  depth,
  view,
  labels,
  listReturn,
  isAgentSelected,
}: {
  node: TranscriptAgentNode;
  depth: number;
  view: TranscriptView;
  labels: Map<string, AgentLabel>;
  listReturn: string | undefined;
  /** False while the pane shows a Side request rather than an agent's transcript. */
  isAgentSelected: boolean;
}) {
  const isCurrent = isAgentSelected && node.id === view.selectedAgentId;
  const label = labels.get(node.id) ?? { name: node.agentType || "main", ordinal: null };
  // The root links to the bare route (clean URL); children carry `?agent=`.
  const href = withListReturn(agentHref(view.sessionId, depth === 0 ? undefined : node.id), listReturn);
  return (
    <>
      <TreeNodeLink href={href} isCurrent={isCurrent} depth={depth} title={agentLabelText(label)}>
        <span className={depth === 0 ? "node-dot is-main" : "node-dot"} aria-hidden />
        <span className="node-label">
          <AgentName label={label} />
        </span>
        {node.hasError && (
          <ErrorBadge iconOnly title="This agent's transcript recorded an API error">
            API error
          </ErrorBadge>
        )}
        <CostFigure usd={node.costUsd} lowerBound={node.unpriced} />
      </TreeNodeLink>
      {node.children.map((child) => (
        <TreeNode
          key={child.id}
          node={child}
          depth={depth + 1}
          view={view}
          labels={labels}
          listReturn={listReturn}
          isAgentSelected={isAgentSelected}
        />
      ))}
    </>
  );
}
