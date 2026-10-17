"use client";

// The Refresh control (slice 3). A client component so it can manage pending
// state and show the result inline — but it touches core ONLY through the
// `refreshConversations` server action (ADR-0002: no core import from a client
// file). On click it awaits the action, then shows what changed in plain words.
//
// The spinner is driven by an OWN pending flag (set true on click, cleared in
// `finally`), NOT by `useTransition`. A transition's pending state stays true
// until the action's `revalidatePath("/")` re-render of the list commits — and if
// that re-render ever throws (e.g. a hydration mismatch under Cache Components,
// issue #20), the transition never settles and the button freezes forever.
// Tying the flag to the action promise alone means the button always frees when
// the scan finishes; the list still revalidates (the action's revalidation is
// applied by the router regardless of a transition).
//
// While scanning only the icon changes (it spins), so the button keeps its width
// and nothing around it moves. The result appears in a small bubble under the
// button that fades after a few seconds or can be dismissed; a failure stays
// until dismissed. A persistent, visually hidden live region announces both.

import { RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";

import { refreshConversations } from "@/app/actions";
import { formatDuplicateSessionDetail, formatRefreshSummary } from "@/app/_lib/refresh-summary";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils-cn";

/** How long a success message stays up. */
const MESSAGE_MS = 6000;

type Message = {
  text: string;
  /** Multi-line detail behind the line (the duplicate log files), as a tooltip. */
  detail: string | null;
  tone: "status" | "error";
  /** Distinguishes two identical results, so each restarts the fade timer. */
  id: number;
};

/**
 * The Refresh button: re-scans the Claude Code logs and refreshes the page.
 * `collapsible` hides the label below the `sm` breakpoint, leaving the icon
 * (the app bar's phone layout).
 *
 * @example <RefreshButton variant="outline" collapsible />
 */
export function RefreshButton({
  variant = "default",
  size = "default",
  collapsible = false,
}: {
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  collapsible?: boolean;
}) {
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  // A success line clears itself; an error waits for the reader.
  useEffect(() => {
    if (message === null || message.tone === "error") return;
    const timer = setTimeout(() => setMessage(null), MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  async function handleClick() {
    setMessage(null);
    setIsPending(true);
    try {
      const result = await refreshConversations();
      setMessage({
        text: formatRefreshSummary(result.data),
        detail: formatDuplicateSessionDetail(result.data),
        tone: "status",
        id: Date.now(),
      });
    } catch {
      setMessage({
        text: "Refresh failed. Check that your Claude Code logs are readable, then try again.",
        detail: null,
        tone: "error",
        id: Date.now(),
      });
    } finally {
      setIsPending(false);
    }
  }

  return (
    // `relative` so the result bubble can hang below the button without growing
    // this box — the app bar keeps its height.
    <div className="relative flex shrink-0">
      <Button
        variant={variant}
        size={size}
        onClick={handleClick}
        disabled={isPending}
        aria-busy={isPending}
        title="Re-scan your Claude Code logs"
        className={cn(collapsible && "max-sm:w-8 max-sm:px-0")}
      >
        <RefreshCw className={cn(isPending && "animate-spin")} aria-hidden />
        <span className={cn(collapsible && "max-sm:sr-only")}>Refresh</span>
      </Button>

      <p aria-live="polite" className="sr-only">
        {message?.tone === "status" ? message.text : ""}
      </p>
      <p role="alert" className="sr-only">
        {message?.tone === "error" ? message.text : ""}
      </p>

      {message !== null && (
        <div
          key={message.id}
          title={message.detail ?? undefined}
          className={cn(
            "absolute top-full right-0 z-50 mt-2 flex w-max max-w-[min(18rem,calc(100vw-2rem))] animate-in items-start gap-2 rounded-lg border bg-popover py-2 pr-1.5 pl-3 text-xs text-popover-foreground shadow-md fade-in-0 slide-in-from-top-1",
            message.tone === "error" && "border-destructive/40 text-destructive-foreground",
          )}
        >
          <span className="py-1">{message.text}</span>
          <button
            type="button"
            onClick={() => setMessage(null)}
            aria-label="Dismiss"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
