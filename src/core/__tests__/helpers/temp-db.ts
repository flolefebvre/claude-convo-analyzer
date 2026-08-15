import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";

import { createPrismaClient } from "@/core/db";
import { refresh } from "@/core/refresh";

export type TempDb = {
  readonly dbPath: string;
};

export function seededTempDb(opts: { prefix: string; logsRoot: string }): TempDb {
  let tmpDir = "";
  let dbPath = "";

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), opts.prefix));
    dbPath = path.join(tmpDir, "analyzer.db");
    await refresh({ logsRoot: opts.logsRoot, dbPath });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  return {
    get dbPath() {
      return dbPath;
    },
  };
}

export async function applyPendingMigrations(dbPath: string): Promise<void> {
  const prisma = createPrismaClient(dbPath);
  await prisma.$disconnect();
}
