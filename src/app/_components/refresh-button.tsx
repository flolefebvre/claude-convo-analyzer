"use client";

// The Refresh control (slice 3). A client component so it can manage pending
// state and show the result inline — but it touches core ONLY through the
// `refreshConversations` server action (ADR-0002: no core import from a client
// file). On click it awaits the action, then renders a digest of the returned
// RefreshSummary.
//
// The spinner is driven by an OWN pending flag (set true on click, cleared in
// `finally`), NOT by `useTransition`. A transition's pending state stays true
// until the action's `revalidatePath("/")` re-render of the list commits — and if
// that re-render ever throws (e.g. a hydration mismatch under Cache Components,
// issue #20), the transition never settles and the button freezes on "Scanning…"
// forever. Tying the flag to the action promise alone means the button always
// frees when the scan finishes; the list still revalidates (the action's
// revalidation is applied by the router regardless of a transition).

import { Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";

import { refreshConversations } from "@/app/actions";
import { formatRefreshSummary } from "@/app/_lib/refresh-summary";
import { Button } from "@/components/ui/button";

export function RefreshButton() {
  const [isPending, setIsPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setIsPending(true);
    try {
      const summary = await refreshConversations();
      setStatus(formatRefreshSummary(summary));
    } catch {
      setStatus(null);
      setError("Refresh failed. Check the logs and try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    // `relative` so the result line can be absolutely positioned BELOW the button
    // without growing this box. The digest only appears after a refresh; if it
    // sat in normal flow it would tall-en the header row and re-center the
    // sibling theme toggle (and the title) — a post-refresh layout jump.
    <div className="relative flex flex-col items-end">
      <Button onClick={handleClick} disabled={isPending} aria-busy={isPending}>
        {isPending ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <RefreshCw aria-hidden />
        )}
        {isPending ? "Scanning…" : "Refresh"}
      </Button>
      {error !== null ? (
        <p
          role="alert"
          className="absolute top-full right-0 mt-1 whitespace-nowrap text-xs text-destructive"
        >
          {error}
        </p>
      ) : status !== null ? (
        <p
          aria-live="polite"
          className="absolute top-full right-0 mt-1 whitespace-nowrap text-xs text-muted-foreground tabular-nums"
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}
