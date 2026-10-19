// The app's disk usage: core's measuring (framework-free, ADR-0002) applied to
// the app's three default paths — the Recordings root, the database and the
// logs root — for the Recorder popover.

import { defaultDbPath } from "@/core/db";
import { defaultLogsRoot } from "@/core/discovery";
import { diskUsageInBytes, type SizeInBytes } from "@/core/disk-usage";
import { defaultRecordingsRoot } from "@/core/recording";

/** A path the app keeps data in, and its size on disk. */
export type PathUsage = { path: string; bytes: SizeInBytes };

/** The size on disk of what the app reads and writes, each under its path. */
export type DiskUsage = { recordings: PathUsage; database: PathUsage; logs: PathUsage };

/** The measurement running now, which every caller until it settles shares. */
let measurementInFlight: Promise<DiskUsage> | null = null;

/**
 * The size on disk of the Recordings, the database (with its WAL sidecars) and
 * the Claude Code logs. A call while a measurement runs gets that one.
 *
 * @example const { recordings, database, logs } = await measureDiskUsage();
 */
export function measureDiskUsage(): Promise<DiskUsage> {
  measurementInFlight ??= measureDefaultPaths().finally(() => {
    measurementInFlight = null;
  });
  return measurementInFlight;
}

/** The three default paths, each measured now. */
async function measureDefaultPaths(): Promise<DiskUsage> {
  const recordingsRoot = defaultRecordingsRoot();
  const dbPath = defaultDbPath();
  const logsRoot = defaultLogsRoot();
  const [recordingsBytes, dbFileSizes, logsBytes] = await Promise.all([
    diskUsageInBytes(recordingsRoot),
    // The database runs in WAL mode: its -wal and -shm files are part of it.
    Promise.all([dbPath, `${dbPath}-wal`, `${dbPath}-shm`].map((filePath) => diskUsageInBytes(filePath))),
    diskUsageInBytes(logsRoot),
  ]);
  return {
    recordings: { path: recordingsRoot, bytes: recordingsBytes },
    database: { path: dbPath, bytes: dbFileSizes.reduce((sum, size) => sum + size, 0) },
    logs: { path: logsRoot, bytes: logsBytes },
  };
}
