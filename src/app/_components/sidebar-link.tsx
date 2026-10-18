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
// in as `children`. Data filtering stays server-side from the URL.

import { useSearchParams } from "next/navigation";

import { PendingLink } from "@/app/_components/pending-link";
import { folderScopeHref, isSameFolderScope, resolveFolderScope, type FolderScope } from "@/app/_lib/folder-scope";
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
  title,
  className,
  children,
}: {
  /** The Folder scope this entry selects; `{}` for "All folders". */
  scope: FolderScope;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const params = useSearchParams();
  const active = isSameFolderScope(
    resolveFolderScope({
      folder: params.get("folder") ?? undefined,
      thisFolder: params.get("thisFolder") ?? undefined,
    }),
    scope,
  );
  return (
    // `scroll={false}`: re-scoping keeps your place on the page; the content
    // dims while the new scope loads (PendingLink).
    <PendingLink
      href={folderScopeHref(params.toString(), scope)}
      scroll={false}
      title={title}
      aria-current={active ? "true" : undefined}
      className={cn(
        // A block (not inline-flex) so each entry can stack its label/cost over a
        // cost bar. The active scope gets a faint clay wash + a clay left marker
        // (the `before` bar) — the signature accent, used sparingly.
        "relative block rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-cost-muted text-foreground before:absolute before:top-1/2 before:left-0 before:h-7 before:w-[3px] before:-translate-y-1/2 before:rounded-r before:bg-cost"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground has-data-link-pending:bg-muted/50 has-data-link-pending:text-foreground",
        className,
      )}
    >
      {children}
    </PendingLink>
  );
}
