// How much disk a path takes: what the Recorder popover shows for the
// Recordings, the database and the logs. The walk is async `fs` only, so the
// stats run on libuv's threadpool and a multi-GB logs root never holds the
// event loop. Symlinks inside the walk are skipped, not followed (a Dirent of a
// symlink is neither a file nor a folder); a file or
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

/**
 * The summed size of the regular files under `folderPath`. One folder at a
 * time: its files are stat'ed in parallel, then its sub-folders are walked in
 * turn. Fanning out across the whole tree at once lands thousands of stat
 * results in one burst, and a 6 GB logs root held the event loop for 200+ ms.
 */
async function folderSizeInBytes(folderPath: string): Promise<SizeInBytes> {
  const entries = await unlessVanished(() => readdir(folderPath, { withFileTypes: true }));
  if (entries === null) return 0;
  const fileSizes = await Promise.all(
    entries.filter((entry) => entry.isFile()).map((entry) => fileSizeInBytes(folderPath, entry)),
  );
  let total = fileSizes.reduce((sum, size) => sum + size, 0);
  for (const entry of entries) {
    if (entry.isDirectory()) total += await folderSizeInBytes(path.join(folderPath, entry.name));
  }
  return total;
}

/** The size of the file `entry` listed in `folderPath`, or 0 when it vanished since. */
async function fileSizeInBytes(folderPath: string, entry: Dirent): Promise<SizeInBytes> {
  return (await unlessVanished(() => stat(path.join(folderPath, entry.name))))?.size ?? 0;
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
