// A log file listed by a directory read can be deleted before it is touched
// (a scratch session cleaned up, a worktree removed, Claude Code rotating a
// file). These helpers turn that one case into a null, so discovery and the
// Refresh can skip the file instead of failing the run.
//
// What the null means depends on WHEN the file vanished. Before the compare
// (a `stat` during discovery) the file is simply absent at discovery: skipped,
// not counted, its stored row removed by the Refresh's delete pass. At READ time,
// after the compare put it in the re-parse set, it is counted in
// `RefreshSummary.vanishedLogFilesSkipped`. A Sub-agent link whose target is gone
// is the exception: discovery skips it, and it is counted when its Conversation
// is re-parsed (see `discoverSubAgents`).

import { readFileSync, realpathSync, type Stats, statSync } from "node:fs";

/**
 * Whether `error` says the file is no longer there (ENOENT). Every other error —
 * a permission error, a directory in the file's place — is a real problem the
 * run must report, so it is rethrown.
 */
function isFileVanishedError(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** `fn()`'s result, or null when it failed because its file vanished. */
function nullIfVanished<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch (error) {
    if (isFileVanishedError(error)) return null;
    throw error;
  }
}

/**
 * The UTF-8 text of `filePath`, or null when the file vanished.
 *
 * @example
 * const text = readFileUnlessVanished(session.sourcePath);
 */
export function readFileUnlessVanished(filePath: string): string | null {
  return nullIfVanished(() => readFileSync(filePath, "utf8"));
}

/**
 * The stats of `filePath`, or null when the file vanished.
 *
 * @example
 * const stat = statUnlessVanished(sub.sourcePath);
 */
export function statUnlessVanished(filePath: string): Stats | null {
  return nullIfVanished(() => statSync(filePath));
}

/**
 * The canonical path of `filePath`, every link resolved, or null when it or a
 * link on its way is gone.
 *
 * @example
 * const target = realpathUnlessVanished(linkPath);
 */
export function realpathUnlessVanished(filePath: string): string | null {
  return nullIfVanished(() => realpathSync(filePath));
}
