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
// The peak is one Conversation's parsed form, held until its write: it is
// bounded by the largest Conversation, mostly its sent messages, which are
// stored whole — its tool results are already cut to their storage cap.
//
// `--live-update-of-largest-main-thread` then times what Live costs on the
// largest active Conversation: a second Refresh after its Main thread changed.
// The change is simulated in the scratch database, never on disk, so the bench
// stays read-only on the logs, the real ones included.
//
// Not part of `check`, `gate` or CI: it reads the real logs and takes minutes.

import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import Database from "better-sqlite3";

import { defaultLogsRoot } from "@/core/discovery";
import { refresh, type RefreshPhase, type RefreshProgress, type RefreshSummary } from "@/core/refresh";

const USAGE = `Usage: pnpm bench:refresh [--live-update-of-largest-main-thread]

Run a cold Refresh of CCA_LOGS_ROOT (default ~/.claude/projects) into a scratch
database under the OS temp directory, then print the phase split, the peak live
heap (each sample taken after a forced GC) with where it was taken, and the
longest main-thread stall. The scratch database is deleted afterwards.

  --live-update-of-largest-main-thread
          After the cold Refresh, Refresh once more as Live does when the Main
          thread of the Conversation with the largest one grows, and print that
          run's phase split. The change is simulated by making the stored change
          key of that Main thread stale in the scratch database: no log file is
          written or touched.
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

/** Print each phase of `summary`: its duration, in milliseconds, and its share of the run. */
function printPhases(summary: RefreshSummary): void {
  console.log("Phases:");
  for (const [phase, durationMs] of Object.entries(summary.durationMsByPhase) as [RefreshPhase, number][]) {
    const share = summary.durationMs === 0 ? 0 : (100 * durationMs) / summary.durationMs;
    console.log(
      `  ${phase.padEnd(10)} ${`${durationMs.toFixed(0)} ms`.padStart(11)}  ${share.toFixed(1).padStart(5)} %`,
    );
  }
}

/**
 * In the database at `dbPath`, make the stored change key of the largest Main
 * thread stale — the Main thread file of a stored Conversation with the most
 * bytes — so the next Refresh finds it changed, as after Live saw it grow.
 * Returns that file, or null when no Conversation is stored. Reads the log
 * files' sizes only: nothing on disk is written.
 */
function markLargestMainThreadChanged(dbPath: string): { sourcePath: string; sizeInBytes: number } | null {
  const db = new Database(dbPath);
  try {
    const conversations = db.prepare(`SELECT "id", "source_path" AS "sourcePath" FROM "conversation"`).all() as {
      id: number;
      sourcePath: string;
    }[];
    let largest: { id: number; sourcePath: string; sizeInBytes: number } | null = null;
    for (const { id, sourcePath } of conversations) {
      const sizeInBytes = statSync(sourcePath, { throwIfNoEntry: false })?.size ?? 0;
      if (largest === null || sizeInBytes > largest.sizeInBytes) largest = { id, sourcePath, sizeInBytes };
    }
    if (largest === null) return null;
    db.prepare(`UPDATE "conversation" SET "source_mtime" = -1 WHERE "id" = ?`).run(largest.id);
    return { sourcePath: largest.sourcePath, sizeInBytes: largest.sizeInBytes };
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { help: { type: "boolean" }, "live-update-of-largest-main-thread": { type: "boolean" } },
  });
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
    printPhases(summary);
    console.log(
      `Peak heap:     ${(sampling.heapUsedBytes / BYTES_PER_MIB).toFixed(0)} MiB heapUsed ` +
        `at ${formatSamplePosition(sampling.heapUsedPeakAt)}, ` +
        `${(sampling.rssBytes / BYTES_PER_MIB).toFixed(0)} MiB rss ` +
        `(live after a forced GC; ${sampling.sampleCount} samples; ` +
        `forced GC ${formatSeconds(sampling.forcedGcMs)}, in Total, not in the phases)`,
    );
    console.log(`Longest stall: ${formatSeconds(longestStallMs)} (main thread, setImmediate gap)`);

    if (values["live-update-of-largest-main-thread"]) {
      const largestMainThread = markLargestMainThreadChanged(dbPath);
      if (largestMainThread === null) {
        console.log("\nLive update: no Conversation stored, nothing to change.");
        return;
      }
      const liveUpdateSummary = await refresh({ logsRoot, dbPath });
      console.log("");
      console.log(
        `Live update of the largest Main thread: ${largestMainThread.sourcePath} ` +
          `(${(largestMainThread.sizeInBytes / BYTES_PER_MIB).toFixed(1)} MiB)`,
      );
      console.log(
        `Conversations: ${liveUpdateSummary.conversationsParsed} parsed, ` +
          `${liveUpdateSummary.conversationsSkipped} skipped`,
      );
      console.log(`Total:         ${liveUpdateSummary.durationMs} ms`);
      printPhases(liveUpdateSummary);
    }
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
