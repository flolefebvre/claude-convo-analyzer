import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/core/db";
import { refresh } from "@/core/refresh";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

describe("message.kind persisted through refresh", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-kind-"));
    dbPath = path.join(tmpDir, "analyzer.db");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes kind for each user record and null for assistant turns", async () => {
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath });
    const prisma = createPrismaClient(dbPath);
    try {
      const convo = await prisma.conversation.findUnique({
        where: { sessionId: "sess-transcript" },
      });
      expect(convo).not.toBeNull();
      if (!convo) return;

      const rows = await prisma.message.findMany({
        where: { conversationId: convo.id },
        select: { uuid: true, role: true, kind: true },
        orderBy: { timestamp: "asc" },
      });
      const byUuid = new Map(rows.map((r) => [r.uuid, r.kind]));

      // Genuine human prompt → prompt.
      expect(byUuid.get("tu1")).toBe("prompt");
      // tool_result carrier → tool-result.
      expect(byUuid.get("tu2")).toBe("tool-result");
      // isMeta machine-injected record → meta.
      expect(byUuid.get("tu3")).toBe("meta");
      // Assistant turns carry no kind.
      expect(byUuid.get("ta1")).toBeNull();
      expect(byUuid.get("ta2")).toBeNull();

      // The API-error assistant turn is preserved for the transcript's error state.
      const apiErr = rows.find((r) => r.uuid === "ta2");
      expect(apiErr).toBeDefined();
    } finally {
      await prisma.$disconnect();
    }
  });

  it("forces a full re-parse of existing conversations on upgrade (backfills kind)", async () => {
    // A pre-`kind` database: conversations already ingested at their real
    // source_mtime, messages without a kind column.
    const first = createPrismaClient(dbPath);
    await refresh({ logsRoot: FIXTURES_ROOT, dbPath });
    await first.$disconnect();

    const KIND_MIGRATION = "20260621040000_message_kind";
    let db = new Database(dbPath);
    // Undo the message_kind migration so re-opening re-applies it (mirrors the
    // idempotency test's drop-and-re-run pattern for a directly observable effect).
    db.prepare("DELETE FROM _cca_migrations WHERE migration_name = ?").run(
      KIND_MIGRATION,
    );
    db.exec('ALTER TABLE "message" DROP COLUMN "kind"');
    const before = db
      .prepare("SELECT source_mtime AS m FROM conversation WHERE session_id = 'sess-transcript'")
      .get() as { m: bigint | number };
    expect(Number(before.m)).toBeGreaterThan(0); // a real stored mtime, not the sentinel
    db.close();

    // Re-open: applyMigrations re-runs message_kind → re-adds the column AND
    // stamps every conversation's source_mtime to the -1 sentinel.
    const second = createPrismaClient(dbPath);
    await second.$disconnect();

    db = new Database(dbPath);
    const stamped = db
      .prepare("SELECT source_mtime AS m FROM conversation")
      .all() as { m: bigint | number }[];
    expect(stamped.every((r) => Number(r.m) === -1)).toBe(true);
    db.close();

    // The sentinel can never equal the file's real key, so refresh RE-PARSES
    // (does not skip) and backfills kind.
    const summary = await refresh({ logsRoot: FIXTURES_ROOT, dbPath });
    expect(summary.conversationsParsed).toBeGreaterThanOrEqual(1);

    const prisma = createPrismaClient(dbPath);
    try {
      const meta = await prisma.message.findFirst({ where: { uuid: "tu3" } });
      expect(meta?.kind).toBe("meta");
    } finally {
      await prisma.$disconnect();
    }
  });
});
