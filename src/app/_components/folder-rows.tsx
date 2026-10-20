// The one line of every folder sidebar entry — label, then the conversation
// count and the cost in fixed, right-aligned columns that line up down the
// whole sidebar — shared by the server-rendered "All folders" anchor, the
// Favorites and the client folder tree. Hook-free, so either side can render it.
//
// ADR-0002 boundary: plain numbers and labels in, no core import.

import type { FolderTotals } from "@/app/_lib/folder-tree";
import { formatCount, formatGrandTotalCost } from "@/app/_lib/format";

/** The count column's width; the sidebar skeleton draws the same. */
export const FOLDER_ROW_COUNT_COLUMN = "min-w-8";

/** The cost column's width; the sidebar skeleton draws the same. */
export const FOLDER_ROW_COST_COLUMN = "min-w-16";

/**
 * A sidebar entry's line: its label, truncated, then its conversation count
 * and summed cost. `isCountSpelledOnHover` puts "N conversations" in the
 * count's tooltip — on "All folders", which teaches what the bare figures mean.
 *
 * @example <FolderRow label={node.label} totals={node} />
 */
export function FolderRow({
  label,
  totals,
  isCountSpelledOnHover = false,
}: {
  label: React.ReactNode;
  totals: FolderTotals;
  isCountSpelledOnHover?: boolean;
}) {
  const countNoun = `conversation${totals.count === 1 ? "" : "s"}`;
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span
        className={`${FOLDER_ROW_COUNT_COLUMN} shrink-0 text-right text-xs text-muted-foreground`}
        {...(isCountSpelledOnHover ? { title: `${formatCount(totals.count)} ${countNoun}` } : {})}
      >
        {formatCount(totals.count)}
        <span className="sr-only"> {countNoun}</span>
      </span>
      <span
        className={`${FOLDER_ROW_COST_COLUMN} shrink-0 text-right text-xs text-muted-foreground`}
        {...(totals.unpriced ? { title: "Includes unpriced model usage — a lower bound." } : {})}
      >
        {formatFolderCost(totals)}
      </span>
    </span>
  );
}

/**
 * The 20px column left of every sidebar link: a tree row's chevron, a
 * favorite's grip, or empty — so every label starts on the same line, and a
 * level of the tree indents by exactly its width.
 *
 * @example <SidebarLeadingSlot>{chevron}</SidebarLeadingSlot>
 */
export function SidebarLeadingSlot({ children }: { children?: React.ReactNode }) {
  return <span className="flex w-5 shrink-0 justify-center">{children}</span>;
}

/**
 * A Folder's cost as the sidebar shows it, `~`-prefixed when it is a lower bound.
 *
 * @example formatFolderCost(node) // "~$12.40"
 */
export function formatFolderCost(totals: Pick<FolderTotals, "costUsd" | "unpriced">): string {
  return `${totals.unpriced ? "~" : ""}${formatGrandTotalCost(totals.costUsd)}`;
}

/**
 * A Folder's share of the total spend, in `[0, 1]` — how far its row's data bar reaches.
 *
 * @example folderCostShare(node, totals.costUsd) // 0.25
 */
export function folderCostShare(totals: Pick<FolderTotals, "costUsd">, totalCostUsd: number): number {
  return totalCostUsd > 0 ? Math.min(1, Math.max(0, totals.costUsd / totalCostUsd)) : 0;
}
