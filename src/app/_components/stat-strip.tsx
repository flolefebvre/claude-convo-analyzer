// The headline-figures strip shared by the list's overview band, Trends and
// Tools: one card split into cells (the 1px gaps show the border colour), so a
// few figures read as one strip rather than as competing cards. Every cell has
// a hint line, so cell heights match.

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils-cn";

/**
 * The strip's `<dl>`; the caller sets its columns.
 *
 * @example
 * <StatStrip className="grid-cols-2 sm:grid-cols-4">
 *   <Stat label="Tokens" hint="63,727,736 total">63.7M</Stat>
 * </StatStrip>
 */
export function StatStrip({ className, children }: { className?: string; children: React.ReactNode }) {
  return <dl className={cn("grid gap-px overflow-hidden rounded-xl border bg-border", className)}>{children}</dl>;
}

/**
 * One headline figure: caption, value, and a one-line hint under it.
 *
 * @example <Stat label="Tool calls" hint="8 distinct tools">490</Stat>
 */
export function Stat({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col bg-card px-4 py-3">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight">{children}</dd>
      <dd className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</dd>
    </div>
  );
}

/**
 * A {@link Stat}'s skeleton at its three lines' heights, for a strip drawn in a
 * Suspense fallback (a `div` grid, since the cells hold no terms).
 *
 * @example
 * <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border bg-border">
 *   <StatSkeleton />
 * </div>
 */
export function StatSkeleton() {
  return (
    <div className="flex flex-col bg-card px-4 py-3">
      <div className="flex h-5 items-center">
        <Skeleton className="h-3.5 w-20" />
      </div>
      <div className="mt-1 flex h-8 items-center">
        <Skeleton className="h-6 w-24" />
      </div>
      <div className="mt-0.5 flex h-4 items-center">
        <Skeleton className="h-3 w-28" />
      </div>
    </div>
  );
}
