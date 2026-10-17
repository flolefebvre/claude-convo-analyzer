import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import type { AgentLabel } from "@/app/_lib/transcript";
import { agentHref, withListReturn } from "@/app/_lib/transcript-url";
import type { TranscriptAgentNode, TranscriptView } from "@/core/read";

import { AgentName, CostFigure, ErrorBadge, agentLabelText } from "./transcript-parts";
import { TreeNodeLink } from "./tree-node-link";

/**
 * The always-visible left pane: the conversation header (title + back-link to
 * the list + session id), the lineage-nested agent tree, and the grand-total
 * footer. Each node links to its own transcript (`?agent=`); the selected node
 * carries `aria-current="page"`. Even a solo conversation shows its single main
 * node. Same-named siblings carry their spawn ordinal ("Plan #2").
 */
export function TranscriptTree({
  view,
  labels,
  lowerBound,
  back = { href: "/", from: undefined },
}: {
  view: TranscriptView;
  /** Every agent's display name, from `agentLabels(view.tree)`. */
  labels: Map<string, AgentLabel>;
  /** True when some agent has unpriced usage: the total is then a lower bound. */
  lowerBound: boolean;
  /** The way back to the list view this transcript was opened from
   *  (`resolveListReturn`): the back link's `href`, and the `from` the agent
   *  links carry on. */
  back?: { href: string; from: string | undefined };
}) {
  return (
    <aside className="tree" aria-label="Agent tree">
      <div className="tree-header">
        <Link className="back-link" href={back.href}>
          <ArrowLeft aria-hidden className="size-3.5" />
          All conversations
        </Link>
        {/* The page's h1 is in the pane (<main>); here the title is a label. */}
        <p className="conv-title">{view.title ?? "Untitled conversation"}</p>
        <div className="conv-meta" title="Session id">
          {view.sessionId}
        </div>
      </div>
      <div className="tree-caption" id="tree-caption">
        Agents
      </div>
      <nav className="tree-nodes" aria-labelledby="tree-caption">
        <TreeNode node={view.tree} depth={0} view={view} labels={labels} listReturn={back.from} />
      </nav>
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
    </aside>
  );
}

/** One agent node plus its descendants, indented by `--depth`. */
function TreeNode({
  node,
  depth,
  view,
  labels,
  listReturn,
}: {
  node: TranscriptAgentNode;
  depth: number;
  view: TranscriptView;
  labels: Map<string, AgentLabel>;
  listReturn: string | undefined;
}) {
  const isCurrent = node.id === view.selectedAgentId;
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
        <TreeNode key={child.id} node={child} depth={depth + 1} view={view} labels={labels} listReturn={listReturn} />
      ))}
    </>
  );
}
