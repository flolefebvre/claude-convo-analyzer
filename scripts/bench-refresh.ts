// `pnpm bench:refresh` — time a COLD Refresh of the logs root (`CCA_LOGS_ROOT`,
// else `~/.claude/projects`) into a scratch database created under the OS temp
// directory and removed afterwards; the app's databases are never touched.
//
// It calls `refresh()` in-process, on this thread, so the longest stall it
// reports is the parse/write pipeline's own: the run is one synchronous task,
// and that number lands close to the whole run. In the app a worker thread
// runs the Refresh and the server stays responsive regardless (ADR-0004).
//
// Each heap sample follows a forced full GC (`--expose-gc`, passed by the
// package.json script), so it measures live objects, not uncollected garbage.
// Samples are the live heap at batch boundaries (<= 50 Conversations or <= 1 s),
// the only hook a synchronous `refresh()` gives: a transient peak inside one
// Conversation's parse is not seen.
//
// Not part of `check`, `gate` or CI: it reads the real logs and takes minutes.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

import { defaultLogsRoot } from "@/core/discovery";
import { refresh, type RefreshPhase, type RefreshProgress } from "@/core/refresh";

const USAGE = `Usage: pnpm bench:refresh

Run a cold Refresh of CCA_LOGS_ROOT (default ~/.claude/projects) into a scratch
database under the OS temp directory, then print the phase split, the peak live
heap (each sample taken after a forced GC) with where it was taken, and the
longest main-thread stall. The scratch database is deleted afterwards.

  --help  Show this message.`;

const BYTES_PER_MIB = 1024 * 1024;

/** Where a heap sample was taken: before the Refresh, at a progress report, or after it. */
type SamplePosition = "start" | RefreshProgress | "end";

/** Peak memory over the samples taken so far, and what taking them cost. */
type HeapSampling = {
  heapUsedBytes: number;
  /** The sample that set `heapUsedBytes`. */
  heapUsedPeakAt: SamplePosition;
  rssBytes: number;
  sampleCount: number;
  forcedGcMs: number;
};

/** The `gc` that `--expose-gc` installs; exits with a one-line message when it is missing. */
function requireExposedGc(): () => void {
  const { gc } = globalThis as { gc?: () => void };
  if (gc !== undefined) return gc;
  console.error("bench:refresh needs node's --expose-gc flag: run it with `pnpm bench:refresh`.");
  process.exit(1);
}

/** Force a full GC, then fold the current `process.memoryUsage()` into `sampling`. */
function sampleMemory(sampling: HeapSampling, gc: () => void, position: SamplePosition): void {
  const gcStartedAt = performance.now();
  gc();
  sampling.forcedGcMs += performance.now() - gcStartedAt;
  sampling.sampleCount += 1;
  const { heapUsed, rss } = process.memoryUsage();
  if (heapUsed > sampling.heapUsedBytes) {
    sampling.heapUsedBytes = heapUsed;
    sampling.heapUsedPeakAt = position;
  }
  sampling.rssBytes = Math.max(sampling.rssBytes, rss);
}

/** `position` as `start`, `end`, or `done/total`, e.g. `2600/2647`. */
function formatSamplePosition(position: SamplePosition): string {
  return typeof position === "string" ? position : `${position.done}/${position.total}`;
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

  const gc = requireExposedGc();
  const logsRoot = defaultLogsRoot();
  const scratchDir = mkdtempSync(path.join(tmpdir(), "cca-bench-refresh-"));
  const dbPath = path.join(scratchDir, "bench.db");
  console.log(`Logs root:  ${logsRoot}`);
  console.log(`Scratch DB: ${dbPath}`);

  const sampling: HeapSampling = {
    heapUsedBytes: 0,
    heapUsedPeakAt: "start",
    rssBytes: 0,
    sampleCount: 0,
    forcedGcMs: 0,
  };
  try {
    sampleMemory(sampling, gc, "start");
    const stopWatchingStalls = watchLongestStall();
    const summary = await refresh({
      logsRoot,
      dbPath,
      // At every report — each write batch, plus the end of discovery. On ~2,650
      // Conversations, 83 forced GCs cost 1.0 s in all (median 11 ms), about 1 %
      // of the run: a coarser cadence would only make the samples sparser.
      onProgress: (progress) => sampleMemory(sampling, gc, progress),
    });
    const longestStallMs = stopWatchingStalls();
    sampleMemory(sampling, gc, "end");

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
      `Peak heap:     ${(sampling.heapUsedBytes / BYTES_PER_MIB).toFixed(0)} MiB heapUsed ` +
        `at ${formatSamplePosition(sampling.heapUsedPeakAt)}, ` +
        `${(sampling.rssBytes / BYTES_PER_MIB).toFixed(0)} MiB rss ` +
        `(live after a forced GC; ${sampling.sampleCount} samples; ` +
        `forced GC ${formatSeconds(sampling.forcedGcMs)}, in Total, not in the phases)`,
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
