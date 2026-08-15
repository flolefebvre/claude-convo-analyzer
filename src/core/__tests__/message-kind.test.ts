import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createPrismaClient } from "@/core/db";
import { refresh } from "@/core/refresh";

import { dropSearchIndex } from "./helpers/search-index";
import { applyPendingMigrations, seededTempDb } from "./helpers/temp-db";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

describe("message.kind persisted through refresh", () => {
  const db = seededTempDb({ prefix: "cca-kind-", logsRoot: FIXTURES_ROOT });

  it("writes kind for each user record and null for assistant turns", async () => {
    const prisma = createPrismaClient(db.dbPath);
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

      expect(byUuid.get("tu1")).toBe("prompt");
      expect(byUuid.get("tu2")).toBe("tool-result");
      expect(byUuid.get("tu3")).toBe("meta");
      expect(byUuid.get("ta1")).toBeNull();
      expect(byUuid.get("ta2")).toBeNull();

      const apiErr = rows.find((r) => r.uuid === "ta2");
      expect(apiErr).toBeDefined();
    } finally {
      await prisma.$disconnect();
    }
  });

  it("forces a full re-parse of existing conversations on upgrade (backfills kind)", async () => {
    const dbPath = db.dbPath;
    const KIND_MIGRATION = "20260621040000_message_kind";
    let raw = new Database(dbPath);
    raw.prepare("DELETE FROM _cca_migrations WHERE migration_name = ?").run(KIND_MIGRATION);
    dropSearchIndex(raw);
    raw.exec('ALTER TABLE "message" DROP COLUMN "kind"');
    const before = raw
      .prepare("SELECT source_mtime AS m FROM conversation WHERE session_id = 'sess-transcript'")
      .get() as { m: bigint | number };
    expect(Number(before.m)).toBeGreaterThan(0);
    raw.close();

    await applyPendingMigrations(dbPath);

    raw = new Database(dbPath);
    const stamped = raw.prepare("SELECT source_mtime AS m FROM conversation").all() as { m: bigint | number }[];
    expect(stamped.every((r) => Number(r.m) === -1)).toBe(true);
    raw.close();

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
