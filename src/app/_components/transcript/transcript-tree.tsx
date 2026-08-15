import Link from "next/link";

import { subAgentLabel } from "@/app/_lib/detail";
import { formatCost } from "@/app/_lib/format";
import { agentHref } from "@/app/_lib/transcript-url";
import type { TranscriptAgentNode, TranscriptView } from "@/core/read";

import { TreeNodeLink } from "./tree-node-link";

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
        <TreeNode node={view.tree} depth={0} view={view} />
      </nav>
      <div className="tree-total">
        <span className="microlabel">Conversation total</span>
        <span className="cost num">{formatCost(view.totalCostUsd)}</span>
      </div>
    </aside>
  );
}

function TreeNode({ node, depth, view }: { node: TranscriptAgentNode; depth: number; view: TranscriptView }) {
  const isCurrent = node.id === view.selectedAgentId;
  const href = agentHref(view.sessionId, depth === 0 ? undefined : node.id);
  return (
    <>
      <TreeNodeLink href={href} isCurrent={isCurrent} depth={depth}>
        <span className="node-glyph" aria-hidden>
          {depth === 0 ? "◆" : "◇"}
        </span>
        <span className="node-label">{subAgentLabel({ agentType: node.agentType ?? "" })}</span>
        {node.hasError && <span className="node-err" title="transcript recorded an API error" />}
        <span className="cost num">{formatCost(node.costUsd)}</span>
      </TreeNodeLink>
      {node.children.map((child) => (
        <TreeNode key={child.id} node={child} depth={depth + 1} view={view} />
      ))}
    </>
  );
}
