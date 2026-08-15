import { CostBar } from "@/app/_components/cost-bar";
import { formatCost } from "@/app/_lib/format";

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
  max: number;
  unpriced?: boolean;
}) {
  return (
    <li className="flex items-center gap-3 text-sm">
      <span className={`${LABEL_W} shrink-0 truncate`} title={label}>
        {label}
      </span>
      <CostBar value={costUsd} max={max} className="min-w-0 flex-1" />
      <span className="w-20 shrink-0 text-right text-muted-foreground tabular-nums">
        {unpriced ? "~" : ""}
        {formatCost(costUsd)}
      </span>
    </li>
  );
}
