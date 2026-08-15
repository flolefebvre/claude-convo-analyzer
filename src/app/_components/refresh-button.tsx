"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useState } from "react";

import { refreshConversations } from "@/app/actions";
import { formatDuplicateSessionDetail, formatRefreshSummary } from "@/app/_lib/refresh-summary";
import { Button } from "@/components/ui/button";

export function RefreshButton({
  variant = "default",
  size = "default",
}: {
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
}) {
  const [isPending, setIsPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setIsPending(true);
    try {
      const result = await refreshConversations();
      setStatus(formatRefreshSummary(result.data));
      setDetail(formatDuplicateSessionDetail(result.data));
    } catch {
      setStatus(null);
      setDetail(null);
      setError("Refresh failed. Check the logs and try again.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="relative flex flex-col items-end">
      <Button variant={variant} size={size} onClick={handleClick} disabled={isPending} aria-busy={isPending}>
        {isPending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
        {isPending ? "Scanning…" : "Refresh"}
      </Button>
      {error !== null ? (
        <p role="alert" className="absolute top-full right-0 mt-1 text-xs whitespace-nowrap text-destructive">
          {error}
        </p>
      ) : status !== null ? (
        <p
          aria-live="polite"
          title={detail ?? undefined}
          className="absolute top-full right-0 mt-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}
