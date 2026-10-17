// The app's signature element: a thin clay bar that visualizes a cost relative
// to a maximum. Repeated in the overview band (top Projects) and the sidebar so
// the same visual language — "cost is a clay bar" — ties the app together.
//
// A SERVER component (no interactivity): it receives plain numbers and renders
// a track + proportional fill. Purely decorative, so it is hidden from the
// accessibility tree (`aria-hidden`) — the adjacent cost figure carries the value.

import { cn } from "@/lib/utils-cn";

/**
 * A track with a fill proportional to `value / max`.
 *
 * @example <CostBar value={band.costUsd} max={view.totalCostUsd} color={band.color} />
 */
export function CostBar({
  value,
  max,
  color,
  className,
}: {
  value: number;
  /** The reference maximum (the largest cost in the set) → full-width fill. */
  max: number;
  /** A series color for the fill (a chart legend's model) on a neutral track; clay when omitted. */
  color?: string;
  className?: string;
}) {
  // Clamp into [0, 100]; a zero/absent max yields an empty (0%) track.
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      aria-hidden
      className={cn("h-1.5 w-full overflow-hidden rounded-full", color ? "bg-muted" : "bg-cost-muted", className)}
    >
      <div
        className={cn("h-full rounded-full", !color && "bg-cost")}
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}
