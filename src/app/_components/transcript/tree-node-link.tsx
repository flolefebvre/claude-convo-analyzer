"use client";

// The clickable agent-tree node. A thin CLIENT leaf so it can reflect the
// pending state of its own navigation: selecting a node is a dynamic server
// round-trip (`?agent=<id>`) with no `loading.js` to give an instant transition,
// so without this the clicked row stays visually inert until the server answers
// — which reads as "my click did nothing" and invites repeated clicking.
//
// `useLinkStatus` (a descendant of the `<Link>`) turns on while that navigation
// is in flight; the CSS uses it to highlight the clicked node immediately (via
// `:has(.node-hint.is-pending)`) and pulse a hint dot, until the server render
// lands and `aria-current` takes over. `prefetch={false}` guarantees the pending
// phase is not skipped. ADR-0002: imports only `next/link` + React — no core.

import Link, { useLinkStatus } from "next/link";
import type { CSSProperties, ReactNode } from "react";

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
    <Link
      className="node"
      href={href}
      prefetch={false}
      title={title}
      aria-current={isCurrent ? "page" : undefined}
      style={{ "--depth": depth } as CSSProperties}
    >
      {children}
      <NodeHint />
    </Link>
  );
}
