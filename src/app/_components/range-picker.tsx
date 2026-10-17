// The date-range preset picker shared by the scoped analysis surfaces (Trends,
// Tools): the `?range=` presets as links in a segmented control.
// A server component — navigation is plain links (`PendingLink`, so the page
// dims while the new range loads), no client state. Changing the range keeps
// the scroll position.
//
// The href is the CALLER's business (`hrefFor`): each surface has its own URL
// state to preserve when the range changes — Trends keeps the folder scope,
// Tools keeps folder + sort + expanded row. The picker only knows which preset
// is active.

import { LoadingRegion } from "@/app/_components/loading-region";
import { PendingLink } from "@/app/_components/pending-link";
import { RANGE_PRESETS, type RangeKey } from "@/app/_lib/range";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The picker's Suspense fallback: one strip at the segmented control's size.
 * The picker reads only `searchParams`, so its own boundary lands before the
 * page's data.
 *
 * @example
 * <Suspense fallback={<RangePickerFallback />}>
 *   <ToolsRangePicker searchParams={searchParams} />
 * </Suspense>
 */
export function RangePickerFallback() {
  return (
    <LoadingRegion label="Loading range" className="shrink-0">
      <Skeleton className="h-8 w-[18.875rem] rounded-lg" />
    </LoadingRegion>
  );
}

/**
 * The range presets as a segmented control, styled like the app bar's theme
 * toggle: the active preset is a raised chip, the others only darken on hover.
 *
 * @example <RangePicker active={range} hrefFor={(preset) => rangeHref(preset, folder)} />
 */
export function RangePicker({
  active,
  hrefFor,
}: {
  active: RangeKey;
  /** The href a preset links to, built by the calling surface. */
  hrefFor: (range: RangeKey) => string;
}) {
  return (
    <nav
      aria-label="Range"
      className="inline-flex h-8 shrink-0 items-center rounded-lg bg-muted/60 ring-1 ring-border ring-inset"
    >
      {RANGE_PRESETS.map((preset) => (
        <PendingLink
          key={preset.value}
          href={hrefFor(preset.value)}
          scroll={false}
          aria-current={preset.value === active ? "true" : undefined}
          className="inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground has-data-link-pending:text-foreground aria-[current=true]:bg-background aria-[current=true]:text-foreground aria-[current=true]:shadow-[inset_0_0_0_1px_var(--border),0_1px_2px_0_oklch(0_0_0/0.06)]"
        >
          {preset.label}
        </PendingLink>
      ))}
    </nav>
  );
}
