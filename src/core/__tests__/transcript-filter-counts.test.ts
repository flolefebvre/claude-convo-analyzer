// What the Transcript filter (GLOSSARY.md) counts for each kind it can hide:
// figures of the selected Agent's whole Transcript, never of one page.

import path from "node:path";
import { describe, expect, it } from "vitest";

import { getTranscript, type TranscriptMessage } from "@/core/read";

import { seededTempDb } from "./helpers/temp-db";

const FIXTURES = path.join(import.meta.dirname, "fixtures");

describe("the Transcript filter's counts", () => {
  describe("Thinking", () => {
    const db = seededTempDb({ prefix: "cca-filter-thinking-", logsRoot: path.join(FIXTURES, "thinking-logs") });

    it("counts the Turns that thought, with a summary or only a duration", async () => {
      const view = await getTranscript("sess-thinking", { dbPath: db.dbPath, page: "all" });
      const turnsThatThought = view!.messages.filter(
        (m) => m.role === "assistant" && (m.thinkingText !== null || m.thinkingDurationMs !== null),
      );

      expect(turnsThatThought.length).toBeGreaterThan(0);
      expect(view?.turnWithThinkingCount).toBe(turnsThatThought.length);
    });

    it("counts across every Transcript page, not the one shown", async () => {
      const whole = await getTranscript("sess-thinking", { dbPath: db.dbPath, page: "all" });
      const firstPage = await getTranscript("sess-thinking", { dbPath: db.dbPath, pageSize: 1 });

      expect(firstPage?.turnWithThinkingCount).toBe(whole?.turnWithThinkingCount);
    });
  });

  describe("What was sent", () => {
    const db = seededTempDb({
      prefix: "cca-filter-what-was-sent-",
      logsRoot: path.join(FIXTURES, "resumed-request-logs"),
    });

    it("counts the Turns whose own API request the logs hold", async () => {
      const view = await getTranscript("sess-resumed-copy", { dbPath: db.dbPath });
      const ownTurnsNamingARequest = view!.messages.filter(
        (m) => m.role === "assistant" && !m.isCopied && m.apiRequestId !== null,
      );

      expect(ownTurnsNamingARequest).toHaveLength(1);
      expect(view?.turnWithWhatWasSentCount).toBe(1);
    });

    it("does not count a copied Turn, though it names its owner's API request", async () => {
      const view = await getTranscript("sess-resumed-child", { dbPath: db.dbPath });
      const copiedTurnsNamingARequest = view!.messages.filter(
        (m: TranscriptMessage) => m.role === "assistant" && m.isCopied && m.apiRequestId !== null,
      );

      expect(copiedTurnsNamingARequest).toHaveLength(2);
      expect(view?.turnWithWhatWasSentCount).toBe(1);
    });
  });

  describe("Inter-agent messages and Task notifications", () => {
    const db = seededTempDb({
      prefix: "cca-filter-agent-messages-",
      logsRoot: path.join(FIXTURES, "agent-message-logs"),
    });

    it("counts the Messages of each kind addressed to the Agent", async () => {
      const view = await getTranscript("sess-agents", { dbPath: db.dbPath, page: "all" });
      const countOf = (kind: string) => view!.messages.filter((m) => m.kind === kind).length;

      expect(countOf("inter-agent")).toBeGreaterThan(0);
      expect(countOf("task-notification")).toBeGreaterThan(0);
      expect(view?.interAgentMessageCount).toBe(countOf("inter-agent"));
      expect(view?.taskNotificationCount).toBe(countOf("task-notification"));
    });
  });
});
