import Link from "next/link";

import { RANGE_PRESETS, type RangeKey } from "@/app/_lib/range";
import { Button } from "@/components/ui/button";

export function RangePicker({ active, hrefFor }: { active: RangeKey; hrefFor: (range: RangeKey) => string }) {
  return (
    <nav aria-label="Range" className="flex items-center gap-1">
      {RANGE_PRESETS.map((preset) => (
        <Button key={preset.value} asChild size="sm" variant={preset.value === active ? "secondary" : "ghost"}>
          <Link href={hrefFor(preset.value)} aria-current={preset.value === active ? "true" : undefined}>
            {preset.label}
          </Link>
        </Button>
      ))}
    </nav>
  );
}
