// Stored data is pinned: a Refresh of each fixture root into a fresh database
// writes exactly these rows — same count, same ids, same column values and
// storage types — in all twelve tables. The write path is free to change; what
// it stores is not.
//
// A MISMATCH means the write path now stores something different: a column
// left out or bound with another type, rows inserted in another order (so other
// autoincrement ids), a schema change the writer did not follow. Fix the
// writer, not the goldens. Regenerate the goldens ONLY alongside a deliberate
// parser change that alters stored content — that is, together with a
// `PARSER_VERSION` bump in refresh.ts: replace each literal below with the
// value the failing assertion reports.

import { createHash } from "node:crypto";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type RecordedAttachment, writeRequestRecordsLog } from "@/core/__tests__/helpers/request-records-log";
import { refresh } from "@/core/refresh";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");

/** The twelve tables of ADR-0001, each pinned by its row count and checksum. */
const STORED_TABLES = [
  "project",
  "conversation",
  "agent",
  "message",
  "tool_call",
  "pr_link",
  "turn_duration",
  "api_request",
  "system_prompt",
  "tool_set",
  "sent_message",
  "continued_in",
] as const;

type StoredTable = (typeof STORED_TABLES)[number];

/** One table's fingerprint: how many rows, and a sha256 over all of them. */
type TableFingerprint = { rowCount: number; sha256: string };

/** Every file under the copied logs root gets this mtime (see `copyWithPinnedMtimes`). */
const PINNED_MTIME = new Date("2026-01-01T00:00:00.000Z");

/** The sha256 of no bytes: the fingerprint of a table with no rows. */
const EMPTY_TABLE_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** The request-record tables of logs written before Claude Code 2.1.300: all empty. */
const NO_LOGGED_API_REQUESTS = {
  api_request: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
  system_prompt: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
  tool_set: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
  sent_message: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
};

/** Stands in for the per-run temp directory inside a stored `source_path`. */
const LOGS_ROOT_PLACEHOLDER = "<logs-root>";

/**
 * Copy a fixture root into `logsRoot` and give every file the same mtime.
 *
 * Two stored columns depend on the machine rather than the logs:
 * `conversation.source_path` is absolute (normalized in `fingerprintTable`),
 * and `conversation.source_mtime` is the files' mtime — a checkout's time, not
 * content. Pinning the mtimes makes the change key reproducible; every other
 * stored value is derived from file content.
 */
function copyWithPinnedMtimes(fixtureRoot: string, logsRoot: string): void {
  cpSync(fixtureRoot, logsRoot, { recursive: true });
  for (const entry of readdirSync(logsRoot, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) utimesSync(path.join(entry.parentPath, entry.name), PINNED_MTIME, PINNED_MTIME);
  }
}

/** A stored path under the temp logs root, once the root is replaced by its placeholder. */
const PATH_UNDER_LOGS_ROOT = new RegExp(`${LOGS_ROOT_PLACEHOLDER}[^'\\t]*`, "g");

/**
 * Fingerprint one table: rows ordered by their primary key (`id`, or a
 * interned row's `hash`), every column through SQLite's `quote()` — which keeps
 * integer, real, text and NULL distinct — one line per row, hashed with
 * sha256. The temp logs root is replaced by a placeholder, and the paths below
 * it are written with `/`, whatever the separator of the OS the suite runs on.
 */
function fingerprintTable(db: Database.Database, table: StoredTable, logsRoot: string): TableFingerprint {
  const columns = (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; pk: number }[]).map((c) => ({
    name: c.name,
    isPrimaryKey: c.pk > 0,
  }));
  const quotedColumns = columns.map((column) => `quote("${column.name}")`).join(", ");
  const primaryKey = columns.find((column) => column.isPrimaryKey)!.name;
  const rows = db.prepare(`SELECT ${quotedColumns} FROM "${table}" ORDER BY "${primaryKey}"`).raw().all() as string[][];
  const hash = createHash("sha256");
  for (const row of rows) {
    const line = row
      .join("\t")
      .replaceAll(logsRoot, LOGS_ROOT_PLACEHOLDER)
      .replace(PATH_UNDER_LOGS_ROOT, (storedPath) => storedPath.replaceAll(path.sep, "/"));
    hash.update(`${line}\n`);
  }
  return { rowCount: rows.length, sha256: hash.digest("hex") };
}

/** Fingerprint all twelve tables of the database at `dbPath`. */
function fingerprintStoredData(dbPath: string, logsRoot: string): Record<StoredTable, TableFingerprint> {
  const db = new Database(dbPath, { readonly: true });
  try {
    return Object.fromEntries(STORED_TABLES.map((table) => [table, fingerprintTable(db, table, logsRoot)])) as Record<
      StoredTable,
      TableFingerprint
    >;
  } finally {
    db.close();
  }
}

describe("stored data equivalence", () => {
  let tmpDir: string;
  let logsRoot: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-equivalence-"));
    logsRoot = path.join(tmpDir, "logs");
    dbPath = path.join(tmpDir, "analyzer.db");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores the pinned rows for the main fixture logs (sub-agents, pr links, turn durations)", async () => {
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "logs"), logsRoot);
    await refresh({ logsRoot, dbPath });

    expect(fingerprintStoredData(dbPath, logsRoot)).toEqual({
      project: { rowCount: 15, sha256: "d79302a905b975c08cfd6c217e6ae3eaa17e44ca45bb318cdfeefa1ae7b0e329" },
      conversation: { rowCount: 21, sha256: "059da97c1f23f7d64d7b06f18712b8d9748390d9bd60b65f5ad7fdea9b82b67c" },
      agent: { rowCount: 35, sha256: "711e9837000a62cb2b2d1958c27c6aaeeeadab1ce7130ef41a5cf54f6ddfda6c" },
      message: { rowCount: 127, sha256: "f062d0ade17ffbd2e026dc923d65bc33e28cc68d1db40ccaa3c03a3f78d03959" },
      tool_call: { rowCount: 34, sha256: "1ebf6ceb68879e5e3dfbb37ddf59dce1699db2145274b17b09453577f97c8512" },
      pr_link: { rowCount: 1, sha256: "efff4b0f419e7b55d6dc8602b3503e06e81829e6fd868d216679845fa0970d16" },
      turn_duration: { rowCount: 1, sha256: "11a23dd83764e1de631b25b7b2fb8a6b5af397fe1503b2086f0404a57cb943c4" },
      ...NO_LOGGED_API_REQUESTS,
      continued_in: { rowCount: 1, sha256: "030772a8c9a88fd3802687086c9d1417d6ad731913d6b53c562bc02e78a1e62f" },
    });
  });

  it("stores the pinned rows for the inter-agent message logs", async () => {
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "agent-message-logs"), logsRoot);
    await refresh({ logsRoot, dbPath });

    expect(fingerprintStoredData(dbPath, logsRoot)).toEqual({
      project: { rowCount: 1, sha256: "5d55ed2d1c37a5a354777b7e27dfce7bb9f299e0e7237d17a32956fee0357675" },
      conversation: { rowCount: 1, sha256: "866cbd8ef4ad20689f49090cfd2bdbbffbfa9afc2181530ac29fe35c30475a2d" },
      agent: { rowCount: 2, sha256: "f5aba5caf67fb377381f3a6615b9a5b84ba42ad02870c04d39ae685c7f265e3e" },
      message: { rowCount: 28, sha256: "c0aa023f7b4bc513a093c1d6c99425c9ecee2e8f3b291ac29f2c99cc94ea9aa4" },
      tool_call: { rowCount: 1, sha256: "a7fdb225fda2bff0ca75f88a22789a86cd79a97f5ea4e2f952e1d4559aa8efd9" },
      pr_link: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      turn_duration: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      ...NO_LOGGED_API_REQUESTS,
      continued_in: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
    });
  });

  it("stores the pinned rows for the Project path logs (worktree switches, cwd-less Conversations)", async () => {
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "project-logs"), logsRoot);
    await refresh({ logsRoot, dbPath });

    expect(fingerprintStoredData(dbPath, logsRoot)).toEqual({
      project: { rowCount: 9, sha256: "e740c951fb2b58e8b13902eea830681396ac5eea03a445a31d6fb998c250a3e1" },
      conversation: { rowCount: 13, sha256: "2464bcc8613ed68c318e06a8010747299fc309adccbb8fa317df55d2e1582ca0" },
      agent: { rowCount: 13, sha256: "05071b138ea90dac2a6f439c5ffdc80cf4ecde23d204d53599a57202eb17a230" },
      message: { rowCount: 22, sha256: "25a07cc59be5e565459a3225cfefcc2184607786a7a14353071035b07a770c3a" },
      tool_call: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      pr_link: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      turn_duration: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      ...NO_LOGGED_API_REQUESTS,
      continued_in: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
    });
  });

  it("stores the pinned rows for the API error logs", async () => {
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "error-logs"), logsRoot);
    await refresh({ logsRoot, dbPath });

    expect(fingerprintStoredData(dbPath, logsRoot)).toEqual({
      project: { rowCount: 1, sha256: "c39a0134a2be51dcdd6348bf0657691be4b1d4092d6e1616117c4d0f4f58a771" },
      conversation: { rowCount: 4, sha256: "bf0b3a757b7f0a867ef11d37ab5d625708c9f4cdd77bda56ddbc8ba6d8b7e860" },
      agent: { rowCount: 5, sha256: "3ad52bfa85815c31aed384550111d7e07207b1d7199175e9df9ca71a8fd41c21" },
      message: { rowCount: 17, sha256: "4a305e6648f6803b653d8c99880557c54a32685c31cb6bb5a73f6351934bbae5" },
      tool_call: { rowCount: 1, sha256: "e331ea30643c19a0602a2759f557187aacaf1729c796a955560799b9c4dbd73f" },
      pr_link: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      turn_duration: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      ...NO_LOGGED_API_REQUESTS,
      continued_in: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
    });
  });

  it("stores the pinned rows for the logged request logs (request records, Main thread and Sub-agent, each system prompt, tool set and sent message once)", async () => {
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "logged-request-logs"), logsRoot);
    await refresh({ logsRoot, dbPath });

    expect(fingerprintStoredData(dbPath, logsRoot)).toEqual({
      project: { rowCount: 1, sha256: "8b9da1ddb86766f02f4a1ac8d582400f0f6c9e5071156b7b726e7b6d9bf11d31" },
      conversation: { rowCount: 3, sha256: "66da8302de3ea8e8afc78fb63ca8461aa7dd26d3515cac39e8496755d36d4ca9" },
      agent: { rowCount: 4, sha256: "236b6560485fe1af22869e5fa6c5ab02686684a00d3e90c411e2246519b775a9" },
      message: { rowCount: 19, sha256: "d3f9836aa555bd8b3e4a58a94f2bd44df57147a61af50e55170caec43e9259ed" },
      tool_call: { rowCount: 3, sha256: "e5f615b5d6290bc0dab75ea171da282d5e176e04be16438fc4d834c227f91b9d" },
      pr_link: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      turn_duration: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      api_request: { rowCount: 8, sha256: "f2b2765cde9997e6021bd73f168b81bb41f9a044b5b187d967506cc37c8c722c" },
      // Four system prompts and three tool sets: the Sub-agent shares the Main thread's first one.
      system_prompt: { rowCount: 4, sha256: "179129a51d494cdd6ea7fb72cf50d62900d9163160ed521f850dc233dae050bf" },
      tool_set: { rowCount: 3, sha256: "6b550b32e7738d046dd3c9f444e69eeba02357a973be985eac064674d0326323" },
      // Fifteen messages: two blobs, the others rebuilt from records; the tail hash no file holds is not stored.
      // The two blobs carry the pieces of Injected context their attachments name: CLAUDE.md, and the date.
      sent_message: { rowCount: 15, sha256: "132ab154cc97d01608e9e5ffd1016826fa8b59178bb9f1b3db2ad7cb04c15f2d" },
      continued_in: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
    });
  });

  it("stores the pinned rows for the resumed request logs (Turns whose API request is in another Conversation's file)", async () => {
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "resumed-request-logs"), logsRoot);
    await refresh({ logsRoot, dbPath });

    expect(fingerprintStoredData(dbPath, logsRoot)).toEqual({
      project: { rowCount: 1, sha256: "39d8e36d20227daa2cab6248635b86861d0a5bd0a9e19a0cf4c98eb4de3f7141" },
      conversation: { rowCount: 4, sha256: "b904c7037c477ca0dcafbf8f81b0dd9283f17d347060f30f9c763f91f8b20672" },
      agent: { rowCount: 4, sha256: "5133ecce6c7b4babfbe5aaa102ae82698624764ec13272567e76b9a44f527e2a" },
      // The child's copied Turns name the requests of the copy's and the parent's files.
      message: { rowCount: 16, sha256: "0e48a1941588ca86d550b22852047a588add5dd14cbe49ee5379b889a9d6c54e" },
      tool_call: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      pr_link: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      turn_duration: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      api_request: { rowCount: 7, sha256: "602aaa25ea9dd2816613a1f081b7df94f30494eedecc1af51b465a62f657cfa1" },
      system_prompt: { rowCount: 1, sha256: "0f7e364790e4ce8c6d0837f9bcc1c05c5b20e0d58615364250247c0885a47532" },
      tool_set: { rowCount: 1, sha256: "bd38eccd26f4c9604aad98fcff1f9643ab0523b07da230a857569e163247ac0e" },
      sent_message: { rowCount: 5, sha256: "e7b8ba8a7395036a9c885011145c435f535f212957dcb9f5b24aa330ebc79025" },
      continued_in: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
    });
  });
});

describe("continuations", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-continuation-equivalence-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const FAMILY_FOLDER = "-Users-me-dev-family";

  /** The path of session `sessionId`'s log file under `logsRoot`, in `logFolderName`. */
  const sessionLogPath = (logsRoot: string, sessionId: string, logFolderName = FAMILY_FOLDER) =>
    path.join(logsRoot, logFolderName, `${sessionId}.jsonl`);

  /** Append one user Message `uuid` to the session log at `logPath`. */
  function appendUserMessage(logPath: string, uuid: string): void {
    const record = {
      type: "user",
      uuid,
      timestamp: "2026-06-21T15:00:00.000Z",
      cwd: "/Users/me/dev/family",
      version: "2.1.300",
      message: { role: "user", content: `message ${uuid}` },
    };
    writeFileSync(logPath, `${readFileSync(logPath, "utf8")}${JSON.stringify(record)}\n`);
  }

  /**
   * Refresh the fixture root `fixtureRootName` (the family logs by default) as
   * `before` leaves it, apply `change`, then Refresh again — and cold, into a
   * second database: the continuations of each.
   */
  async function changedAndCold(
    before: (logsRoot: string) => void,
    change: (logsRoot: string) => void,
    fixtureRootName = "family-logs",
  ) {
    const logsRoot = path.join(tmpDir, "logs");
    const changedDbPath = path.join(tmpDir, "changed.db");
    const coldDbPath = path.join(tmpDir, "cold.db");
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, fixtureRootName), logsRoot);
    const setAside = path.join(tmpDir, "set-aside");
    mkdirSync(setAside);
    before(logsRoot);
    await refresh({ logsRoot, dbPath: changedDbPath });
    change(logsRoot);
    const changedSummary = await refresh({ logsRoot, dbPath: changedDbPath });
    await refresh({ logsRoot, dbPath: coldDbPath });
    return {
      changedContent: continuationContent(changedDbPath),
      coldContent: continuationContent(coldDbPath),
      changedSummary,
    };
  }

  /** Move the log of `sessionId` out of the logs root, keeping it for {@link restoreLog}. */
  const setLogAside = (logsRoot: string, sessionId: string, logFolderName = FAMILY_FOLDER) =>
    renameSync(
      sessionLogPath(logsRoot, sessionId, logFolderName),
      path.join(tmpDir, "set-aside", `${sessionId}.jsonl`),
    );
  /** Move the log of `sessionId` back where {@link setLogAside} took it from. */
  const restoreLog = (logsRoot: string, sessionId: string, logFolderName = FAMILY_FOLDER) =>
    renameSync(
      path.join(tmpDir, "set-aside", `${sessionId}.jsonl`),
      sessionLogPath(logsRoot, sessionId, logFolderName),
    );

  /** The session a Conversation continues from, in `content`. */
  const continuedFromOf = (content: ReturnType<typeof continuationContent>, sessionId: string) =>
    (content.links as { session_id: string; continuedFromSessionId: string | null }[]).find(
      (link) => link.session_id === sessionId,
    )?.continuedFromSessionId;

  it("are stored as the pinned rows for the family logs", async () => {
    const logsRoot = path.join(tmpDir, "logs");
    const dbPath = path.join(tmpDir, "analyzer.db");
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "family-logs"), logsRoot);
    await refresh({ logsRoot, dbPath });

    expect(fingerprintStoredData(dbPath, logsRoot)).toEqual({
      project: { rowCount: 4, sha256: "22e03dd6cdf94d1b50e8c393efeb02e01452e218a539f452ce79dda37d7e9a94" },
      // Each continuation names its parent; sess-orphan, sess-fam-solo and sess-legacy-fork name none.
      conversation: { rowCount: 10, sha256: "b842345f468dca45be08595f86d0a446f5d7e858a41e6586241f2ab2ddc951ce" },
      agent: { rowCount: 12, sha256: "02d3ec7fae2b56dab3693127d339937d9654818fa7970c6dd830ddb47d0769c4" },
      // The copies of the parents' Messages, sess-fam-b's copied Sub-agent included, are flagged.
      message: { rowCount: 43, sha256: "1accad12a52ba280e0be3a006249a3daefaaa7077cf86615647ff847c6af8770" },
      tool_call: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      pr_link: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      turn_duration: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      ...NO_LOGGED_API_REQUESTS,
      continued_in: { rowCount: 4, sha256: "ec21bb4d85f23ded7081dba5372a4d755020a106cfeb93ab394e71b9e0aff89c" },
    });
  });

  it("are decided as a cold Refresh decides them when the parent alone is re-parsed", async () => {
    const { changedContent, coldContent } = await changedAndCold(
      () => {},
      (logsRoot) => appendUserMessage(sessionLogPath(logsRoot, "sess-fam-a"), "fam-a-u2"),
    );

    expect(changedContent).toEqual(coldContent);
    expect(continuedFromOf(coldContent, "sess-fam-b")).toBe("sess-fam-a");
  });

  it("are decided as a cold Refresh decides them when the child is appended to", async () => {
    const { changedContent, coldContent } = await changedAndCold(
      () => {},
      (logsRoot) => appendUserMessage(sessionLogPath(logsRoot, "sess-fam-b"), "fam-b-u2"),
    );

    expect(changedContent).toEqual(coldContent);
    expect(continuedFromOf(coldContent, "sess-fam-c")).toBe("sess-fam-b");
  });

  it("are decided as a cold Refresh decides them when the grandchild appears later", async () => {
    const { changedContent, coldContent } = await changedAndCold(
      (logsRoot) => setLogAside(logsRoot, "sess-fam-c"),
      (logsRoot) => restoreLog(logsRoot, "sess-fam-c"),
    );

    expect(changedContent).toEqual(coldContent);
    expect(continuedFromOf(coldContent, "sess-fam-c")).toBe("sess-fam-b");
  });

  it("are decided as a cold Refresh decides them when an original appears after the copies it holds", async () => {
    // The record-naming parent of a stored family, and the original of a
    // stored copy no record names: each makes stored, unchanged Conversations
    // its continuations, their Copied Messages with them.
    const { changedContent, coldContent } = await changedAndCold(
      (logsRoot) => {
        setLogAside(logsRoot, "sess-fam-a");
        setLogAside(logsRoot, "sess-legacy-a", "-Users-me-dev-legacy");
      },
      (logsRoot) => {
        restoreLog(logsRoot, "sess-fam-a");
        restoreLog(logsRoot, "sess-legacy-a", "-Users-me-dev-legacy");
      },
    );

    expect(changedContent).toEqual(coldContent);
    expect(continuedFromOf(coldContent, "sess-fam-b")).toBe("sess-fam-a");
    expect(continuedFromOf(coldContent, "sess-legacy-b")).toBe("sess-legacy-a");
  });

  it("are decided as a cold Refresh decides them when the middle sitting is deleted", async () => {
    const { changedContent, coldContent } = await changedAndCold(
      () => {},
      (logsRoot) => rmSync(sessionLogPath(logsRoot, "sess-fam-b"), { recursive: true }),
    );

    expect(changedContent).toEqual(coldContent);
    // No record names sess-fam-c any more: it holds all of sess-fam-a's Messages.
    expect(continuedFromOf(coldContent, "sess-fam-c")).toBe("sess-fam-a");
  });

  describe("of forked Sub-agents", () => {
    const FORKS_FOLDER = "-Users-me-dev-forks";
    const FORKS_FIXTURE_ROOT_NAME = "forked-agent-logs";

    /** The path of Sub-agent `agentId`'s log file in sess-forks, under `logsRoot`. */
    const forkLogPath = (logsRoot: string, agentId: string) =>
      path.join(logsRoot, FORKS_FOLDER, "sess-forks", "subagents", `agent-${agentId}.jsonl`);
    /** Where {@link forkLogPath}'s file waits while set aside. */
    const setAsideForkLogPath = (agentId: string) => path.join(tmpDir, "set-aside", `agent-${agentId}.jsonl`);

    /** The uuids of Sub-agent `agentId`'s Copied Messages in sess-forks, in `content`. */
    const copiedUuidsOf = (content: ReturnType<typeof continuationContent>, agentId: string) =>
      (content.messages as { session_id: string; external_agent_id: string | null; uuid: string; is_copied: number }[])
        .filter((m) => m.session_id === "sess-forks" && m.external_agent_id === agentId && m.is_copied === 1)
        .map((m) => m.uuid);

    /** The cold Refresh's flags, checked to be the forks' copies, so no comparison below passes on no flags at all. */
    const expectForksFlagged = (coldContent: ReturnType<typeof continuationContent>) => {
      expect(copiedUuidsOf(coldContent, "fork-lead")).toEqual([]);
      expect(copiedUuidsOf(coldContent, "fork-a")).toEqual(["lead-a1", "lead-u1"]);
      expect(copiedUuidsOf(coldContent, "fork-b")).toEqual([
        "fork-a-a1",
        "fork-a-a2",
        "fork-a-u1",
        "lead-a1",
        "lead-u1",
      ]);
    };

    it("are stored as the pinned rows for the forked Sub-agent logs", async () => {
      const logsRoot = path.join(tmpDir, "logs");
      const dbPath = path.join(tmpDir, "analyzer.db");
      copyWithPinnedMtimes(path.join(FIXTURES_DIR, FORKS_FIXTURE_ROOT_NAME), logsRoot);
      await refresh({ logsRoot, dbPath });

      expect(fingerprintStoredData(dbPath, logsRoot)).toEqual({
        project: { rowCount: 1, sha256: "feba540146d17e8b299b85b8b419edb0f24a80e6a19fb1209d37f6936f17c75a" },
        conversation: { rowCount: 1, sha256: "7fefcbc6307e8bea43affd54778cd5a2382be3e301dfb4da7af9359a35dcec45" },
        // fork-a under fork-lead, fork-b under fork-a: each stored under the Sub-agent that spawned it.
        agent: { rowCount: 4, sha256: "a4f026fc46ec435fff99e25e5e712dcaad530c883e03f24f42bea5b60a49d4e1" },
        // Each fork's copy of its spawner's Messages is flagged.
        message: { rowCount: 25, sha256: "c25ab69f4bbbaf98d46f2009f9df948691b5f5a9ce1d88955c056d4be127bf0a" },
        tool_call: { rowCount: 6, sha256: "eb6fa55b8ab37a703f86136cd5d228e644e0032e19c3abf12fb9657b4b2158bb" },
        pr_link: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
        turn_duration: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
        ...NO_LOGGED_API_REQUESTS,
        continued_in: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      });
    });

    // Each fork's spawn ledger is in its spawner's file, which stays unchanged and unread.
    it.each(["fork-a", "fork-b"])(
      "are decided as a cold Refresh decides them when %s appears later",
      async (agentId) => {
        const { changedContent, coldContent } = await changedAndCold(
          (logsRoot) => renameSync(forkLogPath(logsRoot, agentId), setAsideForkLogPath(agentId)),
          (logsRoot) => renameSync(setAsideForkLogPath(agentId), forkLogPath(logsRoot, agentId)),
          FORKS_FIXTURE_ROOT_NAME,
        );

        expect(changedContent).toEqual(coldContent);
        expectForksFlagged(coldContent);
      },
    );

    // The Main thread's file, the changed one, and the stored spawner of the changed one: the others stay unread.
    it.each([
      { agentId: "fork-lead", logFilesParsed: 2 },
      { agentId: "fork-a", logFilesParsed: 3 },
      { agentId: "fork-b", logFilesParsed: 3 },
    ])(
      "are decided as a cold Refresh decides them when $agentId alone is re-parsed",
      async ({ agentId, logFilesParsed }) => {
        const { changedContent, coldContent, changedSummary } = await changedAndCold(
          () => {},
          (logsRoot) => appendUserMessage(forkLogPath(logsRoot, agentId), `${agentId}-u-appended`),
          FORKS_FIXTURE_ROOT_NAME,
        );

        expect(changedSummary.logFilesParsed).toBe(logFilesParsed);
        expect(changedContent).toEqual(coldContent);
        expectForksFlagged(coldContent);
      },
    );

    it("are decided as a cold Refresh decides them when the Conversation is deleted, then added again", async () => {
      const logsRoot = path.join(tmpDir, "logs");
      const changedDbPath = path.join(tmpDir, "changed.db");
      const coldDbPath = path.join(tmpDir, "cold.db");
      copyWithPinnedMtimes(path.join(FIXTURES_DIR, FORKS_FIXTURE_ROOT_NAME), logsRoot);
      // The Main thread's file and the folder of its Sub-agents' files, each with where it waits while set aside.
      const sessionPathPairs = ["sess-forks.jsonl", "sess-forks"].map((name) => ({
        inLogsRoot: path.join(logsRoot, FORKS_FOLDER, name),
        setAside: path.join(tmpDir, name),
      }));
      await refresh({ logsRoot, dbPath: changedDbPath });
      for (const { inLogsRoot, setAside } of sessionPathPairs) renameSync(inLogsRoot, setAside);
      await refresh({ logsRoot, dbPath: changedDbPath });
      for (const { inLogsRoot, setAside } of sessionPathPairs) renameSync(setAside, inLogsRoot);
      await refresh({ logsRoot, dbPath: changedDbPath });
      await refresh({ logsRoot, dbPath: coldDbPath });

      const coldContent = continuationContent(coldDbPath);
      expect(continuationContent(changedDbPath)).toEqual(coldContent);
      expectForksFlagged(coldContent);
    });
  });
});

describe("Turns whose API request is in another file", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-cross-file-equivalence-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const RESUMED_LOG_FOLDER = "-Users-me-dev-resumed";

  /** Copy the resumed request logs to a new logs root under `tmpDir`, named `name`, and return it. */
  function resumedRequestLogs(name: string): string {
    const logsRoot = path.join(tmpDir, name);
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "resumed-request-logs"), logsRoot);
    return logsRoot;
  }

  it("are linked as a cold Refresh parsing the parent first links them, when it parses the child first", async () => {
    // The fixture's own paths put the child first; a log folder that sorts
    // first takes the parent and the copy of its first request to the front.
    const childFirstRoot = resumedRequestLogs("child-first");
    const parentFirstRoot = resumedRequestLogs("parent-first");
    const earlyFolder = path.join(parentFirstRoot, "-Users-me-dev-a");
    mkdirSync(earlyFolder);
    for (const sessionId of ["sess-resumed-parent", "sess-resumed-copy"]) {
      renameSync(
        path.join(parentFirstRoot, RESUMED_LOG_FOLDER, `${sessionId}.jsonl`),
        path.join(earlyFolder, `${sessionId}.jsonl`),
      );
    }
    await refresh({ logsRoot: childFirstRoot, dbPath: path.join(tmpDir, "child-first.db") });
    await refresh({ logsRoot: parentFirstRoot, dbPath: path.join(tmpDir, "parent-first.db") });

    const childFirst = crossFileContent(path.join(tmpDir, "child-first.db"), childFirstRoot);
    expect(childFirst.turnApiRequests).toContainEqual(
      expect.objectContaining({
        session_id: "sess-resumed-child",
        uuid: "ra2",
        requestSessionId: "sess-resumed-parent",
      }),
    );
    expect(crossFileContent(path.join(tmpDir, "parent-first.db"), parentFirstRoot)).toEqual(childFirst);
  });

  /**
   * Refresh the resumed request logs, apply `change` to the parent's log file,
   * then Refresh again — and cold, into a second database: the cross-file
   * content of each.
   */
  async function changedAndCold(change: (parentLogPath: string) => void) {
    const logsRoot = resumedRequestLogs("logs");
    const changedDbPath = path.join(tmpDir, "changed.db");
    const coldDbPath = path.join(tmpDir, "cold.db");
    await refresh({ logsRoot, dbPath: changedDbPath });
    change(path.join(logsRoot, RESUMED_LOG_FOLDER, "sess-resumed-parent.jsonl"));
    await refresh({ logsRoot, dbPath: changedDbPath });
    await refresh({ logsRoot, dbPath: coldDbPath });
    return {
      changedContent: crossFileContent(changedDbPath, logsRoot),
      coldContent: crossFileContent(coldDbPath, logsRoot),
    };
  }

  /** Where the Turn `uuid` of the resumed child reads its API request from, in `content`. */
  const childTurnRequestSessionId = (content: ReturnType<typeof crossFileContent>, uuid: string) =>
    (content.turnApiRequests as { session_id: string; uuid: string; requestSessionId: string | null }[]).find(
      (turn) => turn.session_id === "sess-resumed-child" && turn.uuid === uuid,
    )?.requestSessionId;

  it("stay linked when the parent alone is re-parsed, as a cold Refresh links them", async () => {
    const { changedContent, coldContent } = await changedAndCold((parentLogPath) =>
      writeFileSync(
        parentLogPath,
        readFileSync(parentLogPath, "utf8").replace("The parent session", "The parent session, renamed"),
      ),
    );

    expect(changedContent).toEqual(coldContent);
    expect(childTurnRequestSessionId(coldContent, "ra2")).toBe("sess-resumed-parent");
  });

  it("lose their API request with the parent's file, as a cold Refresh without it does", async () => {
    const { changedContent, coldContent } = await changedAndCold((parentLogPath) => rmSync(parentLogPath));

    expect(changedContent).toEqual(coldContent);
    expect(childTurnRequestSessionId(coldContent, "ra2")).toBeNull();
    expect(childTurnRequestSessionId(coldContent, "ra1")).toBe("sess-resumed-copy");
  });
});

describe("a re-parse", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-reparse-equivalence-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /**
   * Refresh the logged request logs, rewrite the main log's lines with
   * `rewrite`, then Refresh again — and cold, into a second database: the
   * request-record tables of each, and of the first Refresh.
   */
  async function reparsedAndCold(rewrite: (lines: string[]) => string[]) {
    const logsRoot = path.join(tmpDir, "logs");
    const reparsedDbPath = path.join(tmpDir, "reparsed.db");
    const coldDbPath = path.join(tmpDir, "cold.db");
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "logged-request-logs"), logsRoot);
    await refresh({ logsRoot, dbPath: reparsedDbPath });
    const beforeContent = apiRequestContent(reparsedDbPath, logsRoot);
    const mainLogPath = path.join(logsRoot, "-Users-me-dev-logged", "sess-logged.jsonl");
    writeFileSync(mainLogPath, rewrite(readFileSync(mainLogPath, "utf8").split("\n")).join("\n"));
    await refresh({ logsRoot, dbPath: reparsedDbPath });
    await refresh({ logsRoot, dbPath: coldDbPath });
    return {
      beforeContent,
      reparsedContent: apiRequestContent(reparsedDbPath, logsRoot),
      coldContent: apiRequestContent(coldDbPath, logsRoot),
    };
  }

  it("stores what a cold Refresh does, even when the change leaves a system prompt and a tool set unused", async () => {
    // The last request now sends the first shape: the second one's system prompt and tool set are used by nothing.
    const { reparsedContent, coldContent } = await reparsedAndCold((lines) =>
      lines
        .filter((line) => !line.includes('"shapeHash":"shape-2","shape"'))
        .map((line) => line.replace('"shapeHash":"shape-2"', '"shapeHash":"shape-1"')),
    );

    expect(reparsedContent).toEqual(coldContent);
    expect(coldContent.system_prompt.rowCount).toBe(3);
  });

  it("stores what a cold Refresh does, even when the change leaves a sent message named by no tail", async () => {
    // The request that sent the date-change reminder no longer names it: its blob is sent by nothing.
    const { beforeContent, reparsedContent, coldContent } = await reparsedAndCold((lines) => {
      const blobLine = lines.find(
        (line) => line.includes('"type":"api-request-blob"') && line.includes("date changed"),
      );
      const { hash } = JSON.parse(blobLine!) as { hash: string };
      return lines.map((line) => line.replace(`"${hash}",`, ""));
    });

    expect(reparsedContent).toEqual(coldContent);
    expect(coldContent.sent_message.rowCount).toBe(beforeContent.sent_message.rowCount - 1);
  });

  it("stores what a cold Refresh does, even when the change makes an unanswered request a Failed attempt", async () => {
    // lreq-3 now resends lreq-2's very body: lreq-2 becomes a Failed attempt of lreq-3's Turn.
    const { beforeContent, reparsedContent, coldContent } = await reparsedAndCold((lines) =>
      lines.map((line) => line.replace('"requestDigest":"digest-lreq-3"', '"requestDigest":"digest-lreq-2"')),
    );

    expect(reparsedContent).toEqual(coldContent);
    const ownerUuidOf = (content: typeof coldContent, recordId: string) =>
      (content.requests as { record_id: string; failedAttemptOfMessageUuid: string | null }[]).find(
        (request) => request.record_id === recordId,
      )?.failedAttemptOfMessageUuid;
    expect(ownerUuidOf(beforeContent, "lreq-2")).toBeNull();
    expect(ownerUuidOf(coldContent, "lreq-2")).toEqual(expect.any(String));
  });
});

describe("a tool set two logs spell in two key orders", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-tool-set-spelling-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** A tool definition, its keys in the order given. */
  const BASH_NAME_FIRST = { name: "Bash", description: "Run a command.", input_schema: { type: "object" } };
  const BASH_SCHEMA_FIRST = { input_schema: { type: "object" }, description: "Run a command.", name: "Bash" };

  /** Write a 2.1.305 session `sessionId` whose one API request sends `tools`. */
  function writeSessionSending(logsRoot: string, sessionId: string, tools: object[]): void {
    const folder = path.join(logsRoot, "-Users-me-dev-spelling");
    mkdirSync(folder, { recursive: true });
    const records = [
      {
        type: "user",
        uuid: `${sessionId}-u`,
        timestamp: "2026-10-21T10:00:00.000Z",
        cwd: "/Users/me/dev/spelling",
        version: "2.1.305",
        message: { role: "user", content: "hi" },
      },
      { type: "api-request-shape", sessionId, shapeHash: "shape", shape: { system: [], tools } },
      {
        type: "api-request",
        sessionId,
        id: `${sessionId}-req`,
        keep: 0,
        tail: [],
        shapeHash: "shape",
        params: {},
        cacheControl: [],
        timestamp: "2026-10-21T10:00:01.000Z",
      },
      {
        type: "assistant",
        uuid: `${sessionId}-a`,
        requestRef: `${sessionId}-req`,
        timestamp: "2026-10-21T10:00:05.000Z",
        cwd: "/Users/me/dev/spelling",
        version: "2.1.305",
        message: {
          id: `${sessionId}-msg`,
          role: "assistant",
          model: "claude-opus-4-8",
          content: [{ type: "text", text: "Hello." }],
        },
      },
    ];
    writeFileSync(
      path.join(folder, `${sessionId}.jsonl`),
      records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    );
  }

  /** The stored tool sets of the database at `dbPath`. */
  function storedToolSets(dbPath: string): unknown[] {
    const db = new Database(dbPath, { readonly: true });
    try {
      return db.prepare(`SELECT "hash", "tools_json" FROM "tool_set" ORDER BY "hash"`).all();
    } finally {
      db.close();
    }
  }

  it("is stored as the smallest spelling, whichever log was parsed first", async () => {
    const logsRoot = path.join(tmpDir, "logs");
    const schemaFirstThenNameFirst = path.join(tmpDir, "schema-first.db");
    const nameFirstThenSchemaFirst = path.join(tmpDir, "name-first.db");
    // Discovery writes `sess-a` before `sess-b`: a cold Refresh of both parses the schema-first one first…
    writeSessionSending(logsRoot, "sess-a", [BASH_SCHEMA_FIRST]);
    writeSessionSending(logsRoot, "sess-b", [BASH_NAME_FIRST]);
    await refresh({ logsRoot, dbPath: schemaFirstThenNameFirst });
    // …and a Refresh that sees `sess-b` alone, then both, parses the name-first one first.
    rmSync(path.join(logsRoot, "-Users-me-dev-spelling", "sess-a.jsonl"));
    await refresh({ logsRoot, dbPath: nameFirstThenSchemaFirst });
    writeSessionSending(logsRoot, "sess-a", [BASH_SCHEMA_FIRST]);
    await refresh({ logsRoot, dbPath: nameFirstThenSchemaFirst });

    const smallestSpelling = [JSON.stringify([BASH_NAME_FIRST]), JSON.stringify([BASH_SCHEMA_FIRST])].sort()[0];
    expect(storedToolSets(schemaFirstThenNameFirst)).toEqual([
      { hash: expect.any(String), tools_json: smallestSpelling },
    ]);
    expect(storedToolSets(nameFirstThenSchemaFirst)).toEqual(storedToolSets(schemaFirstThenNameFirst));
  });
});

describe("a sent message one log labels and another does not", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-sent-message-labels-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const DATE_TEXT = "The date has changed. Today's date is now 2026-10-22.";
  /** The attachment naming the date change, in the log that labels it. */
  const DATE_ATTACHMENT: RecordedAttachment = {
    attachmentType: "date",
    rendered: `<system-reminder>\n${DATE_TEXT}\n</system-reminder>`,
    renderedRole: "system",
  };

  /** Write session `sessionId`, whose one API request sends the date change, logging its attachment when `isLabelled`. */
  function writeSessionSendingTheDate(logsRoot: string, sessionId: string, isLabelled: boolean): void {
    writeRequestRecordsLog(logsRoot, sessionId, [
      {
        system: "Answer briefly.",
        tools: [],
        messages: [
          { role: "user", content: "hi" },
          { role: "system", content: DATE_TEXT },
        ],
        attachments: isLabelled ? [DATE_ATTACHMENT] : [],
      },
    ]);
  }

  /** The stored sent messages of the database at `dbPath`. */
  function storedSentMessages(dbPath: string): unknown[] {
    const db = new Database(dbPath, { readonly: true });
    try {
      return db.prepare(`SELECT * FROM "sent_message" ORDER BY "hash"`).all();
    } finally {
      db.close();
    }
  }

  /** The sent messages a Refresh of `firstSessionId` alone, then of both sessions, stores. */
  async function storedAfterAddingTheOther(firstSessionId: "sess-labelled" | "sess-unlabelled") {
    const logsRoot = path.join(tmpDir, `logs-${firstSessionId}`);
    const dbPath = path.join(tmpDir, `${firstSessionId}-first.db`);
    writeSessionSendingTheDate(logsRoot, firstSessionId, firstSessionId === "sess-labelled");
    await refresh({ logsRoot, dbPath });
    const otherSessionId = firstSessionId === "sess-labelled" ? "sess-unlabelled" : "sess-labelled";
    writeSessionSendingTheDate(logsRoot, otherSessionId, otherSessionId === "sess-labelled");
    await refresh({ logsRoot, dbPath });
    return storedSentMessages(dbPath);
  }

  it("keeps the labelled copy, whichever log was parsed first, as a cold Refresh does", async () => {
    const logsRoot = path.join(tmpDir, "logs-cold");
    const coldDbPath = path.join(tmpDir, "cold.db");
    writeSessionSendingTheDate(logsRoot, "sess-labelled", true);
    writeSessionSendingTheDate(logsRoot, "sess-unlabelled", false);
    await refresh({ logsRoot, dbPath: coldDbPath });
    const cold = storedSentMessages(coldDbPath);

    expect(cold).toContainEqual({
      hash: expect.any(String),
      message_json: JSON.stringify({ role: "system", content: DATE_TEXT }),
      injected_context_pieces_json: JSON.stringify([{ blockIndex: 0, start: 0, end: DATE_TEXT.length, kind: "date" }]),
    });
    expect(await storedAfterAddingTheOther("sess-unlabelled")).toEqual(cold);
    expect(await storedAfterAddingTheOther("sess-labelled")).toEqual(cold);
  });
});

/**
 * {@link apiRequestContent} of the database at `dbPath`, and the API request
 * each Turn with a `requestRef` names, keyed by stable fields only — the
 * Turn's session id and `uuid`, the request's session id, Agent and place in
 * its file — so it is the same whatever row ids the Refreshes gave.
 */
function crossFileContent(dbPath: string, logsRoot: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const turnApiRequests = db
      .prepare(
        `SELECT "turn_conversation"."session_id", "message"."uuid", "message"."request_ref",
                "request_conversation"."session_id" AS "requestSessionId",
                "request_agent"."external_agent_id" AS "requestExternalAgentId",
                "api_request"."position_in_file" AS "requestPositionInFile"
           FROM "message"
           JOIN "conversation" AS "turn_conversation" ON "turn_conversation"."id" = "message"."conversation_id"
           LEFT JOIN "api_request" ON "api_request"."id" = "message"."api_request_id"
           LEFT JOIN "conversation" AS "request_conversation" ON "request_conversation"."id" = "api_request"."conversation_id"
           LEFT JOIN "agent" AS "request_agent" ON "request_agent"."id" = "api_request"."agent_id"
          WHERE "message"."request_ref" IS NOT NULL
          ORDER BY "turn_conversation"."session_id", "message"."uuid"`,
      )
      .all();
    return { turnApiRequests, ...apiRequestContent(dbPath, logsRoot) };
  } finally {
    db.close();
  }
}

/**
 * The continuations of the database at `dbPath`, keyed by stable fields only,
 * so they are the same whatever row ids the Refreshes gave: the session each
 * Conversation continues from, whether each Message of each Agent is a
 * Copied Message, and the Agent each Sub-agent was spawned by.
 */
function continuationContent(dbPath: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const links = db
      .prepare(
        `SELECT "conversation"."session_id", "parent"."session_id" AS "continuedFromSessionId"
           FROM "conversation"
           LEFT JOIN "conversation" AS "parent" ON "parent"."id" = "conversation"."continued_from_conversation_id"
          ORDER BY "conversation"."session_id"`,
      )
      .all();
    const messages = db
      .prepare(
        `SELECT "conversation"."session_id", "agent"."external_agent_id", "message"."uuid", "message"."is_copied"
           FROM "message"
           JOIN "conversation" ON "conversation"."id" = "message"."conversation_id"
           JOIN "agent" ON "agent"."id" = "message"."agent_id"
          ORDER BY "conversation"."session_id", "agent"."external_agent_id", "message"."uuid"`,
      )
      .all();
    const spawns = db
      .prepare(
        `SELECT "conversation"."session_id", "agent"."external_agent_id",
                "spawner"."external_agent_id" AS "spawnerExternalAgentId",
                "spawner"."id" IS NOT NULL AS "hasSpawner"
           FROM "agent"
           JOIN "conversation" ON "conversation"."id" = "agent"."conversation_id"
           LEFT JOIN "agent" AS "spawner" ON "spawner"."id" = "agent"."parent_agent_id"
          WHERE "agent"."external_agent_id" IS NOT NULL
          ORDER BY "conversation"."session_id", "agent"."external_agent_id"`,
      )
      .all();
    return { links, messages, spawns };
  } finally {
    db.close();
  }
}

/**
 * The request-record tables of the database at `dbPath`, whatever row ids the
 * Refreshes gave: the interned rows whole, the requests without their row id and
 * foreign keys, but whether a Turn answered them, and the `uuid` of the Turn's
 * Message owning one as a Failed attempt.
 */
function apiRequestContent(dbPath: string, logsRoot: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const requests = db
      .prepare(
        `SELECT "record_id", "base_record_id", "kept_message_count", "tail_message_hashes_json", "parameters_json",
                "cache_breakpoints_json", "query_source", "request_digest", "sent_at", "position_in_file",
                "system_prompt_hash", "tool_set_hash",
                NOT EXISTS (SELECT 1 FROM "message" WHERE "api_request_id" = "api_request"."id") AS "isUnanswered",
                "owner"."uuid" AS "failedAttemptOfMessageUuid"
           FROM "api_request"
           LEFT JOIN "message" AS "owner" ON "owner"."id" = "api_request"."failed_attempt_of_message_id"
          ORDER BY "record_id"`,
      )
      .all();
    return {
      requests,
      system_prompt: fingerprintTable(db, "system_prompt", logsRoot),
      tool_set: fingerprintTable(db, "tool_set", logsRoot),
      sent_message: fingerprintTable(db, "sent_message", logsRoot),
    };
  } finally {
    db.close();
  }
}
