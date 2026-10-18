// The left folder sidebar (issue #10). A SERVER component: it server-renders the
// folder labels + counts + cost (scope-independent — derived from ALL
// conversations), so it lives in the root layout and persists across `?folder=`/
// sort navigations without flashing (PR #13).
//
// Beyond navigation it doubles as a spend read-out: each Project shows its summed
// cost and a `CostBar` (the app's signature motif, scaled to the TOTAL spend so
// each bar reads as that Project's share of the whole) so relative spend reads at
// a glance. Ordering stays newest-first — the bars, not the order, carry the cost
// ranking.
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
import { formatCount, formatGrandTotalCost } from "@/app/_lib/format";

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
  // Bars are scaled to the TOTAL spend, so each fills to its Project's share of
  // the whole (matching the conversation detail panel). The "All folders" total
  // deliberately gets no bar — it is the sum (100%), not a peer to rank against.
  return (
    <nav aria-label="Folders" className="flex flex-col gap-1">
      <SidebarLink folder={null}>
        <AllFoldersRow count={totalCount} cost={totalCost} unpriced={totalUnpriced} />
      </SidebarLink>
      {folders.map((entry) => (
        <SidebarLink key={entry.path} folder={entry.path} title={entry.path}>
          <FolderRow entry={entry} total={totalCost} />
        </SidebarLink>
      ))}
    </nav>
  );
}

/** The "All folders" anchor: the same two lines as a Project row — label and
 *  cost, then the count — with no bar (it is the whole, not a share). */
function AllFoldersRow({ count, cost, unpriced }: { count: number; cost: number; unpriced: boolean }) {
  return (
    <>
      <RowHead label={<span className="font-medium">All folders</span>} cost={cost} unpriced={unpriced} />
      <div className="mt-1 flex items-center justify-end">
        <ConversationCount count={count} spelled />
      </div>
    </>
  );
}

/** A Project entry: friendly label + summed cost, then a cost bar (scaled to the
 *  total spend → its share of the whole) with the conversation count. */
function FolderRow({ entry, total }: { entry: FolderEntry; total: number }) {
  return (
    <>
      <RowHead label={entry.label} cost={entry.costUsd} unpriced={entry.unpriced} />
      <div className="mt-1 flex items-center gap-3">
        <CostBar value={entry.costUsd} max={total} className="h-1 min-w-0 flex-1" />
        <ConversationCount count={entry.count} />
      </div>
    </>
  );
}

/** Line one of every entry: the label, truncated, and its cost. */
function RowHead({ label, cost, unpriced }: { label: React.ReactNode; cost: number; unpriced: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="truncate">{label}</span>
      <span
        className="shrink-0 text-xs text-muted-foreground"
        {...(unpriced ? { title: "Includes unpriced model usage — a lower bound." } : {})}
      >
        {unpriced ? "~" : ""}
        {formatGrandTotalCost(cost)}
      </span>
    </div>
  );
}

/** The entry's conversation count: worded on the "All folders" anchor, which
 *  teaches what the bare figures under it mean, and always named for screen readers. */
function ConversationCount({ count, spelled = false }: { count: number; spelled?: boolean }) {
  const noun = `conversation${count === 1 ? "" : "s"}`;
  return (
    <span className="shrink-0 text-xs text-muted-foreground">
      {formatCount(count)}
      <span className={spelled ? undefined : "sr-only"}> {noun}</span>
    </span>
  );
}
