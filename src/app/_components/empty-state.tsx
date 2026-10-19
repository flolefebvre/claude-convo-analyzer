// The one empty / not-found / error block: a dashed card with a muted icon, a
// short title, one line of explanation and, when there is one, the next step to
// take (Refresh, widen the range, clear a filter). Every surface that can come
// up empty uses it, so "nothing here" always looks the same and always says
// what to do about it.

import type { LucideIcon } from "lucide-react";

import { PendingLink } from "@/app/_components/pending-link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils-cn";

/**
 * A centred "nothing to show" block with an optional action under the copy.
 * The title is an `h2` by default; a page whose only content is this block
 * (not-found, error) passes `headingLevel={1}`.
 *
 * @example
 * <EmptyState icon={Inbox} title="No conversations yet" action={<CurrentRefreshButton />}>
 *   Scan your Claude Code logs to see your conversations here.
 * </EmptyState>
 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  headingLevel = 2,
  className,
}: {
  icon: LucideIcon;
  title: React.ReactNode;
  /** One line saying why it is empty or what to try. */
  children?: React.ReactNode;
  /** The next step: a button or a link styled as one. */
  action?: React.ReactNode;
  headingLevel?: 1 | 2 | 3;
  className?: string;
}) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-xl border border-dashed bg-card px-6 py-14 text-center",
        className,
      )}
    >
      <span className="mb-4 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <Heading className="text-base font-medium text-balance">{title}</Heading>
      {children && <p className="mt-1 max-w-sm text-sm text-pretty text-muted-foreground">{children}</p>}
      {action && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

/**
 * An empty state's way out to a wider view (drop a filter, a longer range), as
 * an outline button. It only changes view state, so it keeps the scroll
 * position.
 *
 * @example <EmptyStateLink href={rangeHref("all", folder)}>Show all time</EmptyStateLink>
 */
export function EmptyStateLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button asChild variant="outline">
      <PendingLink href={href} scroll={false}>
        {children}
      </PendingLink>
    </Button>
  );
}
