"use client";

import Link, { useLinkStatus } from "next/link";
import type { CSSProperties, ReactNode } from "react";

function NodeHint() {
  const { pending } = useLinkStatus();
  return <span aria-hidden className={`node-hint${pending ? "is-pending" : ""}`} />;
}

export function TreeNodeLink({
  href,
  isCurrent,
  depth,
  children,
}: {
  href: string;
  isCurrent: boolean;
  depth: number;
  children: ReactNode;
}) {
  return (
    <Link
      className="node"
      href={href}
      prefetch={false}
      aria-current={isCurrent ? "true" : undefined}
      style={{ "--depth": depth } as CSSProperties}
    >
      {children}
      <NodeHint />
    </Link>
  );
}
