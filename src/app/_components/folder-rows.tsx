// The two lines of every folder sidebar entry — label and cost, then a cost bar
// and the conversation count — shared by the server-rendered "All folders"
// anchor and the client folder tree. Hook-free, so either side can render it.
//
// ADR-0002 boundary: plain numbers and labels in, no core import.

import { CostBar } from "@/app/_components/cost-bar";
import type { FolderTotals } from "@/app/_lib/folder-tree";
import { formatCount, formatGrandTotalCost } from "@/app/_lib/format";

/**
 * The "All folders" anchor: the same two lines as a Folder row — label and
 * cost, then the count — with no bar (it is the whole, not a share).
 *
 * @example <AllFoldersRow totals={{ count: 64, costUsd: 120.5, unpriced: false }} />
 */
export function AllFoldersRow({ totals }: { totals: FolderTotals }) {
  return (
    <>
      <RowHead label={<span className="font-medium">All folders</span>} totals={totals} />
      <div className="mt-1 flex items-center justify-end">
        <ConversationCount count={totals.count} spelled />
      </div>
    </>
  );
}

/**
 * A Folder entry: its label and summed cost, then a cost bar (scaled to the
 * total spend → its share of the whole) with the conversation count.
 *
 * @example <FolderRow label="acme-api" totals={node} totalCostUsd={totals.costUsd} />
 */
export function FolderRow({
  label,
  totals,
  totalCostUsd,
}: {
  label: React.ReactNode;
  totals: FolderTotals;
  /** The spend across every Project, which every bar is a share of. */
  totalCostUsd: number;
}) {
  return (
    <>
      <RowHead label={label} totals={totals} />
      <div className="mt-1 flex items-center gap-3">
        <CostBar value={totals.costUsd} max={totalCostUsd} className="h-1 min-w-0 flex-1" />
        <ConversationCount count={totals.count} />
      </div>
    </>
  );
}

/** Line one of every entry: the label, truncated, and its cost. */
function RowHead({ label, totals }: { label: React.ReactNode; totals: FolderTotals }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="truncate">{label}</span>
      <span
        className="shrink-0 text-xs text-muted-foreground"
        {...(totals.unpriced ? { title: "Includes unpriced model usage — a lower bound." } : {})}
      >
        {formatFolderCost(totals)}
      </span>
    </div>
  );
}

/**
 * A Folder's cost as the sidebar shows it, `~`-prefixed when it is a lower bound.
 *
 * @example formatFolderCost(node) // "~$12.40"
 */
export function formatFolderCost(totals: Pick<FolderTotals, "costUsd" | "unpriced">): string {
  return `${totals.unpriced ? "~" : ""}${formatGrandTotalCost(totals.costUsd)}`;
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
