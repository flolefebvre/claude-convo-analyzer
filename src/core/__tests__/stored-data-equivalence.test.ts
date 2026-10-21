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
import { openRecordingWriter, type RecordedApiRequest } from "@/core/recording";
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
  "logged_api_request",
  "system_prompt",
  "tool_set",
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
  logged_api_request: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
  system_prompt: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
  tool_set: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
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

/** Fingerprint all eleven tables of the database at `dbPath`. */
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
      conversation: { rowCount: 21, sha256: "d728b77316000b548a027f261cd904fabe9df6891c62c16d8e9cb3ba07c78431" },
      agent: { rowCount: 35, sha256: "bcf922290517994e489068e748364ff9de40929e4a8ddfbcb68c6f6014836468" },
      message: { rowCount: 125, sha256: "efde03aefa67065d8cc0e7f5c061c6d75b5d6a3211263c175dee68f0862b48c5" },
      tool_call: { rowCount: 34, sha256: "58586fdaa0ea9e906fd5037c8a3c7809fd2fd1d4602ec6280e34db111716b5f4" },
      pr_link: { rowCount: 1, sha256: "efff4b0f419e7b55d6dc8602b3503e06e81829e6fd868d216679845fa0970d16" },
      turn_duration: { rowCount: 1, sha256: "11a23dd83764e1de631b25b7b2fb8a6b5af397fe1503b2086f0404a57cb943c4" },
      api_request: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      ...NO_LOGGED_API_REQUESTS,
    });
  });

  it("stores the pinned rows for the inter-agent message logs", async () => {
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "agent-message-logs"), logsRoot);
    await refresh({ logsRoot, dbPath });

    expect(fingerprintStoredData(dbPath, logsRoot)).toEqual({
      project: { rowCount: 1, sha256: "5d55ed2d1c37a5a354777b7e27dfce7bb9f299e0e7237d17a32956fee0357675" },
      conversation: { rowCount: 1, sha256: "cdb72e44dac2a6b61b8b862e8181d31f837ec969000ed9f1defca7337c998288" },
      agent: { rowCount: 2, sha256: "9cddce4d56d246718241b05d406551e917f8d9c1d9a116799eb257bc48089a61" },
      message: { rowCount: 28, sha256: "cfdb0c9218cd0184517845f99b348d217ec655bd135e7c723999498fba0260dd" },
      tool_call: { rowCount: 1, sha256: "a7fdb225fda2bff0ca75f88a22789a86cd79a97f5ea4e2f952e1d4559aa8efd9" },
      pr_link: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      turn_duration: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      api_request: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      ...NO_LOGGED_API_REQUESTS,
    });
  });

  it("stores the pinned rows for the Project path logs (worktree switches, cwd-less Conversations)", async () => {
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "project-logs"), logsRoot);
    await refresh({ logsRoot, dbPath });

    expect(fingerprintStoredData(dbPath, logsRoot)).toEqual({
      project: { rowCount: 9, sha256: "e740c951fb2b58e8b13902eea830681396ac5eea03a445a31d6fb998c250a3e1" },
      conversation: { rowCount: 13, sha256: "4524902c51ae00b0b4c6cf78af84d2a171815836bd9a57b93126df1a000045e2" },
      agent: { rowCount: 13, sha256: "47aa156cd547f0ad4f24ca8d2f27122dfa765f0de80b37a46a3507b22ade253f" },
      message: { rowCount: 22, sha256: "c939415a25c68bca466283e335cd5a19447d35732c36f53ab3b32e8376a93c77" },
      tool_call: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      pr_link: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      turn_duration: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      api_request: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      ...NO_LOGGED_API_REQUESTS,
    });
  });

  it("stores the pinned rows for the API error logs", async () => {
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "error-logs"), logsRoot);
    await refresh({ logsRoot, dbPath });

    expect(fingerprintStoredData(dbPath, logsRoot)).toEqual({
      project: { rowCount: 1, sha256: "c39a0134a2be51dcdd6348bf0657691be4b1d4092d6e1616117c4d0f4f58a771" },
      conversation: { rowCount: 4, sha256: "436336945993e0e5687edf8f949adaa6aabaffcbe7eb58879963818d13634750" },
      agent: { rowCount: 5, sha256: "c0938e2f66085f42e8e7e5ee608867bb0974528d74f6dd4ead50afad13e0e8a1" },
      message: { rowCount: 17, sha256: "897eb312a4eb322388b382eeb8fefdf153a78cd7ef9b579df7438c4b530d01d1" },
      tool_call: { rowCount: 1, sha256: "e331ea30643c19a0602a2759f557187aacaf1729c796a955560799b9c4dbd73f" },
      pr_link: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      turn_duration: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      api_request: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      ...NO_LOGGED_API_REQUESTS,
    });
  });

  it("stores the pinned rows for the logged request logs (request records, Main thread and Sub-agent, each piece once)", async () => {
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "logged-request-logs"), logsRoot);
    await refresh({ logsRoot, dbPath });

    expect(fingerprintStoredData(dbPath, logsRoot)).toEqual({
      project: { rowCount: 1, sha256: "8b9da1ddb86766f02f4a1ac8d582400f0f6c9e5071156b7b726e7b6d9bf11d31" },
      conversation: { rowCount: 2, sha256: "b2194e47411fdacf8fff8a3113700ab8c338f5bc036aa21c77af290c7859d818" },
      agent: { rowCount: 3, sha256: "96dcd85589b9dcdbaa61541dab952ca7dd1ace25b6b4bd0ed499969728da7f10" },
      message: { rowCount: 14, sha256: "20d1e452f96abdf0b69546ca889eafe2065502f5b85896535de4202d9582d819" },
      tool_call: { rowCount: 2, sha256: "c4f26c211b4d51770344956997fafc8361d560fa79abf05512c0e4265472ef24" },
      pr_link: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      turn_duration: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      api_request: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      logged_api_request: { rowCount: 6, sha256: "78a0c048456e447dc55d7789f87fb3eaf7783712e6ce4b704223dbd7d286288b" },
      // Three system prompts and two tool sets: the Sub-agent shares the Main thread's first one.
      system_prompt: { rowCount: 3, sha256: "078966990d7b9a08dc687e257b9117c3238ca03ce895107c7960303e0f1f5e76" },
      tool_set: { rowCount: 2, sha256: "d0be61d7d9bc03ee986cfd851e9fb1e7630cbb111eb633776564b1df5c3b6a75" },
    });
  });

  it("stores the pinned rows for the recorded logs and their Recording (Turns matched, one failed attempt, one API request unmatched)", async () => {
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "recorded-logs"), logsRoot);
    const recordingsRoot = path.join(tmpDir, "recordings");
    const writer = openRecordingWriter(recordingsRoot);
    // A failed attempt of the first Turn, which its API request retried.
    const firstTurn = recordedApiRequest({ requestId: "rreq-1", messageId: "rmsg-1", agentId: null });
    await writer.append({
      ...firstTurn,
      response: {
        status: 529,
        requestId: "req-overloaded",
        headers: {},
        body: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
        isStreamed: false,
      },
    });
    for (const [requestId, messageId, agentId] of [
      ["rreq-1", "rmsg-1", null],
      ["rreq-3", "rmsg-3", "rsub1"],
      [null, "rmsg-2", null],
      ["req-side", "msg-side", null],
    ] as const) {
      await writer.append(recordedApiRequest({ requestId, messageId, agentId }));
    }
    await refresh({ logsRoot, dbPath, recordingsRoot });

    // The conversation row is left out: its change key folds in the Recording's
    // gzip size, which depends on the zlib build, not on what was recorded.
    const fingerprints: Partial<Record<StoredTable, TableFingerprint>> = fingerprintStoredData(dbPath, logsRoot);
    delete fingerprints.conversation;
    expect(fingerprints).toEqual({
      project: { rowCount: 1, sha256: "ab725077615dfb646309a5ae5611824cd04ea21931ce42ca0228396a8ab86608" },
      agent: { rowCount: 3, sha256: "9572f6c76b690944c11155fcfebcaa3cfb2f7eb6f4011be028e50a3b182a89e2" },
      message: { rowCount: 10, sha256: "f9774d86e70fa26c6aa28df6bb3da601ebf705c6be1046db8e00370b2ce54268" },
      tool_call: { rowCount: 1, sha256: "d3b0ea811a8bceeb37e913ba469534319cacbbcea904a4342deb1fd5cb2cfe73" },
      pr_link: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      turn_duration: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      api_request: { rowCount: 5, sha256: "55de2719545c9d6a2d3231955dd70a0b34e63a19f44c4a7efd8066ed27d879f7" },
      ...NO_LOGGED_API_REQUESTS,
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

  it("stores what a cold Refresh does, even when the change leaves a system prompt and a tool set unused", async () => {
    const logsRoot = path.join(tmpDir, "logs");
    const reparsedDbPath = path.join(tmpDir, "reparsed.db");
    const coldDbPath = path.join(tmpDir, "cold.db");
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "logged-request-logs"), logsRoot);
    await refresh({ logsRoot, dbPath: reparsedDbPath });

    // The last request now sends the first shape: the second one's system prompt and tool set are used by nothing.
    const mainLogPath = path.join(logsRoot, "-Users-me-dev-logged", "sess-logged.jsonl");
    const lines = readFileSync(mainLogPath, "utf8").split("\n");
    writeFileSync(
      mainLogPath,
      lines
        .filter((line) => !line.includes('"shapeHash":"shape-2","shape"'))
        .map((line) => line.replace('"shapeHash":"shape-2"', '"shapeHash":"shape-1"'))
        .join("\n"),
    );
    await refresh({ logsRoot, dbPath: reparsedDbPath });
    await refresh({ logsRoot, dbPath: coldDbPath });

    expect(loggedApiRequestContent(reparsedDbPath, logsRoot)).toEqual(loggedApiRequestContent(coldDbPath, logsRoot));
    expect(loggedApiRequestContent(coldDbPath, logsRoot).system_prompt.rowCount).toBe(2);
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
 * foreign keys, but whether a Turn answered them.
 */
function loggedApiRequestContent(dbPath: string, logsRoot: string) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const requests = db
      .prepare(
        `SELECT "record_id", "base_record_id", "kept_message_count", "tail_message_hashes_json", "parameters_json",
                "cache_breakpoints_json", "query_source", "request_digest", "sent_at", "position_in_file",
                "system_prompt_hash", "tool_set_hash", "message_id" IS NULL AS "isUnanswered"
           FROM "logged_api_request" ORDER BY "record_id"`,
      )
      .all();
    return {
      requests,
      system_prompt: fingerprintTable(db, "system_prompt", logsRoot),
      tool_set: fingerprintTable(db, "tool_set", logsRoot),
    };
  } finally {
    db.close();
  }
}

/** One API request of the `sess-rec-main` session, with fixed timings and the given ids. */
function recordedApiRequest(ids: {
  requestId: string | null;
  messageId: string;
  agentId: string | null;
}): RecordedApiRequest {
  return {
    sessionId: "sess-rec-main",
    agentId: ids.agentId,
    method: "POST",
    path: "/v1/messages",
    query: "",
    headers: {},
    body: { model: "claude-opus-4-8", messages: [] },
    response: {
      status: 200,
      requestId: ids.requestId,
      headers: {},
      body: { id: ids.messageId, type: "message", content: [] },
      isStreamed: true,
    },
    timings: {
      arrivedAt: "2026-10-18T10:00:00.000Z",
      firstByteAt: "2026-10-18T10:00:01.000Z",
      endedAt: "2026-10-18T10:00:02.000Z",
    },
  };
}
