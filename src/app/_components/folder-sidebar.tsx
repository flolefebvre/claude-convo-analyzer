// The left folder sidebar (issue #10). A SERVER component: it server-renders the
// folder labels + counts (scope-independent — derived from ALL conversations),
// so it lives in the root layout and persists across `?folder=`/sort navigations
// without flashing (ADR-0004 amendment, PR #13).
//
// The active-entry HIGHLIGHT and the link HREFs are the client-driven pieces:
// layouts cannot read `searchParams`, so each entry is a `<SidebarLink>`
// ("use client") that reads the live URL via `useSearchParams` to decide active
// state and to preserve the current sort in its href. No data filtering happens
// on the client — that stays server-side from the URL.
//
// ADR-0002 boundary: this never imports core — it receives the already-derived
// `FolderEntry[]` (from `deriveFolders`, app-zone) as plain props from the layout.

import { SidebarLink } from "@/app/_components/sidebar-link";
import { type FolderEntry } from "@/app/_lib/folders";

/**
 * Render the folder navigation: an "All folders" entry that clears the scope,
 * then one entry per Project (newest-first, already sorted by `deriveFolders`).
 * The active entry + sort-preserving hrefs are resolved client-side per entry
 * (`SidebarLink`/`useSearchParams`); labels and counts are server-rendered here.
 */
export function FolderSidebar({
  folders,
  totalCount,
}: {
  folders: FolderEntry[];
  /** Total conversation count across all Projects (the "All folders" count). */
  totalCount: number;
}) {
  return (
    <nav aria-label="Folders" className="flex flex-col gap-1">
      <SidebarLink folder={null}>
        <SidebarRow label="All folders" count={totalCount} />
      </SidebarLink>
      {folders.map((entry) => (
        <SidebarLink key={entry.folder} folder={entry.folder} title={entry.path}>
          <SidebarRow label={entry.label} count={entry.count} />
        </SidebarLink>
      ))}
    </nav>
  );
}

/** The server-rendered contents of a sidebar entry: friendly label on the left,
 *  count badge on the right. Passed as `children` to the client `SidebarLink`. */
function SidebarRow({ label, count }: { label: string; count: number }) {
  return (
    <>
      <span className="truncate">{label}</span>
      <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
        {count}
      </span>
    </>
  );
}
