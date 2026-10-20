"use client";

// The Live switch in the app bar, beside Refresh. A click turns Live on or off
// through the `setLive` server action (ADR-0002: no core import from a client
// file), whose answer is the toggle's new state, even when it failed. A pulsing
// dot shows while Live is on; the Refreshes Live begins show on the Refresh
// button. It starts from Live's state as its server part
// (`current-live-toggle.tsx`) read it; a re-render of the page brings it up to
// date, as another tab may have switched it.

import { useRouter } from "next/navigation";
import { useState } from "react";

import { ControlFailure } from "@/app/_components/control-bubble";
import { PendingButton } from "@/app/_components/pending-button";
import { setLive } from "@/app/actions";
import { cn } from "@/lib/utils-cn";

/** The line shown when Live could not be switched; the failure's own message is its detail. */
const FAILURE_TEXT = "Live could not be switched. Hover for the reason, then try again.";

/** Live as the server part read it; each render of that part sends a new object. */
export type LiveAsRendered = { isOn: boolean };

/**
 * The Live toggle: switches Live and shows whether it is on.
 *
 * @example <LiveToggle live={{ isOn: getLive().isOn() }} />
 */
export function LiveToggle({ live }: { live: LiveAsRendered }) {
  const router = useRouter();
  const [isLiveOn, setIsLiveOn] = useState(live.isOn);
  // A new render of the server part is Live as it stands now, even when it
  // reads the same as the last one: a click may have moved the toggle since.
  const [seenLive, setSeenLive] = useState(live);
  if (seenLive !== live) {
    setSeenLive(live);
    setIsLiveOn(live.isOn);
  }
  const [isSwitchPending, setIsSwitchPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function handleClick() {
    setFailure(null);
    setIsSwitchPending(true);
    try {
      const result = await setLive({ on: !isLiveOn });
      if (result.status === "success") {
        setIsLiveOn(result.data.isLiveOn);
        // Switched off, the page re-renders without its Active now markers;
        // switched on, the catch-up Refresh re-renders it.
        if (!result.data.isLiveOn) router.refresh();
      } else if (result.error.type === "liveNotSwitched") {
        setIsLiveOn(result.error.data.isLiveOn);
        setFailure(result.error.data.message);
      } else {
        setFailure("The switch was refused.");
      }
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSwitchPending(false);
    }
  }

  return (
    // `relative` so the error bubble can hang below the toggle without growing
    // this box — the app bar keeps its height.
    <div className="relative flex shrink-0">
      <LiveToggleFace isLiveOn={isLiveOn} isPending={isSwitchPending} onClick={handleClick} />
      <ControlFailure text={FAILURE_TEXT} failure={failure} onDismiss={() => setFailure(null)} />
    </div>
  );
}

/**
 * The Live toggle as the static shell draws it, until its per-request part
 * streams in: off, and inert for that moment.
 *
 * @example <Suspense fallback={<InertLiveToggle />}><CurrentLiveToggle /></Suspense>
 */
export function InertLiveToggle() {
  return (
    <div className="relative flex shrink-0">
      <LiveToggleFace isLiveOn={false} isPending={false} />
    </div>
  );
}

/** The toggle itself: a dot, pulsing while Live is on, and the label, which collapses below 1280px. */
function LiveToggleFace({
  isLiveOn,
  isPending,
  onClick,
}: {
  isLiveOn: boolean;
  isPending: boolean;
  onClick?: () => void;
}) {
  return (
    <PendingButton
      variant="outline"
      onClick={onClick}
      isPending={isPending}
      aria-pressed={isLiveOn}
      title={isLiveOn ? "Stop following your Claude Code logs" : "Follow your Claude Code logs as they change"}
      className={cn("max-xl:w-8 max-xl:px-0", isLiveOn && "border-cost/60")}
    >
      <span aria-hidden className="relative flex size-2">
        {isLiveOn && <span className="absolute inline-flex size-full animate-ping rounded-full bg-cost opacity-75" />}
        <span
          className={cn("relative inline-flex size-2 rounded-full", isLiveOn ? "bg-cost" : "bg-muted-foreground/40")}
        />
      </span>
      <span className="max-xl:sr-only">Live</span>
    </PendingButton>
  );
}
