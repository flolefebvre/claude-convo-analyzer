// The left folder sidebar (issue #10). A SERVER component — no "use client",
// no client JS, no onClick (ADR-0004): it renders plain <a> anchor links whose
// hrefs carry the `?folder=` scope while preserving the active sort. State lives
// entirely in the URL search params; navigation is server-rendered.
//
// ADR-0002 boundary: this never imports core — it receives the already-derived
// `FolderEntry[]` (from `deriveFolders`, app-zone) plus the active sort/scope as
// plain props from the page server component.

import { type FolderEntry } from "@/app/_lib/folders";
import { folderHref, type SortState } from "@/app/_lib/sort";
import { cn } from "@/lib/utils-cn";

/**
 * Render the folder navigation: an "All folders" entry that clears the scope,
 * then one entry per Project (newest-first, already sorted by `deriveFolders`).
 * The entry matching the active `?folder=` (or "All folders" when unscoped) is
 * highlighted. Every href preserves the active `sort` so folder composes with it.
 */
export function FolderSidebar({
  folders,
  activeFolder,
  sort,
  totalCount,
}: {
  folders: FolderEntry[];
  /** The active `?folder=` key, or `undefined` when unscoped ("All folders"). */
  activeFolder: string | undefined;
  sort: SortState;
  /** Total conversation count across all Projects (the "All folders" count). */
  totalCount: number;
}) {
  return (
    <nav aria-label="Folders" className="flex flex-col gap-1">
      <SidebarLink
        href={folderHref(undefined, sort)}
        label="All folders"
        count={totalCount}
        active={activeFolder === undefined}
      />
      {folders.map((entry) => (
        <SidebarLink
          key={entry.folder}
          href={folderHref(entry.folder, sort)}
          label={entry.label}
          title={entry.path}
          count={entry.count}
          active={entry.folder === activeFolder}
        />
      ))}
    </nav>
  );
}

/** A single sidebar anchor: friendly label on the left, count badge on the right. */
function SidebarLink({
  href,
  label,
  title,
  count,
  active,
}: {
  href: string;
  label: string;
  title?: string;
  count: number;
  active: boolean;
}) {
  return (
    <a
      href={href}
      title={title}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
        {count}
      </span>
    </a>
  );
}
