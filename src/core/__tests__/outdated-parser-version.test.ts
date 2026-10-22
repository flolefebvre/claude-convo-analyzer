import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createPrismaClient } from "@/core/db";
import {
  countConversationsWithOutdatedParserVersion,
  isStoredDataMissingOrOutdated,
  listConversations,
} from "@/core/read";
import { PARSER_VERSION } from "@/core/refresh";

import { seededTempDb } from "./helpers/temp-db";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

describe("countConversationsWithOutdatedParserVersion", () => {
  const db = seededTempDb({ prefix: "cca-outdated-parser-", logsRoot: FIXTURES_ROOT });

  /** Set the stored parser version of the first `count` Conversations (test setup). */
  async function setParserVersion(count: number, parserVersion: number): Promise<void> {
    const sessionIds = (await listConversations({ dbPath: db.dbPath })).slice(0, count).map((c) => c.id);
    const prisma = createPrismaClient(db.dbPath);
    try {
      await prisma.conversation.updateMany({ where: { sessionId: { in: sessionIds } }, data: { parserVersion } });
    } finally {
      await prisma.$disconnect();
    }
  }

  it("is 0 right after a full Refresh", async () => {
    expect(await countConversationsWithOutdatedParserVersion({ dbPath: db.dbPath })).toBe(0);
  });

  it("counts the Conversations an older parser produced", async () => {
    await setParserVersion(3, PARSER_VERSION - 1);

    expect(await countConversationsWithOutdatedParserVersion({ dbPath: db.dbPath })).toBe(3);
  });

  it("counts a Conversation an interrupted Refresh left unstamped", async () => {
    await setParserVersion(1, 0);

    expect(await countConversationsWithOutdatedParserVersion({ dbPath: db.dbPath })).toBe(1);
  });

  describe("isStoredDataMissingOrOutdated", () => {
    it("is false right after a full Refresh", async () => {
      expect(await isStoredDataMissingOrOutdated({ dbPath: db.dbPath })).toBe(false);
    });

    it("is true when one Conversation an older parser produced is stored", async () => {
      await setParserVersion(1, PARSER_VERSION - 1);

      expect(await isStoredDataMissingOrOutdated({ dbPath: db.dbPath })).toBe(true);
    });

    it("is true when no Conversation is stored", async () => {
      const emptyDir = mkdtempSync(path.join(tmpdir(), "cca-empty-db-"));
      try {
        expect(await isStoredDataMissingOrOutdated({ dbPath: path.join(emptyDir, "analyzer.db") })).toBe(true);
      } finally {
        rmSync(emptyDir, { recursive: true, force: true });
      }
    });
  });
});
