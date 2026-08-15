import { cn } from "@/lib/utils-cn";

export function CostBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div aria-hidden className={cn("h-1.5 w-full overflow-hidden rounded-full bg-cost-muted", className)}>
      <div className="h-full rounded-full bg-cost" style={{ width: `${pct}%` }} />
    </div>
  );
}
