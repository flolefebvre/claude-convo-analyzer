"use client";

// The Refresh control. A click starts the process-wide Refresh or joins the one
// running, through the `refreshConversations` server action, which returns at
// once (ADR-0002: no core import from a client file). Everything after that
// arrives on the `refresh` Channel: every open page's control follows the same
// run, with `n / m conversations` as its label while it runs.
//
// It starts from a Snapshot of the run taken by its server part
// (`live-refresh-button.tsx`), so a page opened mid-run shows the count at once,
// and resumes the Channel from that Snapshot's position, so no event is missed.
//
// The spinner is driven by OWN flags, NOT by `useTransition`: a transition's
// pending state stays true until the re-render it causes commits, and if that
// re-render ever throws (a hydration mismatch under Cache Components, issue
// #20), the transition never settles and the button freezes forever.
//
// One control per page `reportsOutcome` (the app bar's): it re-renders the page
// during the run (`isRerenderDue`) and once at its end, and shows the summary in
// a small bubble under the button that fades after a few seconds or can be
// dismissed; a failure stays until dismissed. A persistent, visually hidden live
// region announces both. The parser-update banner's control only follows the
// count, so the page gets one bubble and one re-render schedule.

import type { Snapshot } from "@flefebvre/next-sse/client";
import { RefreshCw, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { refreshConversations } from "@/app/actions";
import { isRerenderDue, type RefreshActivity } from "@/app/_lib/refresh-activity";
import { formatDuplicateSessionDetail, formatRefreshProgress, formatRefreshSummary } from "@/app/_lib/refresh-summary";
import { channels, useChannel } from "@/app/_lib/sse.client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils-cn";

/** How long a success message stays up. */
const MESSAGE_MS = 6000;

/** The line shown when a Refresh failed; the failure's own message is its detail. */
const FAILURE_TEXT = "Refresh failed. Check that your Claude Code logs are readable, then try again.";

type Message = {
  text: string;
  /** Multi-line detail behind the line (the duplicate log files, the failure), as a tooltip. */
  detail: string | null;
  tone: "status" | "error";
  /** Distinguishes two identical results, so each restarts the fade timer. */
  id: number;
};

/** How the button looks: its shadcn variant and size, and whether its label collapses on phones. */
type RefreshButtonLook = {
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  /** Hides the label below the `sm` breakpoint, leaving the icon (the app bar's phone layout). */
  collapsible?: boolean;
};

/** The props of {@link RefreshButton}. */
export type RefreshButtonProps = RefreshButtonLook & {
  /** The run as the server part read it, with the Channel position just before. */
  snapshot: Snapshot<RefreshActivity>;
  /** Whether this control re-renders the page and shows the outcome; one per page. */
  reportsOutcome?: boolean;
};

/**
 * The Refresh button: starts or joins the Refresh and follows it live.
 *
 * @example <RefreshButton variant="outline" collapsible snapshot={snapshot} reportsOutcome />
 */
export function RefreshButton({ snapshot, reportsOutcome = false, ...look }: RefreshButtonProps) {
  const router = useRouter();
  const [activity, setActivity] = useState(snapshot.data);
  // A new Snapshot (a re-render of the page) is the run as it stands now.
  const [seenSnapshot, setSeenSnapshot] = useState(snapshot);
  if (seenSnapshot !== snapshot) {
    setSeenSnapshot(snapshot);
    setActivity(snapshot.data);
  }
  // From the click until the action answers.
  const [isClickPending, setIsClickPending] = useState(false);
  // From the click until the Channel's first word on the run it started or joined.
  const [isAwaitingRun, setIsAwaitingRun] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const [isRerenderPending, startRerender] = useTransition();
  const isRerenderPendingRef = useRef(isRerenderPending);
  useEffect(() => {
    isRerenderPendingRef.current = isRerenderPending;
  });
  const lastRerenderAtMs = useRef<number | null>(null);

  function rerenderPage() {
    lastRerenderAtMs.current = Date.now();
    startRerender(() => router.refresh());
  }

  useChannel(
    channels.refresh(),
    {
      progress: (progress) => {
        setActivity({ isRunning: true, progress });
        setIsAwaitingRun(false);
        const isDue = isRerenderDue({
          nowMs: Date.now(),
          lastRerenderAtMs: lastRerenderAtMs.current,
          isTabVisible: document.visibilityState === "visible",
          isRerenderPending: isRerenderPendingRef.current,
        });
        if (reportsOutcome && isDue) rerenderPage();
      },
      finished: ({ summary }) => {
        setActivity({ isRunning: false });
        setIsAwaitingRun(false);
        if (!reportsOutcome) return;
        setMessage({
          text: formatRefreshSummary(summary),
          detail: formatDuplicateSessionDetail(summary),
          tone: "status",
          id: Date.now(),
        });
        rerenderPage();
      },
      failed: ({ message: failure }) => {
        setActivity({ isRunning: false });
        setIsAwaitingRun(false);
        if (!reportsOutcome) return;
        setMessage({ text: FAILURE_TEXT, detail: failure, tone: "error", id: Date.now() });
        // The batches committed before the failure are stored.
        rerenderPage();
      },
    },
    { snapshot },
  );

  // A success line clears itself; an error waits for the reader.
  useEffect(() => {
    if (message === null || message.tone === "error") return;
    const timer = setTimeout(() => setMessage(null), MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  async function handleClick() {
    setMessage(null);
    setIsClickPending(true);
    setIsAwaitingRun(true);
    try {
      await refreshConversations();
    } catch {
      setIsAwaitingRun(false);
      setMessage({ text: FAILURE_TEXT, detail: null, tone: "error", id: Date.now() });
    } finally {
      setIsClickPending(false);
    }
  }

  const isRunning = activity.isRunning || isAwaitingRun;
  const label = activity.isRunning && activity.progress !== null ? formatRefreshProgress(activity.progress) : "Refresh";

  return (
    // `relative` so the result bubble can hang below the button without growing
    // this box — the app bar keeps its height.
    <div className="relative flex shrink-0">
      <RefreshButtonFace
        {...look}
        label={label}
        isRunning={isRunning}
        isDisabled={isClickPending}
        onClick={handleClick}
      />

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

/**
 * The Refresh button as the static shell draws it, until its live part streams
 * in: idle, and inert for that moment.
 *
 * @example <Suspense fallback={<IdleRefreshButton variant="outline" collapsible />}>…</Suspense>
 */
export function IdleRefreshButton(look: RefreshButtonLook) {
  return (
    <div className="relative flex shrink-0">
      <RefreshButtonFace {...look} label="Refresh" isRunning={false} isDisabled={false} />
    </div>
  );
}

/** The button itself: the icon spins while a Refresh runs, the label carries its count. */
function RefreshButtonFace({
  variant = "default",
  size = "default",
  collapsible = false,
  label,
  isRunning,
  isDisabled,
  onClick,
}: RefreshButtonLook & { label: string; isRunning: boolean; isDisabled: boolean; onClick?: () => void }) {
  return (
    <Button
      variant={variant}
      size={size}
      onClick={onClick}
      disabled={isDisabled}
      aria-busy={isRunning}
      title="Re-scan your Claude Code logs"
      className={cn("tabular-nums", collapsible && "max-sm:w-8 max-sm:px-0")}
    >
      <RefreshCw className={cn(isRunning && "animate-spin")} aria-hidden />
      <span className={cn(collapsible && "max-sm:sr-only")}>{label}</span>
    </Button>
  );
}
