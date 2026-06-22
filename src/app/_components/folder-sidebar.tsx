// The left folder sidebar (issue #10). A SERVER component: it server-renders the
// folder labels + counts + cost (scope-independent — derived from ALL
// conversations), so it lives in the root layout and persists across `?folder=`/
// sort navigations without flashing (ADR-0004 amendment, PR #13).
//
// Beyond navigation it doubles as a spend read-out: each Project shows its summed
// cost and a `CostBar` (the app's signature motif, scaled to the costliest
// Project) so relative spend reads at a glance. Ordering stays newest-first — the
// bars, not the order, carry the cost ranking.
//
// The active-entry HIGHLIGHT and the link HREFs are the client-driven pieces:
// layouts cannot read `searchParams`, so each entry is a `<SidebarLink>`
// ("use client") that reads the live URL via `useSearchParams` to decide active
// state and to preserve the current sort in its href. No data filtering happens
// on the client — that stays server-side from the URL.
//
// ADR-0002 boundary: this never imports core — it receives the already-derived
// `FolderEntry[]` (from `deriveFolders`, app-zone) as plain props from the layout.

import { CostBar } from "@/app/_components/cost-bar";
import { SidebarLink } from "@/app/_components/sidebar-link";
import { type FolderEntry } from "@/app/_lib/folders";
import { formatGrandTotalCost } from "@/app/_lib/format";

/**
 * Render the folder navigation: an "All folders" entry (the spend anchor: total
 * count + total cost, no bar) followed by one entry per Project (newest-first,
 * already sorted by `deriveFolders`) with its cost bar. The active entry +
 * sort-preserving hrefs are resolved client-side per entry (`SidebarLink`).
 */
export function FolderSidebar({
  folders,
  totalCount,
  totalCost,
  totalUnpriced,
}: {
  folders: FolderEntry[];
  /** Total conversation count across all Projects (the "All folders" count). */
  totalCount: number;
  /** Summed cost across all Projects (the "All folders" total). */
  totalCost: number;
  /** True when any Project's cost is a lower bound (unpriced usage). */
  totalUnpriced: boolean;
}) {
  // The costliest single Project sets the bar scale, so every per-folder bar is
  // comparable (the "All folders" total deliberately gets no bar — it is the
  // sum, not a peer to rank against).
  const maxCost = Math.max(0, ...folders.map((f) => f.costUsd));
  return (
    <nav aria-label="Folders" className="flex flex-col gap-1">
      <SidebarLink folder={null}>
        <AllFoldersRow
          count={totalCount}
          cost={totalCost}
          unpriced={totalUnpriced}
        />
      </SidebarLink>
      {folders.map((entry) => (
        <SidebarLink key={entry.folder} folder={entry.folder} title={entry.path}>
          <FolderRow entry={entry} maxCost={maxCost} />
        </SidebarLink>
      ))}
    </nav>
  );
}

/** The "All folders" anchor: total count up top, total cost on a quiet second
 *  line labelled "Total" — visually distinct from the ranked per-folder rows. */
function AllFoldersRow({
  count,
  cost,
  unpriced,
}: {
  count: number;
  cost: number;
  unpriced: boolean;
}) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium">All folders</span>
        <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
          {count}
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
        <span>Total</span>
        <span className="tabular-nums">
          {unpriced ? "~" : ""}
          {formatGrandTotalCost(cost)}
        </span>
      </div>
    </>
  );
}

/** A Project entry: friendly label + summed cost, then a cost bar (scaled to the
 *  costliest Project) with the conversation count at the far right. */
function FolderRow({ entry, maxCost }: { entry: FolderEntry; maxCost: number }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate">{entry.label}</span>
        <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
          {entry.unpriced ? "~" : ""}
          {formatGrandTotalCost(entry.costUsd)}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <CostBar value={entry.costUsd} max={maxCost} className="min-w-0 flex-1" />
        <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
          {entry.count}
        </span>
      </div>
    </>
  );
}
