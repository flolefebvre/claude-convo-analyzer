// A sortable table column header: the whole cell is the link (a full-height,
// full-width target), a faint up/down icon says "sortable" at rest, and the
// active column swaps it for its direction arrow and lifts to full foreground.
// `aria-sort` carries the state to assistive tech. Server-renderable: sorting is
// URL view state, so the caller builds the href.

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { PendingLink } from "@/app/_components/pending-link";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils-cn";

/**
 * A `<th>` whose label links to the toggled sort. `align="right"` for numeric
 * columns puts the icon before the label, so the label's right edge lines up
 * with the figures under it.
 *
 * @example
 * <SortableHead href={sortHref("cost", links)} sort={links.sort.sortBy === "cost" ? links.sort.dir : null} align="right" className="w-24">
 *   Cost
 * </SortableHead>
 */
export function SortableHead({
  href,
  sort,
  align = "left",
  className,
  labelClassName,
  rowSpan,
  children,
}: {
  /** The page with this column's toggled sort. */
  href: string;
  /** This column's direction when it is the active sort, else `null`. */
  sort: "asc" | "desc" | null;
  align?: "left" | "right";
  /** Classes for the `<th>`: width, responsive visibility. */
  className?: string;
  /** Classes for the label text, e.g. `sr-only @xl:not-sr-only` to show only the icon in a narrow column. */
  labelClassName?: string;
  /** For a two-row header: a column outside the column groups spans both rows (pair with `align-bottom`). */
  rowSpan?: number;
  children: React.ReactNode;
}) {
  const Icon = sort === "asc" ? ArrowUp : sort === "desc" ? ArrowDown : ArrowUpDown;
  const icon = (
    <Icon
      aria-hidden
      className={cn("size-3 shrink-0 transition-opacity", sort === null && "opacity-40 group-hover/sort:opacity-80")}
    />
  );
  return (
    <TableHead
      aria-sort={sort === "asc" ? "ascending" : sort === "desc" ? "descending" : "none"}
      rowSpan={rowSpan}
      className={cn("p-0", className)}
    >
      {/* Re-sorting keeps your place in the table (`scroll={false}`). */}
      <PendingLink
        href={href}
        scroll={false}
        className={cn(
          "group/sort flex h-10 w-full items-center gap-1 px-2 micro-label focus-inset transition-colors hover:text-foreground has-data-link-pending:text-foreground",
          align === "right" && "justify-end",
          sort === null ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {align === "right" && icon}
        <span className={labelClassName}>{children}</span>
        {align === "left" && icon}
      </PendingLink>
    </TableHead>
  );
}
