"use client";

// The active-aware sidebar entry (issue #10, PR #13). A small client component:
// the sidebar now lives in the root layout, which CANNOT read `searchParams`
// (they would go stale — Next local docs, layout.md "Query params"), so two
// things that depend on the live URL are decided here via `useSearchParams`:
//   1. the active-folder HIGHLIGHT (which entry is the current `?folder=` scope);
//   2. the link HREF, so clicking a folder PRESERVES the active sort (the layout
//      can't read `?sortBy=`/`?dir=` to thread it server-side).
// The component re-renders on client-side `<Link>` navigation, so both track the
// live params without a full reload.
//
// ADR-0002 / ADR-0004 boundary: this imports NO core values — the friendly
// label + count come in as server-rendered `children`, and the `_lib/sort`
// helpers are pure (their `ConversationSummary` import is type-only). Data
// filtering stays server-side from the URL (ADR-0004 amendment).

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { folderHref, resolveSort } from "@/app/_lib/sort";
import { cn } from "@/lib/utils-cn";

/**
 * A single sidebar link, highlighted when its Project is the active scope and
 * targeting an href that preserves the active sort. `folder` is the entry's
 * `?folder=` key, or `null` for the "All folders" entry (active when the URL
 * carries no folder scope). The friendly label + count badge are passed as
 * `children` (server-rendered).
 */
export function SidebarLink({
  folder,
  title,
  children,
}: {
  /** This entry's `?folder=` key, or `null` for the "All folders" entry. */
  folder: string | null;
  title?: string;
  children: React.ReactNode;
}) {
  const params = useSearchParams();
  const rawFolder = params.get("folder");
  const activeFolder = rawFolder ? rawFolder : undefined;
  const active = activeFolder === (folder ?? undefined);
  // Build the href from the LIVE sort so changing folder keeps the current sort
  // (the layout can't read it to pass down). `resolveSort` defaults safely.
  const href = folderHref(
    folder ?? undefined,
    resolveSort(params.get("sortBy") ?? undefined, params.get("dir") ?? undefined),
  );
  return (
    <Link
      href={href}
      title={title}
      aria-current={active ? "true" : undefined}
      className={cn(
        // A block (not inline-flex) so each entry can stack its label/cost over a
        // cost bar. The active scope gets a faint clay wash + a clay left marker
        // (the `before` bar) — the signature accent, used sparingly.
        "relative block rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-cost-muted text-foreground before:absolute before:top-1/2 before:left-0 before:h-7 before:w-[3px] before:-translate-y-1/2 before:rounded-r before:bg-cost"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}
