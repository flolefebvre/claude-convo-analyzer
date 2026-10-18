// Shared presentational pieces of the detail panel's ranked cost lists: each
// row pairs a share-of-total bar with its label and cost, the sidebar's
// Folder-row language. No "use client" directive —
// the server-rendered Model/Skill sections and the client sub-agent breakdown
// both import from here, and it renders in whichever zone imports it.

import { CostBar } from "@/app/_components/cost-bar";
import { formatCost } from "@/app/_lib/format";

/** The width of the leading label column, shared so every bar starts aligned;
 *  narrower in a small container (the list table is one) so the bar keeps room. */
export const LABEL_W = "w-28 @lg:w-40";

export function CostList({ children }: { children: React.ReactNode }) {
  return <ul className="flex flex-col gap-2">{children}</ul>;
}

/**
 * One ranked line: label, share-of-total bar, cost.
 *
 * @example <CostRow label="opus-4-8" title="claude-opus-4-8" costUsd={1.2} max={3.4} />
 */
export function CostRow({
  label,
  title = label,
  costUsd,
  max,
  unpriced = false,
}: {
  label: string;
  /** The hover text for a shortened label; the label itself by default. */
  title?: string;
  costUsd: number;
  /** The breakdown's TOTAL cost → each bar reads as a share of the whole. */
  max: number;
  unpriced?: boolean;
}) {
  return (
    <li className="flex items-center gap-3 text-sm">
      <span className={`${LABEL_W} shrink-0 truncate`} title={title}>
        {label}
      </span>
      <CostBar value={costUsd} max={max} className="min-w-0 flex-1" />
      <span
        className="w-20 shrink-0 text-right text-muted-foreground"
        {...(unpriced ? { title: "Excludes unpriced usage — lower bound." } : {})}
      >
        {unpriced ? "~" : ""}
        {formatCost(costUsd)}
      </span>
    </li>
  );
}
