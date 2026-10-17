// The headline-figures strip shared by the list's overview band, Trends and
// Tools: one card split into cells (the 1px gaps show the border colour), so a
// few figures read as one strip rather than as competing cards. Every cell has
// a hint line, so cell heights match.

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
