"use client";

// The folder tree on phones and tablets: one line naming the current scope
// ("Folder  acme-api  $12.40"), which opens to the same tree the desktop
// sidebar shows, with the same chevron and name behaviour. A native <details>,
// so the disclosure itself works without JavaScript — the URL is the state.
//
// A client component only to name the selected Folder in the summary: the
// shell layout cannot read `searchParams`. The disclosure is keyed by the
// scope, so picking a Folder lands on a closed disclosure naming the new scope
// (and a tree opened down to it).
//
// ADR-0002 boundary: no core import — the tree and totals arrive as props.

import { ChevronDown, Folder } from "lucide-react";
import { useSearchParams } from "next/navigation";

import { formatFolderCost } from "@/app/_components/folder-rows";
import { resolveLiveFolderScope } from "@/app/_lib/folder-scope";
import { type FolderNode, type FolderTotals, findFolderNode, folderScopeLabel } from "@/app/_lib/folder-tree";
import { cn } from "@/lib/utils-cn";

/**
 * The collapsible folder picker shown below `lg`, wrapping the folder `<nav>`.
 *
 * @example
 * <FolderDisclosure folderTree={folderTree} totals={totals}>
 *   {nav}
 * </FolderDisclosure>
 */
export function FolderDisclosure({
  folderTree,
  totals,
  className,
  children,
}: {
  /** The folder tree's roots, to name the selected Folder. */
  folderTree: FolderNode[];
  /** The totals across all Projects, shown for "All folders". */
  totals: FolderTotals;
  className?: string;
  /** The folder navigation, shown when open. */
  children: React.ReactNode;
}) {
  const scope = resolveLiveFolderScope(useSearchParams());
  const selected = scope.folder ? findFolderNode(folderTree, scope.folder) : undefined;
  const selectedTotals = selected && scope.thisFolderOnly ? (selected.thisFolder ?? selected) : selected;

  return (
    <details
      key={`${scope.folder ?? ""}|${scope.thisFolderOnly}`}
      className={cn("group rounded-xl border bg-card", className)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-muted-foreground">Folder</span>
        <span className="min-w-0 truncate font-medium">
          {selected ? folderScopeLabel(selected, scope) : "All folders"}
        </span>
        <span className="ml-auto shrink-0 text-muted-foreground">{formatFolderCost(selectedTotals ?? totals)}</span>
        <ChevronDown
          className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="max-h-[60vh] overflow-y-auto border-t p-2">{children}</div>
    </details>
  );
}
