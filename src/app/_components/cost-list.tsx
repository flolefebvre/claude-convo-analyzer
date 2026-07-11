// Shared presentational pieces of the detail panel's ranked cost lists: each
// row pairs a share-of-total bar with its label and cost, mirroring the
// overview band's "top projects by cost" language. No "use client" directive —
// the server-rendered Model/Skill sections and the client sub-agent breakdown
// both import from here, and it renders in whichever zone imports it.

import { CostBar } from "@/app/_components/cost-bar";
import { formatCost } from "@/app/_lib/format";

/** The width of the leading label column, shared so every bar starts aligned. */
export const LABEL_W = "w-40";

export function CostList({ children }: { children: React.ReactNode }) {
  return <ul className="flex flex-col gap-2">{children}</ul>;
}

export function CostRow({
  label,
  costUsd,
  max,
  unpriced = false,
}: {
  label: string;
  costUsd: number;
  /** The breakdown's TOTAL cost → each bar reads as a share of the whole. */
  max: number;
  unpriced?: boolean;
}) {
  return (
    <li className="flex items-center gap-3 text-sm">
      <span className={`${LABEL_W} shrink-0 truncate`} title={label}>
        {label}
      </span>
      <CostBar value={costUsd} max={max} className="min-w-0 flex-1" />
      <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
        {unpriced ? "~" : ""}
        {formatCost(costUsd)}
      </span>
    </li>
  );
}
