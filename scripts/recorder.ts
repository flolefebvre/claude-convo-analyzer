// `pnpm recorder` — run the Recorder (ADR-0006) in its own process, until
// SIGINT/SIGTERM or a POST to its stop endpoint (the app's Stop): the first
// signal or stop request stops it cleanly (in-flight API requests finish, up to
// 10 s, then the Recordings are flushed) and exits 0; a signal a second or more
// after the first exits 1 at once. `--detach` leaves it running in the
// background instead; that is how the app's Start runs it.

import { defaultRecorderPort, defaultRecorderUpstream, startRecorder } from "@/core/recorder";
import { launchDetachedRecorder } from "@/core/recorder-control";
import { defaultRecordingsRoot } from "@/core/recording";

const USAGE = `Usage: pnpm recorder [--detach]

Run the Recorder on 127.0.0.1, forwarding to the Anthropic API and recording
every API request. Point Claude Code at it with the ANTHROPIC_BASE_URL line it
prints. Stop it with Ctrl-C (twice to force), or with Stop in the app bar.

  CCA_RECORDER_PORT      Port to listen on (default 4242; 0 picks a free one).
  CCA_RECORDER_UPSTREAM  API to forward to (default https://api.anthropic.com).
  CCA_RECORDINGS_ROOT    Where Recordings go (default ~/.claude-convo-analyzer/recordings).

  --detach  Start the Recorder in the background and return once it answers
            (or fail, with why); its output goes to recorder.log beside the
            Recordings root. Needs a fixed port. Stop it with Stop in the app bar.
  --help    Show this message.`;

/** How long after the first signal a repeat counts as the same Ctrl-C, not a second one forcing the exit. */
const REPEATED_SIGNAL_WINDOW_MS = 1000;

async function runRecorderUntilSignal(): Promise<void> {
  const upstreamUrl = defaultRecorderUpstream();
  const recordingsRoot = defaultRecordingsRoot();
  const recorder = await startRecorder({ port: defaultRecorderPort(), upstreamUrl, recordingsRoot });
  console.log(`Recorder on 127.0.0.1:${recorder.port}, forwarding to ${upstreamUrl}, recording to ${recordingsRoot}`);
  console.log(`ANTHROPIC_BASE_URL=http://127.0.0.1:${recorder.port}`);

  let firstSignalAt: number | null = null;
  const stopOnSignal = (signal: NodeJS.Signals) => {
    if (firstSignalAt !== null) {
      // One Ctrl-C reaches this process several times — from the terminal's
      // process group, then relayed by pnpm and by tsx — within milliseconds.
      if (Date.now() - firstSignalAt < REPEATED_SIGNAL_WINDOW_MS) return;
      console.error(`Recorder: ${signal} again, exiting without waiting.`);
      process.exit(1);
    }
    firstSignalAt = Date.now();
    console.log(`Recorder: ${signal}, letting in-flight API requests finish…`);
    void recorder.stop().catch(() => {}); // its outcome is `stopped`'s
  };
  process.on("SIGINT", stopOnSignal);
  process.on("SIGTERM", stopOnSignal);

  // Whichever asked for it — a signal or the stop endpoint — the process exits once the stop completes.
  recorder.stopped.then(
    () => process.exit(0),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
}

/**
 * Re-run this script without `--detach`, in its own session with its output
 * appended to the log, wait until it answers its health endpoint, then print
 * its pid and the base URL and exit 0: the Recorder is then an orphan, outside
 * the process tree of whatever launched it, so stopping that tree (an IDE's
 * stop button, a process manager) leaves it running. When it does not come up,
 * print why on stderr and exit 1.
 */
async function runDetachLauncher(): Promise<void> {
  const port = defaultRecorderPort();
  if (port === 0) {
    throw new Error(
      "--detach needs a fixed port: with CCA_RECORDER_PORT=0 only the Recorder would know the port it picked.",
    );
  }
  const outcome = await launchDetachedRecorder({
    port,
    recordingsRoot: defaultRecordingsRoot(),
    scriptPath: process.argv[1],
  });
  if (outcome.outcome === "failed") {
    console.error(outcome.message);
    process.exit(1);
  }
  console.log(
    outcome.outcome === "started"
      ? `Recorder detached as pid ${outcome.pid}, logging to ${outcome.logPath}`
      : `A Recorder already answers on 127.0.0.1:${port}; leaving it running.`,
  );
  console.log(`ANTHROPIC_BASE_URL=http://127.0.0.1:${port}`);
  process.exit(0);
}

if (process.argv.includes("--help")) {
  console.log(USAGE);
} else {
  (process.argv.includes("--detach") ? runDetachLauncher() : runRecorderUntilSignal()).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
