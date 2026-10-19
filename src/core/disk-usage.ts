// How much disk a path takes: what the Recorder popover shows for the
// Recordings, the database and the logs. The walk is async `fs` only, so the
// stats run on libuv's threadpool and a multi-GB logs root never holds the
// event loop. Symlinks inside the walk are skipped, not followed; a file or
// folder deleted between its listing and its stat counts as absent.

import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

/** A size on disk, in bytes. */
export type SizeInBytes = number;

/**
 * The total size of `targetPath`: every file under it when it is a folder, its
 * own size when it is a file, and 0 when it does not exist.
 *
 * @example const recordingsBytes = await diskUsageInBytes(defaultRecordingsRoot());
 */
export async function diskUsageInBytes(targetPath: string): Promise<SizeInBytes> {
  const stats = await unlessVanished(() => stat(targetPath));
  if (stats === null) return 0;
  return stats.isDirectory() ? folderSizeInBytes(targetPath) : stats.size;
}

/** The summed size of the regular files under `folderPath`, its sub-folders walked in parallel. */
async function folderSizeInBytes(folderPath: string): Promise<SizeInBytes> {
  const entries = await unlessVanished(() => readdir(folderPath, { withFileTypes: true }));
  if (entries === null) return 0;
  const entrySizes = await Promise.all(entries.map((entry) => entrySizeInBytes(folderPath, entry)));
  return entrySizes.reduce((total, size) => total + size, 0);
}

/** The size of one listed entry: a folder walked, a file stat'ed, anything else (a symlink) 0. */
async function entrySizeInBytes(folderPath: string, entry: Dirent): Promise<SizeInBytes> {
  const entryPath = path.join(folderPath, entry.name);
  if (entry.isDirectory()) return folderSizeInBytes(entryPath);
  if (!entry.isFile()) return 0;
  return (await unlessVanished(() => stat(entryPath)))?.size ?? 0;
}

/** `read()`'s result, or null when its path is gone (ENOENT) or no longer a folder (ENOTDIR). */
async function unlessVanished<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}
