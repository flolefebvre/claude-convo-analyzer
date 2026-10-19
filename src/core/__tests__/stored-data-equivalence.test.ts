// Stored data is pinned: a Refresh of each fixture root into a fresh database
// writes exactly these rows — same count, same ids, same column values and
// storage types — in all eight tables. The write path is free to change; what
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
import { cpSync, mkdtempSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openRecordingWriter, type RecordedApiRequest } from "@/core/recording";
import { refresh } from "@/core/refresh";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");

/** The eight tables of ADR-0001, each pinned by its row count and checksum. */
const STORED_TABLES = [
  "project",
  "conversation",
  "agent",
  "message",
  "tool_call",
  "pr_link",
  "turn_duration",
  "api_request",
] as const;

type StoredTable = (typeof STORED_TABLES)[number];

/** One table's fingerprint: how many rows, and a sha256 over all of them. */
type TableFingerprint = { rowCount: number; sha256: string };

/** Every file under the copied logs root gets this mtime (see `copyWithPinnedMtimes`). */
const PINNED_MTIME = new Date("2026-01-01T00:00:00.000Z");

/** The sha256 of no bytes: the fingerprint of a table with no rows. */
const EMPTY_TABLE_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

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
 * Fingerprint one table: rows ordered by `id`, every column through SQLite's
 * `quote()` — which keeps integer, real, text and NULL distinct — one line per
 * row, hashed with sha256. The temp logs root is replaced by a placeholder.
 */
function fingerprintTable(db: Database.Database, table: StoredTable, logsRoot: string): TableFingerprint {
  const columns = (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);
  const quotedColumns = columns.map((column) => `quote("${column}")`).join(", ");
  const rows = db.prepare(`SELECT ${quotedColumns} FROM "${table}" ORDER BY "id"`).raw().all() as string[][];
  const hash = createHash("sha256");
  for (const row of rows) hash.update(`${row.join("\t").replaceAll(logsRoot, LOGS_ROOT_PLACEHOLDER)}\n`);
  return { rowCount: rows.length, sha256: hash.digest("hex") };
}

/** Fingerprint all eight tables of the database at `dbPath`. */
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
      conversation: { rowCount: 21, sha256: "8cb56564b6dd5612551a06666a409cbfcd2dc8a8558e09011c2cc13343a0bbee" },
      agent: { rowCount: 35, sha256: "bcf922290517994e489068e748364ff9de40929e4a8ddfbcb68c6f6014836468" },
      message: { rowCount: 125, sha256: "efde03aefa67065d8cc0e7f5c061c6d75b5d6a3211263c175dee68f0862b48c5" },
      tool_call: { rowCount: 34, sha256: "58586fdaa0ea9e906fd5037c8a3c7809fd2fd1d4602ec6280e34db111716b5f4" },
      pr_link: { rowCount: 1, sha256: "efff4b0f419e7b55d6dc8602b3503e06e81829e6fd868d216679845fa0970d16" },
      turn_duration: { rowCount: 1, sha256: "11a23dd83764e1de631b25b7b2fb8a6b5af397fe1503b2086f0404a57cb943c4" },
      api_request: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
    });
  });

  it("stores the pinned rows for the inter-agent message logs", async () => {
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "agent-message-logs"), logsRoot);
    await refresh({ logsRoot, dbPath });

    expect(fingerprintStoredData(dbPath, logsRoot)).toEqual({
      project: { rowCount: 1, sha256: "5d55ed2d1c37a5a354777b7e27dfce7bb9f299e0e7237d17a32956fee0357675" },
      conversation: { rowCount: 1, sha256: "3f08e6b39c74051ff40336d4b00c171dbb77929d57ee7d7d549174406abf824d" },
      agent: { rowCount: 2, sha256: "9cddce4d56d246718241b05d406551e917f8d9c1d9a116799eb257bc48089a61" },
      message: { rowCount: 28, sha256: "cfdb0c9218cd0184517845f99b348d217ec655bd135e7c723999498fba0260dd" },
      tool_call: { rowCount: 1, sha256: "a7fdb225fda2bff0ca75f88a22789a86cd79a97f5ea4e2f952e1d4559aa8efd9" },
      pr_link: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      turn_duration: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      api_request: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
    });
  });

  it("stores the pinned rows for the Project path logs (worktree switches, cwd-less Conversations)", async () => {
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "project-logs"), logsRoot);
    await refresh({ logsRoot, dbPath });

    expect(fingerprintStoredData(dbPath, logsRoot)).toEqual({
      project: { rowCount: 9, sha256: "e740c951fb2b58e8b13902eea830681396ac5eea03a445a31d6fb998c250a3e1" },
      conversation: { rowCount: 13, sha256: "9cba5a8b42a6e96ba3ac3220e7960bef287bcc554028a3de5395aa77563211ea" },
      agent: { rowCount: 13, sha256: "47aa156cd547f0ad4f24ca8d2f27122dfa765f0de80b37a46a3507b22ade253f" },
      message: { rowCount: 22, sha256: "c939415a25c68bca466283e335cd5a19447d35732c36f53ab3b32e8376a93c77" },
      tool_call: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      pr_link: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      turn_duration: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      api_request: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
    });
  });

  it("stores the pinned rows for the API error logs", async () => {
    copyWithPinnedMtimes(path.join(FIXTURES_DIR, "error-logs"), logsRoot);
    await refresh({ logsRoot, dbPath });

    expect(fingerprintStoredData(dbPath, logsRoot)).toEqual({
      project: { rowCount: 1, sha256: "c39a0134a2be51dcdd6348bf0657691be4b1d4092d6e1616117c4d0f4f58a771" },
      conversation: { rowCount: 4, sha256: "0b6f7ab64704ca2427e2a5a192aeb1cee817f1e3d165a97061dc82cc9feb95f1" },
      agent: { rowCount: 5, sha256: "c0938e2f66085f42e8e7e5ee608867bb0974528d74f6dd4ead50afad13e0e8a1" },
      message: { rowCount: 17, sha256: "897eb312a4eb322388b382eeb8fefdf153a78cd7ef9b579df7438c4b530d01d1" },
      tool_call: { rowCount: 1, sha256: "e331ea30643c19a0602a2759f557187aacaf1729c796a955560799b9c4dbd73f" },
      pr_link: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      turn_duration: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
      api_request: { rowCount: 0, sha256: EMPTY_TABLE_SHA256 },
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
    });
  });
});

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
