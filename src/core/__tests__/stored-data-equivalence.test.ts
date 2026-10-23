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
      conversation: { rowCount: 21, sha256: "835757974903288ae3a4b9f2271a6771577404fbdf3de24914cbe8ce2b20725d" },
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
      conversation: { rowCount: 1, sha256: "c6ecb5bc791a979b96c21ddd31164ff4ea8f203cecded3bc0d174e9cc29326f8" },
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
      conversation: { rowCount: 13, sha256: "d705f46eae9fcd1ecb31e56cc909f5e9038a17f9bc363be19cc74e2276458162" },
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
      conversation: { rowCount: 4, sha256: "e829d594549337139941728cfccdea8b3afcb1a4a85da091a815e1b92f23ae6a" },
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
      conversation: { rowCount: 3, sha256: "34eace8d2a9e8e1cbb490adc31211f8cd89212739b58c269a058f29c49db23f4" },
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
      conversation: { rowCount: 4, sha256: "3846e4559c0b863cf4096d258ce9b8b1eaa1cf77fb5692afff25b305daa7ecca" },
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
