// The app's disk usage: core's measuring (framework-free, ADR-0002) applied to
// the app's two default paths — the database and the logs root — for the app
// bar's Disk usage item.

import { defaultDbPath } from "@/core/db";
import { defaultLogsRoot } from "@/core/discovery";
import { diskUsageInBytes, type SizeInBytes } from "@/core/disk-usage";

/** A path the app keeps data in, and its size on disk. */
export type PathUsage = { path: string; bytes: SizeInBytes };

/** The size on disk of what the app reads and writes, each under its path. */
export type DiskUsage = { database: PathUsage; logs: PathUsage };

/** The measurement running now, which every caller until it settles shares. */
let measurementInFlight: Promise<DiskUsage> | null = null;

/**
 * The size on disk of the database (with its WAL sidecars) and the Claude Code
 * logs. A call while a measurement runs gets that one.
 *
 * @example const { database, logs } = await measureDiskUsage();
 */
export function measureDiskUsage(): Promise<DiskUsage> {
  measurementInFlight ??= measureDefaultPaths().finally(() => {
    measurementInFlight = null;
  });
  return measurementInFlight;
}

/** The two default paths, each measured now. */
async function measureDefaultPaths(): Promise<DiskUsage> {
  const dbPath = defaultDbPath();
  const logsRoot = defaultLogsRoot();
  const [dbFileSizes, logsBytes] = await Promise.all([
    // The database runs in WAL mode: its -wal and -shm files are part of it.
    Promise.all([dbPath, `${dbPath}-wal`, `${dbPath}-shm`].map((filePath) => diskUsageInBytes(filePath))),
    diskUsageInBytes(logsRoot),
  ]);
  return {
    database: { path: dbPath, bytes: dbFileSizes.reduce((sum, size) => sum + size, 0) },
    logs: { path: logsRoot, bytes: logsBytes },
  };
}
