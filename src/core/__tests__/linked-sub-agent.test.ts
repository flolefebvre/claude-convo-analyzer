// A resumed or forked session's `subagents/` holds its parent's Sub-agent
// transcripts as links to the parent's files (log-format §10). The links are
// made here, at run time, in a temp copy of `family-logs/`: a committed
// symlink would break a Windows checkout. `sess-fam-b` resumes `sess-fam-a`,
// and its copy of `agent-fam-helper.jsonl` becomes a link to the parent's.
// Read back through `listConversations` and `getTranscript`, never SQL.

import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getTranscript, listConversations } from "@/core/read";
import { refresh } from "@/core/refresh";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "family-logs");
const FAMILY_DIR = "-Users-me-dev-family";

describe("a Sub-agent transcript linked from a copier's subagents/", () => {
  let tmpDir: string;
  let logsRoot: string;

  /** The `subagents/` directory of `sessionId`, in the temp logs root. */
  const subagentsDir = (sessionId: string) => path.join(logsRoot, FAMILY_DIR, sessionId, "subagents");
  /** Where `sess-fam-b` holds its copy of the parent's `fam-helper` transcript. */
  const copierHelperPath = () => path.join(subagentsDir("sess-fam-b"), "agent-fam-helper.jsonl");

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-linked-sub-agent-"));
    logsRoot = path.join(tmpDir, "logs");
    cpSync(FIXTURES_ROOT, logsRoot, { recursive: true });
    // Neither run below sees the committed regular-file copy.
    rmSync(copierHelperPath());
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** A cold Refresh of the temp logs root into a fresh database named `name`; returns its path and summary. */
  async function refreshInto(name: string) {
    const dbPath = path.join(tmpDir, `${name}.db`);
    const summary = await refresh({ logsRoot, dbPath });
    return { dbPath, summary };
  }

  /** Each Conversation's Cost, by session id. */
  async function costById(dbPath: string): Promise<Record<string, number>> {
    const rows = await listConversations({ dbPath });
    return Object.fromEntries(rows.map((row) => [row.id, row.costUsd]));
  }

  it("stores the linked Agent under the copier, every Message copied from the parent's, with the meta beside the link", async () => {
    symlinkSync(path.join(subagentsDir("sess-fam-a"), "agent-fam-helper.jsonl"), copierHelperPath());
    writeFileSync(path.join(subagentsDir("sess-fam-b"), "agent-fam-helper.meta.json"), '{"agentType":"Explore"}');

    const { dbPath } = await refreshInto("linked");

    const copier = await getTranscript("sess-fam-b", { dbPath, agentId: "fam-helper", page: "all" });
    expect(copier?.tree.children.map((child) => [child.id, child.agentType])).toEqual([["fam-helper", "Explore"]]);
    expect(copier?.messages.map((m) => m.uuid)).toEqual(["fam-helper-u1", "fam-helper-a1"]);
    for (const message of copier?.messages ?? []) {
      expect(message.isCopied).toBe(true);
      expect(message.copiedFrom).toMatchObject({ sessionId: "sess-fam-a", agentId: "fam-helper" });
    }
  });

  it("leaves the parent's rows and both Costs as a run with no link writes them", async () => {
    const withoutLink = await refreshInto("without-link");
    symlinkSync(path.join(subagentsDir("sess-fam-a"), "agent-fam-helper.jsonl"), copierHelperPath());
    const withLink = await refreshInto("with-link");

    const parentHelper = async (dbPath: string) =>
      (await getTranscript("sess-fam-a", { dbPath, agentId: "fam-helper", page: "all" }))?.messages;
    expect(await parentHelper(withLink.dbPath)).toEqual(await parentHelper(withoutLink.dbPath));
    const withLinkCosts = await costById(withLink.dbPath);
    const withoutLinkCosts = await costById(withoutLink.dbPath);
    expect(withLinkCosts["sess-fam-a"]).toBeGreaterThan(0);
    expect(withLinkCosts["sess-fam-a"]).toBe(withoutLinkCosts["sess-fam-a"]);
    expect(withLinkCosts["sess-fam-b"]).toBe(withoutLinkCosts["sess-fam-b"]);
  });

  it("skips a dangling link and one outside the logs root, counting each as vanished when its Conversation is re-parsed", async () => {
    const parentHelperPath = path.join(subagentsDir("sess-fam-a"), "agent-fam-helper.jsonl");
    const outsidePath = path.join(tmpDir, "outside", "agent-fam-helper.jsonl");
    cpSync(parentHelperPath, outsidePath);
    symlinkSync(outsidePath, path.join(subagentsDir("sess-fam-b"), "agent-outside.jsonl"));
    symlinkSync(path.join(subagentsDir("sess-fam-a"), "agent-gone.jsonl"), copierHelperPath());

    const cold = await refreshInto("analyzer");
    const warm = await refresh({ logsRoot, dbPath: cold.dbPath });

    expect(cold.summary.vanishedLogFilesSkipped).toBe(2);
    const copier = await getTranscript("sess-fam-b", { dbPath: cold.dbPath });
    expect(copier?.tree.children).toEqual([]);
    // Nothing changed since, so nothing is re-parsed and nothing counted again.
    expect(warm.conversationsParsed).toBe(0);
    expect(warm.vanishedLogFilesSkipped).toBe(0);
  });
});
