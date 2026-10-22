"use client";

// The Refresh control. A click starts the process-wide Refresh or joins the one
// running, through the `refreshConversations` server action, which returns at
// once (ADR-0002: no core import from a client file). Everything after that
// arrives on the `refresh` Channel: every open page's control follows the same
// run, with `n / m conversations` as its label while it runs (`n / m` on the
// app bar's, whose screen-reader label keeps the noun).
//
// It starts from a Snapshot of the run taken by its server part
// (`current-refresh-button.tsx`), so a page opened mid-run shows the count at once,
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
// region announces both. A Refresh Live began gets no success bubble, only its
// re-render, unless this control's click joined it; its failure shows like any
// other. The one the app began at startup gets its bubble: it is one per boot,
// and tells the user their data arrived. The parser-update banner's control
// only follows the count, so the page gets one bubble and one re-render
// schedule.

import type { Snapshot } from "@flefebvre/next-sse/client";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { ControlBubble } from "@/app/_components/control-bubble";
import { PendingButton, type PendingButtonProps } from "@/app/_components/pending-button";
import { refreshConversations } from "@/app/actions";
import { isRerenderDue, type RefreshActivity, type RefreshRunId } from "@/app/_lib/refresh-activity";
import {
  formatDuplicateSessionDetail,
  formatRefreshProgress,
  formatRefreshProgressCounts,
  formatRefreshSummary,
} from "@/app/_lib/refresh-summary";
import { channels, useChannel } from "@/app/_lib/sse.client";
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

/** How the button looks: its shadcn variant and size, and whether its label collapses below 1280px. */
type RefreshButtonLook = {
  variant?: PendingButtonProps["variant"];
  size?: PendingButtonProps["size"];
  /**
   * The app bar's look: below the `xl` breakpoint (1280px) the label is hidden,
   * leaving the icon; from it, a running Refresh shows its counts alone ("n / m").
   */
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
 * The Refresh button: starts or joins the Refresh and follows it as it runs.
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
  // From the click until the outcome of the run it started or joined: that
  // outcome is reported even when Live began the run.
  const isClickOutcomeOwed = useRef(false);
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

  // The run whose outcome this control last reported. A new Snapshot reopens the
  // Channel from its own position, so the replay can bring that outcome again.
  const handledOutcomeRunId = useRef<RefreshRunId | null>(null);

  /** Whether `runId`'s outcome is not reported yet; records it as reported. */
  function claimOutcome(runId: RefreshRunId): boolean {
    if (handledOutcomeRunId.current === runId) return false;
    handledOutcomeRunId.current = runId;
    return true;
  }

  useChannel(
    channels.refresh(),
    {
      progress: ({ runId, ...progress }) => {
        setActivity({ isRunning: true, runId, progress });
        setIsAwaitingRun(false);
        const isDue = isRerenderDue({
          nowMs: Date.now(),
          lastRerenderAtMs: lastRerenderAtMs.current,
          isTabVisible: document.visibilityState === "visible",
          isRerenderPending: isRerenderPendingRef.current,
        });
        if (reportsOutcome && isDue) rerenderPage();
      },
      finished: ({ runId, origin, summary }) => {
        setActivity({ isRunning: false });
        setIsAwaitingRun(false);
        const isOwedToClick = isClickOutcomeOwed.current;
        isClickOutcomeOwed.current = false;
        if (!reportsOutcome || !claimOutcome(runId)) return;
        rerenderPage();
        // Live lands a Refresh every few seconds while it follows a session:
        // a bubble for each would be noise, unless this control's click joined it.
        if (origin === "live" && !isOwedToClick) return;
        setMessage({
          text: formatRefreshSummary(summary),
          detail: formatDuplicateSessionDetail(summary),
          tone: "status",
          id: Date.now(),
        });
      },
      failed: ({ runId, message: failure }) => {
        setActivity({ isRunning: false });
        setIsAwaitingRun(false);
        isClickOutcomeOwed.current = false;
        if (!reportsOutcome || !claimOutcome(runId)) return;
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
    isClickOutcomeOwed.current = true;
    try {
      await refreshConversations();
    } catch {
      setIsAwaitingRun(false);
      isClickOutcomeOwed.current = false;
      setMessage({ text: FAILURE_TEXT, detail: null, tone: "error", id: Date.now() });
    } finally {
      setIsClickPending(false);
    }
  }

  const isRunning = activity.isRunning || isAwaitingRun;
  const progress = activity.isRunning ? activity.progress : null;
  const label = progress !== null ? formatRefreshProgress(progress) : "Refresh";
  // The app bar has no room for the noun; its screen-reader label keeps it.
  const shownLabel = progress !== null && look.collapsible ? formatRefreshProgressCounts(progress) : label;

  return (
    // `relative` so the result bubble can hang below the button without growing
    // this box — the app bar keeps its height.
    <div className="relative flex shrink-0">
      <RefreshButtonFace
        {...look}
        label={label}
        shownLabel={shownLabel}
        isRunning={isRunning}
        isPending={isClickPending}
        onClick={handleClick}
      />

      <p aria-live="polite" className="sr-only">
        {message?.tone === "status" ? message.text : ""}
      </p>
      <p role="alert" className="sr-only">
        {message?.tone === "error" ? message.text : ""}
      </p>

      {message !== null && (
        <ControlBubble
          key={message.id}
          text={message.text}
          detail={message.detail}
          tone={message.tone}
          onDismiss={() => setMessage(null)}
        />
      )}
    </div>
  );
}

/**
 * The Refresh button as the static shell draws it, until its per-request part streams
 * in: idle, and inert for that moment.
 *
 * @example <Suspense fallback={<IdleRefreshButton variant="outline" collapsible />}>…</Suspense>
 */
export function IdleRefreshButton(look: RefreshButtonLook) {
  return (
    <div className="relative flex shrink-0">
      <RefreshButtonFace {...look} label="Refresh" isRunning={false} isPending={false} />
    </div>
  );
}

/**
 * The button itself: the icon spins while a Refresh runs, the label carries its
 * count. A `shownLabel` other than `label` is what the eye reads, while
 * screen readers read `label`.
 */
function RefreshButtonFace({
  variant = "default",
  size = "default",
  collapsible = false,
  label,
  shownLabel = label,
  isRunning,
  isPending,
  onClick,
}: RefreshButtonLook & {
  label: string;
  shownLabel?: string;
  isRunning: boolean;
  isPending: boolean;
  onClick?: () => void;
}) {
  return (
    <PendingButton
      variant={variant}
      size={size}
      onClick={onClick}
      isPending={isPending}
      aria-busy={isRunning}
      title="Re-scan your Claude Code logs"
      className={cn("tabular-nums", collapsible && "max-xl:w-8 max-xl:px-0")}
    >
      <RefreshCw className={cn(isRunning && "animate-spin")} aria-hidden />
      {shownLabel === label ? (
        <span className={cn(collapsible && "max-xl:sr-only")}>{label}</span>
      ) : (
        <>
          <span aria-hidden className={cn(collapsible && "max-xl:hidden")}>
            {shownLabel}
          </span>
          <span className="sr-only">{label}</span>
        </>
      )}
    </PendingButton>
  );
}
