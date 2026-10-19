"use client";

// The Recorder item in the app bar, beside Live and Refresh: whether the
// Recorder runs, and a popover to start or stop it and to point Claude Code at
// it. It starts from the status its server part (`current-recorder-control.tsx`)
// read, then re-reads `GET /api/recorder` every 10 s while the page is visible,
// and at once after a Start or a Stop. Start and Stop go through the
// `startRecorder` / `stopRecorder` server actions (ADR-0002: no core import from
// a client file); a Stop that the server refuses because sessions sent requests
// recently turns into an inline confirmation naming how many.

import { callRoute } from "@flefebvre/next-pipe/client";
import { Check, Copy, Radio } from "lucide-react";
import { useEffect, useState } from "react";

import { startRecorder, stopRecorder } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { routes } from "@/generated/routes";
import { cn } from "@/lib/utils-cn";

/** How often the item re-reads the Recorder's status while the page is visible. */
const STATUS_POLL_INTERVAL_MS = 10_000;
/** How long a copy button shows "Copied". */
const COPIED_MS = 1500;

/** The Recorder's status as the item needs it: what answers on the port, and the port. */
export type RecorderStatusAsRead = { status: "running" | "off" | "portTaken"; port: number };

/** What the last Start or Stop click left to say, under its button. */
type ActionReport = { text: string; tone: "status" | "error" };

/**
 * The Recorder item: shows whether the Recorder runs, and opens its controls.
 *
 * @example <RecorderControl recorderStatus={await readConfiguredRecorderStatus()} />
 */
export function RecorderControl({ recorderStatus: statusAsRendered }: { recorderStatus: RecorderStatusAsRead }) {
  const [recorderStatus, setRecorderStatus] = useState(statusAsRendered);
  // A new render of the server part is the status as it stands now.
  const [seenStatus, setSeenStatus] = useState(statusAsRendered);
  if (seenStatus !== statusAsRendered) {
    setSeenStatus(statusAsRendered);
    setRecorderStatus(statusAsRendered);
  }
  const [isActionPending, setIsActionPending] = useState(false);
  const [actionReport, setActionReport] = useState<ActionReport | null>(null);
  /** The number of recent sessions a refused Stop reported, while its confirmation shows. */
  const [unconfirmedSessionCount, setUnconfirmedSessionCount] = useState<number | null>(null);

  async function rereadStatus() {
    try {
      const response = await callRoute(routes.api.recorder.GET());
      if (response.status === 200) setRecorderStatus({ status: response.json.status, port: response.json.port });
    } catch {
      // The app server is unreachable for now; the next poll tries again.
    }
  }

  useEffect(() => {
    const rereadIfVisible = () => {
      if (document.visibilityState === "visible") void rereadStatus();
    };
    const poll = setInterval(rereadIfVisible, STATUS_POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", rereadIfVisible);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", rereadIfVisible);
    };
  }, []);

  async function runAction(action: () => Promise<ActionReport | null>) {
    setActionReport(null);
    setIsActionPending(true);
    try {
      setActionReport(await action());
    } catch (cause) {
      setActionReport({ text: cause instanceof Error ? cause.message : String(cause), tone: "error" });
    } finally {
      setIsActionPending(false);
      await rereadStatus();
    }
  }

  const handleStart = () =>
    runAction(async () => {
      const result = await startRecorder();
      if (result.status === "error") {
        return {
          text: result.error.type === "recorderNotStarted" ? result.error.data.message : "The start was refused.",
          tone: "error",
        };
      }
      return {
        text:
          result.data.outcome === "started"
            ? `Started on :${result.data.port}.`
            : `Already running on :${result.data.port}.`,
        tone: "status",
      };
    });

  const handleStop = (force: boolean) =>
    runAction(async () => {
      setUnconfirmedSessionCount(null);
      const result = await stopRecorder({ force });
      if (result.status === "success") {
        return { text: result.data === "stopping" ? "Stopped." : "It was not running.", tone: "status" };
      }
      if (result.error.type === "sessionsActive") {
        setUnconfirmedSessionCount(result.error.data.count);
        return null;
      }
      return {
        text: result.error.type === "recorderNotStopped" ? result.error.data.message : "The stop was refused.",
        tone: "error",
      };
    });

  const isRunning = recorderStatus.status === "running";
  return (
    <Popover
      onOpenChange={(isOpen) => {
        if (!isOpen) return;
        setActionReport(null);
        setUnconfirmedSessionCount(null);
        void rereadStatus();
      }}
    >
      <PopoverTrigger asChild>
        <RecorderFace
          isRunning={isRunning}
          label={isRunning ? `Recorder: on :${recorderStatus.port}` : "Recorder: off · how to enable"}
        />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] gap-3 p-3 text-xs">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium">
            {isRunning ? `The Recorder is on, at 127.0.0.1:${recorderStatus.port}` : "The Recorder is off"}
          </p>
          {unconfirmedSessionCount === null &&
            (isRunning ? (
              <Button size="sm" variant="outline" disabled={isActionPending} onClick={() => handleStop(false)}>
                Stop
              </Button>
            ) : (
              <Button size="sm" disabled={isActionPending} onClick={handleStart}>
                Start
              </Button>
            ))}
        </div>
        {recorderStatus.status === "portTaken" && (
          <p className="text-destructive-foreground">Port {recorderStatus.port} is taken by another program.</p>
        )}
        {unconfirmedSessionCount !== null && (
          <div role="alert" className="flex flex-col gap-2 rounded-md border border-destructive/40 p-2">
            <p>
              {unconfirmedSessionCount === 1
                ? "1 session sent requests in the last 15 minutes; it will lose the API."
                : `${unconfirmedSessionCount} sessions sent requests in the last 15 minutes; they will lose the API.`}
            </p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setUnconfirmedSessionCount(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="destructive" disabled={isActionPending} onClick={() => handleStop(true)}>
                Stop anyway
              </Button>
            </div>
          </div>
        )}
        <p
          role="status"
          className={cn("whitespace-pre-wrap empty:sr-only", actionReport?.tone === "error" && "text-destructive")}
        >
          {actionReport?.text ?? ""}
        </p>
        <HowToEnable port={recorderStatus.port} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The Recorder item as the static shell draws it, until its per-request part
 * streams in: no claim on whether it runs, and inert for that moment.
 *
 * @example <Suspense fallback={<InertRecorderControl />}><CurrentRecorderControl /></Suspense>
 */
export function InertRecorderControl() {
  return <RecorderFace isRunning={false} label="Recorder" />;
}

/** How to point Claude Code at the Recorder on `port`, with the lines to copy. */
function HowToEnable({ port }: { port: number }) {
  const baseUrlLine = `ANTHROPIC_BASE_URL=http://127.0.0.1:${port} claude`;
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <p className="font-medium">How to enable</p>
      <p className="text-muted-foreground">Start Claude Code through the Recorder; only those sessions are recorded:</p>
      <CopyableLine text={baseUrlLine} />
      <p className="text-muted-foreground">Or add an alias to your shell profile:</p>
      <CopyableLine text={`alias claude-rec='${baseUrlLine}'`} />
      <p className="text-muted-foreground">
        A session started this way cannot reach the API while the Recorder is stopped.
      </p>
    </div>
  );
}

/** A line of shell, with a button putting it on the clipboard. */
function CopyableLine({ text }: { text: string }) {
  const [isCopied, setIsCopied] = useState(false);
  useEffect(() => {
    if (!isCopied) return;
    const timer = setTimeout(() => setIsCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [isCopied]);

  return (
    <div className="flex items-center gap-1 rounded-md bg-muted py-1 pr-1 pl-2">
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[11px] whitespace-nowrap">{text}</code>
      <Button
        size="sm"
        variant="ghost"
        className="shrink-0"
        onClick={() => void navigator.clipboard.writeText(text).then(() => setIsCopied(true))}
      >
        {isCopied ? <Check aria-hidden /> : <Copy aria-hidden />}
        {isCopied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** The item's button: the Recorder's icon, lit while it runs, and the label, which collapses on phones. */
function RecorderFace({
  isRunning,
  label,
  ...triggerProps
}: { isRunning: boolean; label: string } & React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="outline"
      title={label}
      className={cn("max-sm:w-8 max-sm:px-0", isRunning && "border-cost/60")}
      {...triggerProps}
    >
      <Radio aria-hidden className={cn(isRunning ? "text-cost" : "text-muted-foreground")} />
      <span className="max-sm:sr-only">{label}</span>
    </Button>
  );
}
