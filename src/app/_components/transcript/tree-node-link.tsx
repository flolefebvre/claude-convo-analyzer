"use client";

// The clickable agent-tree node. A thin CLIENT leaf so it can reflect the
// pending state of its own navigation: selecting a node only changes `?agent=`,
// so the router keeps the tree and the current transcript on screen until the
// server's render lands — the route's skeletons don't come back. Without
// feedback the clicked row would stay inert until then, which reads as "my
// click did nothing" and invites repeated clicking.
//
// `useLinkStatus` (a descendant of the `<Link>`) turns on while that navigation
// is in flight; the CSS uses it to highlight the clicked node immediately (via
// `:has(.node-hint.is-pending)`) and pulse a hint dot, until `aria-current`
// takes over. As a `PendingLink`, the node also dims the transcript pane
// (`#main`) while a slow switch is in flight. ADR-0002: imports only
// `next/link` + React — no core.

import { useLinkStatus } from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { PendingLink } from "@/app/_components/pending-link";
import { cn } from "@/lib/utils-cn";

/** The pending dot — fixed-size and always rendered (see CSS) so toggling it
 *  never shifts the row's layout. Must be a descendant of the `<Link>`. */
function NodeHint() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={cn("node-hint", pending && "is-pending")} />;
}

/**
 * One agent row of the tree, linking to that agent's transcript.
 *
 * @example <TreeNodeLink href={agentHref(sessionId, node.id)} isCurrent={false} depth={1}>Plan</TreeNodeLink>
 */
export function TreeNodeLink({
  href,
  isCurrent,
  depth,
  title,
  children,
}: {
  href: string;
  isCurrent: boolean;
  depth: number;
  title?: string;
  children: ReactNode;
}) {
  return (
    <PendingLink
      className="node"
      href={href}
      title={title}
      aria-current={isCurrent ? "page" : undefined}
      style={{ "--depth": depth } as CSSProperties}
    >
      {children}
      <NodeHint />
    </PendingLink>
  );
}
