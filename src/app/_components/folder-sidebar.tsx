// The left folder sidebar (issue #10). A SERVER component: it renders the
// "All folders" anchor and hands the folder tree (scope-independent — derived
// from ALL conversations) to the client `FolderTree`, so it lives in the shell
// layout and persists across `?folder=`/sort navigations without flashing
// (PR #13).
//
// Beyond navigation it doubles as a spend read-out: each Folder shows its summed
// cost and a `CostBar` (the app's signature motif, scaled to the TOTAL spend at
// every depth, so each bar reads as that Folder's share of the whole). Ordering
// stays newest-first — the bars, not the order, carry the cost ranking.
//
// The active-entry HIGHLIGHT, the link HREFs and the open Folders are the
// client-driven pieces: layouts cannot read `searchParams`, so each entry is a
// `<SidebarLink>` ("use client") that reads the live URL. No data filtering
// happens on the client — that stays server-side from the URL.
//
// ADR-0002 boundary: this never imports core — it receives the already-derived
// tree (from `deriveFolderTree`, app-zone) as plain props from the layout.

import { AllFoldersRow } from "@/app/_components/folder-rows";
import { FolderTree } from "@/app/_components/folder-tree";
import { SidebarLink } from "@/app/_components/sidebar-link";
import type { FolderNode, FolderTotals } from "@/app/_lib/folder-tree";

/**
 * Render the folder navigation: an "All folders" entry (the spend anchor: total
 * count + total cost, no bar) above the folder tree.
 *
 * @example <FolderSidebar folderTree={folderTree} totals={totals} />
 */
export function FolderSidebar({ folderTree, totals }: { folderTree: FolderNode[]; totals: FolderTotals }) {
  // The "All folders" total deliberately gets no bar — it is the sum (100%),
  // not a peer to rank against.
  return (
    <nav aria-label="Folders" className="flex flex-col gap-1">
      <SidebarLink scope={{}}>
        <AllFoldersRow totals={totals} />
      </SidebarLink>
      <FolderTree roots={folderTree} totalCostUsd={totals.costUsd} />
    </nav>
  );
}
