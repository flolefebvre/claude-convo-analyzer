import path from "node:path";
import { describe, expect, it } from "vitest";

import { createPrismaClient } from "@/core/db";
import { refresh } from "@/core/refresh";

import { seededTempDb } from "./helpers/temp-db";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

describe("effort persistence", () => {
  const db = seededTempDb({ prefix: "cca-effort-", logsRoot: FIXTURES_ROOT });

  it("stores each assistant turn's effort, null where the log recorded none", async () => {
    const prisma = createPrismaClient(db.dbPath);
    try {
      const rows = await prisma.message.findMany({
        where: { messageId: { startsWith: "emsg-" } },
        orderBy: { messageId: "asc" },
        select: { messageId: true, effort: true },
      });
      expect(rows.map((r) => [r.messageId, r.effort])).toEqual([
        ["emsg-1", "high"],
        ["emsg-2", "high"],
        ["emsg-3", null],
        ["emsg-4", "xhigh"],
      ]);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("stores effort on a sub-agent's own turns", async () => {
    const prisma = createPrismaClient(db.dbPath);
    try {
      const rows = await prisma.message.findMany({
        where: { messageId: { startsWith: "esmsg-" } },
        orderBy: { messageId: "asc" },
        select: { effort: true },
      });
      expect(rows.map((r) => r.effort)).toEqual(["medium", "medium"]);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("backfills effort into conversations ingested by an older parser", async () => {
    const prisma = createPrismaClient(db.dbPath);
    try {
      await prisma.message.updateMany({ data: { effort: null } });
      await prisma.conversation.updateMany({ data: { parserVersion: 1 } });
    } finally {
      await prisma.$disconnect();
    }

    const result = await refresh({
      logsRoot: FIXTURES_ROOT,
      dbPath: db.dbPath,
    });
    expect(result.conversationsParsed).toBeGreaterThan(0);

    const after = createPrismaClient(db.dbPath);
    try {
      const row = await after.message.findFirst({
        where: { messageId: "emsg-4" },
        select: { effort: true },
      });
      expect(row?.effort).toBe("xhigh");
    } finally {
      await after.$disconnect();
    }
  });

  it("leaves effort null for user prompts", async () => {
    const prisma = createPrismaClient(db.dbPath);
    try {
      const prompt = await prisma.message.findFirst({
        where: { uuid: "eu1" },
        select: { effort: true },
      });
      expect(prompt?.effort).toBeNull();
    } finally {
      await prisma.$disconnect();
    }
  });
});
