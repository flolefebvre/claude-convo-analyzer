"use client";

// The small bubble an app bar control hangs below itself to report what it did:
// a status line, or an error. Its parent is `relative`, so the bubble never
// grows the app bar.

import { X } from "lucide-react";

import { cn } from "@/lib/utils-cn";

/**
 * A control's failure: `text` announced to screen readers, and shown in an
 * error bubble with `failure` as its detail; nothing while `failure` is null.
 * The live region stays mounted, so the announcement is never missed.
 *
 * @example <ControlFailure text="Live could not be switched." failure={failure} onDismiss={() => setFailure(null)} />
 */
export function ControlFailure({
  text,
  failure,
  onDismiss,
}: {
  text: string;
  /** The failure's own message, or null when there is none. */
  failure: string | null;
  onDismiss: () => void;
}) {
  return (
    <>
      <p role="alert" className="sr-only">
        {failure === null ? "" : text}
      </p>
      {failure !== null && <ControlBubble text={text} detail={failure} tone="error" onDismiss={onDismiss} />}
    </>
  );
}

/** The props of {@link ControlBubble}. */
export type ControlBubbleProps = {
  text: string;
  /** Multi-line detail behind the line, as a tooltip. */
  detail: string | null;
  tone: "status" | "error";
  onDismiss: () => void;
};

/**
 * A dismissable bubble under an app bar control.
 *
 * @example <ControlBubble text="Live could not start" detail={failure} tone="error" onDismiss={clear} />
 */
export function ControlBubble({ text, detail, tone, onDismiss }: ControlBubbleProps) {
  return (
    <div
      title={detail ?? undefined}
      className={cn(
        "absolute top-full right-0 z-50 mt-2 flex w-max max-w-[min(18rem,calc(100vw-2rem))] animate-in items-start gap-2 rounded-lg border bg-popover py-2 pr-1.5 pl-3 text-xs text-popover-foreground shadow-md fade-in-0 slide-in-from-top-1",
        tone === "error" && "border-destructive/40 text-destructive-foreground",
      )}
    >
      <span className="py-1">{text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
