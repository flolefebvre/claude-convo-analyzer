import { ArrowLeft, Download } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";

import { ActiveNowMarker } from "@/app/_components/active-now-marker";
import { formatDate, formatModelName } from "@/app/_lib/format";
import type { AgentLabel } from "@/app/_lib/transcript";
import { agentHref, withListReturn } from "@/app/_lib/transcript-url";
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
 * The agent tree below the back link: the conversation header (title, session
 * id and the "Export as HTML" download — in the export itself, the export's
 * facts instead), the lineage-nested agent nodes, and the grand-total footer. Each agent node links to its own transcript
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
  activeUntil = null,
  exportHeaderFacts,
}: {
  view: TranscriptView;
  /** Every agent's display name, from `agentLabels(view.tree)`. */
  labels: Map<string, AgentLabel>;
  /** True when some usage has no known price: the total is then a lower bound. */
  lowerBound: boolean;
  /** The list view this transcript was opened from (`?from=`), carried on
   *  every agent link. */
  listReturn: string | undefined;
  /** When the Conversation stops being active now (`activeNowUntil`), or `null` when it is not. */
  activeUntil?: number | null;
  /** Set in the Conversation export: the header shows these facts instead of the
   *  Export link, and the agent nodes are plain text. */
  exportHeaderFacts?: ExportHeaderFacts;
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
        {exportHeaderFacts === undefined ? (
          <a className="export-link" href={`/api/conversation/${encodeURIComponent(view.sessionId)}/export`} download>
            <Download aria-hidden className="size-3.5" />
            Export as HTML
          </a>
        ) : (
          <ExportHeader facts={exportHeaderFacts} />
        )}
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
          isNodeLinked={exportHeaderFacts === undefined}
        />
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
  isNodeLinked,
}: {
  node: TranscriptAgentNode;
  depth: number;
  view: TranscriptView;
  labels: Map<string, AgentLabel>;
  listReturn: string | undefined;
  /** False in the Conversation export, where a node names its agent as plain text. */
  isNodeLinked: boolean;
}) {
  const isCurrent = node.id === view.selectedAgentId;
  const label = labels.get(node.id) ?? { name: node.agentType || "main", ordinal: null };
  // The root links to the bare route (clean URL); children carry `?agent=`.
  const href = withListReturn(agentHref(view.sessionId, depth === 0 ? undefined : node.id), listReturn);
  const content = (
    <>
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
    </>
  );
  return (
    <>
      {isNodeLinked ? (
        <TreeNodeLink href={href} isCurrent={isCurrent} depth={depth} title={agentLabelText(label)}>
          {content}
        </TreeNodeLink>
      ) : (
        <div
          className="node"
          title={agentLabelText(label)}
          aria-current={isCurrent ? "page" : undefined}
          style={{ "--depth": depth } as CSSProperties}
        >
          {content}
        </div>
      )}
      {node.children.map((child) => (
        <TreeNode
          key={child.id}
          node={child}
          depth={depth + 1}
          view={view}
          labels={labels}
          listReturn={listReturn}
          isNodeLinked={isNodeLinked}
        />
      ))}
    </>
  );
}

/** What the Conversation export's header says beyond the title and session id. */
export type ExportHeaderFacts = {
  projectPath: string;
  /** ISO, or `""` for a Conversation with no dated message. */
  startedAt: string;
  /** Every model the Conversation ran on, full ids. */
  models: string[];
  /** When the export was made. */
  exportedAt: Date;
};

/** The Conversation export's header lines: Project path, start, models, and where the file came from. */
function ExportHeader({ facts }: { facts: ExportHeaderFacts }) {
  // Empty for a Conversation with no dated message: the row is left out.
  const startedAtLabel = formatDate(facts.startedAt).absolute;
  return (
    <>
      <dl className="export-facts">
        <div>
          <dt>Project</dt>
          <dd>{facts.projectPath}</dd>
        </div>
        {startedAtLabel !== "" && (
          <div>
            <dt>Started</dt>
            <dd>{startedAtLabel}</dd>
          </div>
        )}
        <div>
          <dt>Models</dt>
          <dd>{facts.models.map(formatModelName).join(", ")}</dd>
        </div>
      </dl>
      <p className="export-provenance">
        Exported from Claude Conversation Analyzer · {formatDate(facts.exportedAt.toISOString()).absolute}
      </p>
    </>
  );
}
