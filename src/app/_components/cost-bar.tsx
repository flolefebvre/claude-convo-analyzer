// The app's signature element: a thin clay bar that visualizes a cost relative
// to a maximum. Repeated in the overview band (top Projects) and the sidebar so
// the same visual language — "cost is a clay bar" — ties the app together.
//
// A SERVER component (no interactivity): it receives plain numbers and renders
// a track + proportional fill. Purely decorative, so it is hidden from the
// accessibility tree (`aria-hidden`) — the adjacent cost figure carries the value.

import { cn } from "@/lib/utils-cn";

export function CostBar({
  value,
  max,
  className,
}: {
  value: number;
  /** The reference maximum (the largest cost in the set) → full-width fill. */
  max: number;
  className?: string;
}) {
  // Clamp into [0, 100]; a zero/absent max yields an empty (0%) track.
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      aria-hidden
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-cost-muted",
        className,
      )}
    >
      <div className="h-full rounded-full bg-cost" style={{ width: `${pct}%` }} />
    </div>
  );
}
