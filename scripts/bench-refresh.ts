// `pnpm bench:refresh` — time a COLD Refresh of the logs root (`CCA_LOGS_ROOT`,
// else `~/.claude/projects`) and the Recordings root (`CCA_RECORDINGS_ROOT`,
// else `~/.claude-convo-analyzer/recordings`) into a scratch database created
// under the OS temp directory and removed afterwards; the app's databases are
// never touched.
//
// It calls `refresh()` in-process, on this thread, so the longest stall it
// reports is the parse/write pipeline's own: the run is one synchronous task,
// and that number lands close to the whole run. In the app a worker thread
// runs the Refresh and the server stays responsive regardless (ADR-0004).
// Not part of `check`, `gate` or CI: it reads the real logs and takes minutes.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

import { defaultLogsRoot } from "@/core/discovery";
import { defaultRecordingsRoot } from "@/core/recording";
import { refresh, type RefreshPhase } from "@/core/refresh";

const USAGE = `Usage: pnpm bench:refresh

Run a cold Refresh of CCA_LOGS_ROOT (default ~/.claude/projects) and
CCA_RECORDINGS_ROOT (default ~/.claude-convo-analyzer/recordings) into a scratch
database under the OS temp directory, then print the phase split, the peak heap
and the longest main-thread stall. The scratch database is deleted afterwards.

  --help  Show this message.`;

const BYTES_PER_MIB = 1024 * 1024;

/** Peak memory over the samples taken so far, in bytes. */
type PeakMemory = { heapUsedBytes: number; rssBytes: number };

/** Fold the current `process.memoryUsage()` into `peak`. */
function sampleMemory(peak: PeakMemory): void {
  const { heapUsed, rss } = process.memoryUsage();
  peak.heapUsedBytes = Math.max(peak.heapUsedBytes, heapUsed);
  peak.rssBytes = Math.max(peak.rssBytes, rss);
}

/**
 * Track the longest gap between two turns of the event loop, with a
 * `setImmediate` chain running beside the measured work. Call the returned
 * function to stop it and read the longest gap, in milliseconds.
 */
function watchLongestStall(): () => number {
  let longestStallMs = 0;
  let lastTickAt = performance.now();
  let isWatching = true;
  const tick = () => {
    const now = performance.now();
    longestStallMs = Math.max(longestStallMs, now - lastTickAt);
    lastTickAt = now;
    if (isWatching) setImmediate(tick);
  };
  setImmediate(tick);
  return () => {
    isWatching = false;
    return Math.max(longestStallMs, performance.now() - lastTickAt);
  };
}

/** `ms` as seconds with one decimal, e.g. `12.3 s`. */
function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { help: { type: "boolean" } } });
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const logsRoot = defaultLogsRoot();
  const recordingsRoot = defaultRecordingsRoot();
  const scratchDir = mkdtempSync(path.join(tmpdir(), "cca-bench-refresh-"));
  const dbPath = path.join(scratchDir, "bench.db");
  console.log(`Logs root:       ${logsRoot}`);
  console.log(`Recordings root: ${recordingsRoot}`);
  console.log(`Scratch DB:      ${dbPath}`);

  const peakMemory: PeakMemory = { heapUsedBytes: 0, rssBytes: 0 };
  let progressReportCount = 0;
  try {
    sampleMemory(peakMemory);
    const stopWatchingStalls = watchLongestStall();
    const summary = await refresh({
      logsRoot,
      recordingsRoot,
      dbPath,
      onProgress: () => {
        progressReportCount += 1;
        sampleMemory(peakMemory);
      },
    });
    const longestStallMs = stopWatchingStalls();
    sampleMemory(peakMemory);

    console.log("");
    console.log(
      `Conversations: ${summary.conversationsParsed} parsed, ${summary.conversationsSkipped} skipped, ` +
        `${summary.malformedLinesSkipped} malformed lines skipped, ${summary.duplicateSessionsSkipped.length} duplicates`,
    );
    console.log(`Total:         ${formatSeconds(summary.durationMs)}`);
    console.log("Phases:");
    for (const [phase, durationMs] of Object.entries(summary.durationMsByPhase) as [RefreshPhase, number][]) {
      const share = summary.durationMs === 0 ? 0 : (100 * durationMs) / summary.durationMs;
      console.log(`  ${phase.padEnd(10)} ${formatSeconds(durationMs).padStart(9)}  ${share.toFixed(1).padStart(5)} %`);
    }
    console.log(
      `Peak heap:     ${(peakMemory.heapUsedBytes / BYTES_PER_MIB).toFixed(0)} MiB heapUsed, ` +
        `${(peakMemory.rssBytes / BYTES_PER_MIB).toFixed(0)} MiB rss ` +
        `(sampled at start, at each of ${progressReportCount} progress reports, and at the end)`,
    );
    console.log(`Longest stall: ${formatSeconds(longestStallMs)} (main thread, setImmediate gap)`);
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
