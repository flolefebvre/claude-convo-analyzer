// Stored data is pinned: a Refresh of each fixture root into a fresh database
// writes exactly these rows — same count, same ids, same column values and
// storage types — in all eleven tables. The write path is free to change; what
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
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { refresh } from "@/core/refresh";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");

/** The eleven tables of ADR-0001, each pinned by its row count and checksum. */
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

/**
 * Fingerprint one table: rows ordered by their primary key (`id`, or a
 * piece's `hash`), every column through SQLite's `quote()` — which keeps
 * integer, real, text and NULL distinct — one line per row, hashed with
 * sha256. The temp logs root is replaced by a placeholder.
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
  for (const row of rows) hash.update(`${row.join("\t").replaceAll(logsRoot, LOGS_ROOT_PLACEHOLDER)}\n`);
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
      conversation: { rowCount: 21, sha256: "3b9244582356d8518e8f1ca73f5d99952887efd3a879f8cd69e08c0037e15497" },
      agent: { rowCount: 35, sha256: "bcf922290517994e489068e748364ff9de40929e4a8ddfbcb68c6f6014836468" },
      message: { rowCount: 125, sha256: "a6c4493eb7d8954b3a993d59f57a4f00076d965adda9302418492d6c6a262250" },
      tool_call: { rowCount: 34, sha256: "58586fdaa0ea9e906fd5037c8a3c7809fd2fd1d4602ec6280e34db111716b5f4" },
      pr_link: { rowCount: 1, sha256: "efff4b0f419e7b55d6dc8602b3503e06e81829e6fd868d216679845fa0970d16" },
      turn_duration: { rowCount: 1, sha256: "11a23dd83764e1de631b25b7b2fb8a6b5af397fe1503b2086f0404a57cb943c4" },
      ...NO_LOGGED_API_REQUESTS,
    });
  });

  it("stores the pinned rows for the inter-agent message logs", async () => {
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "agent-message-logs"), logsRoot);
    await refresh({ logsRoot, dbPath });

    expect(fingerprintStoredData(dbPath, logsRoot)).toEqual({
      project: { rowCount: 1, sha256: "5d55ed2d1c37a5a354777b7e27dfce7bb9f299e0e7237d17a32956fee0357675" },
      conversation: { rowCount: 1, sha256: "f2a4cacd0ce7217fea6ca6c889f3572d4e84dea3f1ba85ec433b4cbf890fc98f" },
      agent: { rowCount: 2, sha256: "9cddce4d56d246718241b05d406551e917f8d9c1d9a116799eb257bc48089a61" },
      message: { rowCount: 28, sha256: "466d200445a86bff2133b1b984bb84e2275c7daafd0d394be1959e45dd9e1e73" },
      tool_call: { rowCount: 1, sha256: "a7fdb225fda2bff0ca75f88a22789a86cd79a97f5ea4e2f952e1d4559aa8efd9" },
      pr_link: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      turn_duration: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      ...NO_LOGGED_API_REQUESTS,
    });
  });

  it("stores the pinned rows for the Project path logs (worktree switches, cwd-less Conversations)", async () => {
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "project-logs"), logsRoot);
    await refresh({ logsRoot, dbPath });

    expect(fingerprintStoredData(dbPath, logsRoot)).toEqual({
      project: { rowCount: 9, sha256: "e740c951fb2b58e8b13902eea830681396ac5eea03a445a31d6fb998c250a3e1" },
      conversation: { rowCount: 13, sha256: "1abc05623266522c44bd2770c19b91096b3e0260ee4bb0a339b9519e75c71349" },
      agent: { rowCount: 13, sha256: "47aa156cd547f0ad4f24ca8d2f27122dfa765f0de80b37a46a3507b22ade253f" },
      message: { rowCount: 22, sha256: "dcd26004fc7ee5f70d37088e8b7cead05a24a88ffca18899ea854cfec7514311" },
      tool_call: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      pr_link: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      turn_duration: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      ...NO_LOGGED_API_REQUESTS,
    });
  });

  it("stores the pinned rows for the API error logs", async () => {
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "error-logs"), logsRoot);
    await refresh({ logsRoot, dbPath });

    expect(fingerprintStoredData(dbPath, logsRoot)).toEqual({
      project: { rowCount: 1, sha256: "c39a0134a2be51dcdd6348bf0657691be4b1d4092d6e1616117c4d0f4f58a771" },
      conversation: { rowCount: 4, sha256: "a4e1f69f7ae506e1e06436dc1a5e8ed406d7cbca7a43e8aa50f5b1728eae7fc0" },
      agent: { rowCount: 5, sha256: "c0938e2f66085f42e8e7e5ee608867bb0974528d74f6dd4ead50afad13e0e8a1" },
      message: { rowCount: 17, sha256: "57dd0ac441733ef3b55dd0bb598ece1c0204c1c55f28cbf23747937e96a049fb" },
      tool_call: { rowCount: 1, sha256: "e331ea30643c19a0602a2759f557187aacaf1729c796a955560799b9c4dbd73f" },
      pr_link: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      turn_duration: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      ...NO_LOGGED_API_REQUESTS,
    });
  });

  it("stores the pinned rows for the logged request logs (request records, Main thread and Sub-agent, each piece once)", async () => {
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "logged-request-logs"), logsRoot);
    await refresh({ logsRoot, dbPath });

    expect(fingerprintStoredData(dbPath, logsRoot)).toEqual({
      project: { rowCount: 1, sha256: "8b9da1ddb86766f02f4a1ac8d582400f0f6c9e5071156b7b726e7b6d9bf11d31" },
      conversation: { rowCount: 3, sha256: "ecbe0ad0042cc41d2ec6fb0987774df42dce9af3198082d6f6e42ac03da9f70d" },
      agent: { rowCount: 4, sha256: "5183823b6f5d49ed8cedbdc07b0046a87c72ec8ce45a90423a939cc6fe42d620" },
      message: { rowCount: 19, sha256: "f15867490847ded5e9c25fa1c23212303c2828b2e7b3c82c03f0d34dd972a592" },
      tool_call: { rowCount: 3, sha256: "e5f615b5d6290bc0dab75ea171da282d5e176e04be16438fc4d834c227f91b9d" },
      pr_link: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      turn_duration: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      api_request: { rowCount: 8, sha256: "dc61f1c84636a85d51fa06c9ec0eedb89cfd56d6301377dbb38257656eb8d3f9" },
      // Four system prompts and three tool sets: the Sub-agent shares the Main thread's first one.
      system_prompt: { rowCount: 4, sha256: "179129a51d494cdd6ea7fb72cf50d62900d9163160ed521f850dc233dae050bf" },
      tool_set: { rowCount: 3, sha256: "6b550b32e7738d046dd3c9f444e69eeba02357a973be985eac064674d0326323" },
      // Fifteen messages: two blobs, the others rebuilt from records; the tail hash no file holds is not stored.
      sent_message: { rowCount: 15, sha256: "126441cb097702d6b8e42db9bb724fa43d330ebe1e26322cde0285a9ddc48b67" },
    });
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

describe("a piece two logs spell in two key orders", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-piece-spelling-"));
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

/**
 * The request-record tables of the database at `dbPath`, whatever row ids the
 * Refreshes gave: the pieces whole, the requests without their row id and
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
                "system_prompt_hash", "tool_set_hash", "api_request"."message_id" IS NULL AS "isUnanswered",
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
