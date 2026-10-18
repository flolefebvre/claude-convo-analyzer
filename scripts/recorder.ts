// `pnpm recorder` — run the Recorder (ADR-0006) in its own process, until
// SIGINT/SIGTERM: the first signal stops it cleanly (in-flight API requests
// finish, up to 10 s, then the Recordings are flushed) and exits 0; a second
// one exits 1 at once.

import { defaultRecorderPort, defaultRecorderUpstream, startRecorder } from "@/core/recorder";
import { defaultRecordingsRoot } from "@/core/recording";

const USAGE = `Usage: pnpm recorder

Run the Recorder on 127.0.0.1, forwarding to the Anthropic API and recording
every API request. Point Claude Code at it with the ANTHROPIC_BASE_URL line it
prints. Stop it with Ctrl-C (twice to force).

  CCA_RECORDER_PORT      Port to listen on (default 4242; 0 picks a free one).
  CCA_RECORDER_UPSTREAM  API to forward to (default https://api.anthropic.com).
  CCA_RECORDINGS_ROOT    Where Recordings go (default ~/.claude-convo-analyzer/recordings).

  --help  Show this message.`;

async function runRecorderUntilSignal(): Promise<void> {
  const upstreamUrl = defaultRecorderUpstream();
  const recordingsRoot = defaultRecordingsRoot();
  const recorder = await startRecorder({ port: defaultRecorderPort(), upstreamUrl, recordingsRoot });
  console.log(`Recorder on 127.0.0.1:${recorder.port}, forwarding to ${upstreamUrl}, recording to ${recordingsRoot}`);
  console.log(`ANTHROPIC_BASE_URL=http://127.0.0.1:${recorder.port}`);

  let isStopping = false;
  const stopOnSignal = (signal: NodeJS.Signals) => {
    if (isStopping) {
      console.error(`Recorder: ${signal} again, exiting without waiting.`);
      process.exit(1);
    }
    isStopping = true;
    console.log(`Recorder: ${signal}, letting in-flight API requests finish…`);
    recorder.stop().then(
      () => process.exit(0),
      (err: unknown) => {
        console.error(err);
        process.exit(1);
      },
    );
  };
  process.on("SIGINT", stopOnSignal);
  process.on("SIGTERM", stopOnSignal);
}

if (process.argv.includes("--help")) {
  console.log(USAGE);
} else {
  runRecorderUntilSignal().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
