"use client";

// The Refresh control (slice 3). A client component so it can manage pending
// state and show the result inline — but it touches core ONLY through the
// `refreshConversations` server action (ADR-0002: no core import from a client
// file). On click it runs the action inside a transition (so the awaited
// revalidation of `/` and the resulting server re-render are tracked as pending),
// then renders a digest of the returned RefreshSummary.

import { Loader2, RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";

import { refreshConversations } from "@/app/actions";
import { formatRefreshSummary } from "@/app/_lib/refresh-summary";
import { Button } from "@/components/ui/button";

export function RefreshButton() {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const summary = await refreshConversations();
        setStatus(formatRefreshSummary(summary));
      } catch {
        setStatus(null);
        setError("Refresh failed. Check the logs and try again.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={handleClick} disabled={isPending} aria-busy={isPending}>
        {isPending ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          <RefreshCw aria-hidden />
        )}
        {isPending ? "Scanning…" : "Refresh"}
      </Button>
      {error !== null ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : status !== null ? (
        <p
          aria-live="polite"
          className="text-xs text-muted-foreground tabular-nums"
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}
