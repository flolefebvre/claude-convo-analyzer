"use client";

// The active-aware sidebar entry (issue #10, PR #13). A small client component:
// the sidebar lives in the shell layout, which CANNOT read `searchParams`
// (they would go stale — Next local docs, layout.md "Query params"), so two
// things that depend on the live URL are decided here via `useSearchParams`:
//   1. the active HIGHLIGHT (which entry is the current Folder scope);
//   2. the link HREF, so clicking a Folder PRESERVES the rest of the active view
//      state — sort, range — which the layout cannot read to thread server-side.
// The component re-renders on client-side `<Link>` navigation, so both track the
// live params without a full reload.
//
// ADR-0002 boundary: this imports NO core values — the label and figures come
// in as `children`, the cost share as a number. Data filtering stays server-side from the URL.

import { useSearchParams } from "next/navigation";

import { PendingLink } from "@/app/_components/pending-link";
import { folderScopeHref, isSameFolderScope, resolveLiveFolderScope } from "@/app/_lib/folder-scope";
import type { FolderScope } from "@/core/project-path";
import { cn } from "@/lib/utils-cn";

/**
 * A single sidebar link, highlighted when its scope is the active one and
 * targeting an href that preserves the rest of the active view state. `scope`
 * is the entry's Folder scope — `{}` for the "All folders" entry (active when
 * the URL carries no folder scope).
 *
 * @example <SidebarLink scope={{ folder: node.path }} title={node.path}>{row}</SidebarLink>
 */
export function SidebarLink({
  scope,
  costShare,
  title,
  className,
  children,
}: {
  /** The Folder scope this entry selects; `{}` for "All folders". */
  scope: FolderScope;
  /** The entry's share of the total spend, in `[0, 1]`, drawn as a data bar behind it; none on "All folders". */
  costShare?: number;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const params = useSearchParams();
  const active = isSameFolderScope(resolveLiveFolderScope(params), scope);
  return (
    // `scroll={false}`: re-scoping keeps your place on the page; the content
    // dims while the new scope loads (PendingLink).
    <PendingLink
      href={folderScopeHref(params.toString(), scope)}
      scroll={false}
      title={title}
      aria-current={active ? "true" : undefined}
      // The data bar and the active wash are both this element's background,
      // so they always span the same box, at any indent.
      style={costShare === undefined ? undefined : ({ "--share": `${costShare * 100}%` } as React.CSSProperties)}
      className={cn(
        // The active scope gets a clay wash + a clay left marker (the `before`
        // bar) — the signature accent, used sparingly.
        "relative flex h-7 items-center rounded-md px-2 text-sm transition-colors",
        costShare !== undefined && "share-bar",
        active
          ? "bg-cost-muted text-foreground before:absolute before:top-1/2 before:left-0 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-r before:bg-cost"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground has-data-link-pending:bg-muted/50 has-data-link-pending:text-foreground",
        className,
      )}
    >
      {children}
    </PendingLink>
  );
}
