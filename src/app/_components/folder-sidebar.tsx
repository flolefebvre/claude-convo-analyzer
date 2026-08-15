import { CostBar } from "@/app/_components/cost-bar";
import { SidebarLink } from "@/app/_components/sidebar-link";
import { type FolderEntry } from "@/app/_lib/folders";
import { formatGrandTotalCost } from "@/app/_lib/format";

export function FolderSidebar({
  folders,
  totalCount,
  totalCost,
  totalUnpriced,
}: {
  folders: FolderEntry[];
  totalCount: number;
  totalCost: number;
  totalUnpriced: boolean;
}) {
  return (
    <nav aria-label="Folders" className="flex flex-col gap-1">
      <SidebarLink folder={null}>
        <AllFoldersRow count={totalCount} cost={totalCost} unpriced={totalUnpriced} />
      </SidebarLink>
      {folders.map((entry) => (
        <SidebarLink key={entry.folder} folder={entry.folder} title={entry.path}>
          <FolderRow entry={entry} total={totalCost} />
        </SidebarLink>
      ))}
    </nav>
  );
}

function AllFoldersRow({ count, cost, unpriced }: { count: number; cost: number; unpriced: boolean }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium">All folders</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{count}</span>
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

function FolderRow({ entry, total }: { entry: FolderEntry; total: number }) {
  return (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate">{entry.label}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {entry.unpriced ? "~" : ""}
          {formatGrandTotalCost(entry.costUsd)}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <CostBar value={entry.costUsd} max={total} className="min-w-0 flex-1" />
        <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">{entry.count}</span>
      </div>
    </>
  );
}
