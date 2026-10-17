// The title row every page opens with: the page's `h1`, a one-line description
// under it, and the page-level controls (a range picker, say) on the right,
// wrapping under the title on narrow screens. The app's name lives in the app
// bar; this row names the page you are on.

import { cn } from "@/lib/utils-cn";

/**
 * A page's `h1` with its description and optional controls.
 *
 * @example
 * <PageHeader title="Daily spend" description="What Claude Code cost per day, split by model.">
 *   <RangePicker active={range} hrefFor={hrefFor} />
 * </PageHeader>
 */
export function PageHeader({
  title,
  description,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Page-level controls, aligned to the right of the title. */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-3", className)}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-balance">{title}</h1>
        {description && <p className="mt-1 text-sm text-pretty text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}
