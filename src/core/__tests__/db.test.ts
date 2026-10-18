import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient } from "@/core/db";
import type { PrismaClient } from "@/core/prisma/generated/client";

/** The seven domain tables defined by ADR-0001. */
const EXPECTED_TABLES = [
  "project",
  "conversation",
  "agent",
  "message",
  "tool_call",
  "pr_link",
  "turn_duration",
] as const;

describe("core persistence foundation", () => {
  let tmpDir: string;
  let dbPath: string;
  let prisma: PrismaClient;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-test-"));
    dbPath = path.join(tmpDir, "analyzer.db");
    prisma = createPrismaClient(dbPath);
  });

  afterEach(async () => {
    await prisma.$disconnect();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates a fresh database with the seven ADR-0001 tables", async () => {
    const rows = await prisma.$queryRawUnsafe<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    );
    const tableNames = new Set(rows.map((r) => r.name));
    for (const table of EXPECTED_TABLES) {
      expect(tableNames.has(table)).toBe(true);
    }
  });

  it("round-trips a project row through the typed client", async () => {
    const created = await prisma.project.create({
      data: { path: "/Users/me/dev/demo" },
    });

    const found = await prisma.project.findUnique({
      where: { id: created.id },
    });

    expect(found).not.toBeNull();
    expect(found?.path).toBe("/Users/me/dev/demo");
  });

  it("runs a fresh database in WAL mode, and keeps it in WAL mode when re-opened", async () => {
    expect(await journalMode(prisma)).toBe("wal");
    await prisma.$disconnect();

    prisma = createPrismaClient(dbPath);
    expect(await journalMode(prisma)).toBe("wal");
  });
});

/** The journal mode the client's connection reports (lower-case, e.g. `wal`). */
async function journalMode(prisma: PrismaClient): Promise<string | undefined> {
  const rows = await prisma.$queryRawUnsafe<{ journal_mode: string }[]>("PRAGMA journal_mode");
  return rows[0]?.journal_mode;
}
