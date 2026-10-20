"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils-cn";

/** The props of {@link PendingButton}: a shadcn `Button`'s, with `isPending` in place of `disabled`. */
export type PendingButtonProps = Omit<React.ComponentProps<typeof Button>, "disabled"> & {
  /** Whether the action the button started is still running; a click meanwhile does nothing. */
  isPending: boolean;
};

/**
 * A shadcn `Button` that ignores clicks while its action is pending, dimmed and
 * `aria-disabled`, but never `disabled`: a disabled button drops the focus to
 * `<body>`, and a keyboard user who pressed it would lose their place.
 *
 * @example <PendingButton isPending={isSwitchPending} onClick={handleClick}>Live</PendingButton>
 */
export function PendingButton({ isPending, onClick, className, ...buttonProps }: PendingButtonProps) {
  return (
    <Button
      {...buttonProps}
      aria-disabled={isPending}
      onClick={(event) => {
        if (isPending) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      className={cn("aria-disabled:opacity-50", className)}
    />
  );
}
