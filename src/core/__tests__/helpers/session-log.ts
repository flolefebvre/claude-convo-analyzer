// A minimal Main-thread log file written from a list of Message uuids, for the
// continuation tests: a resumed or forked session's file copies its parent's
// records — same uuids — before its own (log-format §10), so a test spells a
// family as the uuid lists of its files.
//
// Not a test file: it is excluded from vitest's `include` (see
// `vitest.config.ts`) because it declares no tests of its own.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** One session's log file, as {@link writeSessionLog} writes it. */
export type SessionLog = {
  sessionId: string;
  /** Log folder under the logs root; `-Users-me-dev-copies` when absent. */
  logFolderName?: string;
  /** One user Message per uuid, in file order. */
  messageUuids: string[];
  /** A `continued-in` record naming each of these sessions, after the Messages. */
  continuedInSessionIds?: string[];
};

/**
 * Write `log` under `logsRoot` and return its path; an existing file is replaced.
 *
 * @example
 * writeSessionLog(logsRoot, { sessionId: "sess-child", messageUuids: ["u1", "child-u2"] });
 */
export function writeSessionLog(logsRoot: string, log: SessionLog): string {
  const folder = path.join(logsRoot, log.logFolderName ?? "-Users-me-dev-copies");
  mkdirSync(folder, { recursive: true });
  const messageRecords = log.messageUuids.map((uuid, index) => ({
    type: "user",
    uuid,
    parentUuid: index === 0 ? null : log.messageUuids[index - 1],
    timestamp: new Date(Date.UTC(2026, 5, 21, 10, index)).toISOString(),
    cwd: "/Users/me/dev/copies",
    version: "2.1.300",
    sessionId: log.sessionId,
    message: { role: "user", content: `message ${uuid}` },
  }));
  const continuedInRecords = (log.continuedInSessionIds ?? []).map((continuedInSessionId) => ({
    type: "continued-in",
    sessionId: log.sessionId,
    continuedInSessionId,
  }));
  const filePath = path.join(folder, `${log.sessionId}.jsonl`);
  writeFileSync(filePath, [...messageRecords, ...continuedInRecords].map((r) => `${JSON.stringify(r)}\n`).join(""));
  return filePath;
}
