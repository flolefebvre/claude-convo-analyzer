// The date-range preset picker shared by the scoped analysis surfaces (Trends,
// Tools): the `?range=` presets as links styled like a segmented control.
// A server component — navigation is plain `<Link>`s, no client state.
//
// The href is the CALLER's business (`hrefFor`): each surface has its own URL
// state to preserve when the range changes — Trends keeps the folder scope,
// Tools keeps folder + sort + expanded row. The picker only knows which preset
// is active.

import Link from "next/link";

import { RANGE_PRESETS, type RangeKey } from "@/app/_lib/range";
import { Button } from "@/components/ui/button";

export function RangePicker({
  active,
  hrefFor,
}: {
  active: RangeKey;
  /** The href a preset button links to, built by the calling surface. */
  hrefFor: (range: RangeKey) => string;
}) {
  return (
    <nav aria-label="Range" className="flex items-center gap-1">
      {RANGE_PRESETS.map((preset) => (
        <Button
          key={preset.value}
          asChild
          size="sm"
          variant={preset.value === active ? "secondary" : "ghost"}
        >
          <Link
            href={hrefFor(preset.value)}
            aria-current={preset.value === active ? "true" : undefined}
          >
            {preset.label}
          </Link>
        </Button>
      ))}
    </nav>
  );
}
