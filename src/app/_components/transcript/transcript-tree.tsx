import Link from "next/link";

import { subAgentLabel } from "@/app/_lib/detail";
import { formatCost } from "@/app/_lib/format";
import { agentHref } from "@/app/_lib/transcript-url";
import type { TranscriptAgentNode, TranscriptView } from "@/core/read";

import { TreeNodeLink } from "./tree-node-link";

/**
 * The always-visible left pane: the conversation header (title + back-link to
 * the list + session id), the lineage-nested agent tree, and the grand-total
 * footer. Each node links to its own transcript (`?agent=`); the selected node
 * carries `aria-current`. Even a solo conversation shows its single main node.
 */
export function TranscriptTree({ view }: { view: TranscriptView }) {
  return (
    <aside className="tree" aria-label="Agent tree">
      <div className="tree-header">
        <Link className="back-link" href="/">
          <span aria-hidden>←</span> All conversations
        </Link>
        <h1 className="conv-title">{view.title ?? "Untitled conversation"}</h1>
        <div className="conv-meta" title="session id">
          {view.sessionId}
        </div>
      </div>
      <div className="tree-caption microlabel">Agents</div>
      <nav className="tree-nodes" aria-label="Agents">
        <TreeNode
          node={view.tree}
          depth={0}
          view={view}
        />
      </nav>
      <div className="tree-total">
        <span className="microlabel">Conversation total</span>
        <span className="cost num">{formatCost(view.totalCostUsd)}</span>
      </div>
    </aside>
  );
}

/** One agent node plus its descendants, indented by `--depth`. */
function TreeNode({
  node,
  depth,
  view,
}: {
  node: TranscriptAgentNode;
  depth: number;
  view: TranscriptView;
}) {
  const isCurrent = node.id === view.selectedAgentId;
  // The root links to the bare route (clean URL); children carry `?agent=`.
  const href = agentHref(view.sessionId, depth === 0 ? undefined : node.id);
  return (
    <>
      <TreeNodeLink href={href} isCurrent={isCurrent} depth={depth}>
        <span className="node-glyph" aria-hidden>
          {depth === 0 ? "◆" : "◇"}
        </span>
        <span className="node-label">
          {subAgentLabel({ agentType: node.agentType ?? "" })}
        </span>
        {node.hasError && (
          <span
            className="node-err"
            title="transcript recorded an API error"
          />
        )}
        <span className="cost num">{formatCost(node.costUsd)}</span>
      </TreeNodeLink>
      {node.children.map((child) => (
        <TreeNode key={child.id} node={child} depth={depth + 1} view={view} />
      ))}
    </>
  );
}
