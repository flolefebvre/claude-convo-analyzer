// A Conversation's newest source change (GLOSSARY.md, Active now): the latest
// mtime across its log, its sub-agent transcripts and its Recording, as the
// list, the detail and the Transcript read it.

import { cpSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getConversation, getTranscript, listConversations } from "@/core/read";
import { openRecordingWriter } from "@/core/recording";
import { refresh } from "@/core/refresh";

const FIXTURE_LOGS_ROOT = path.join(import.meta.dirname, "fixtures", "recorded-logs");
const PROJECT_DIR = "-Users-me-dev-recorded";
const SESSION_ID = "sess-rec-main";
const OTHER_SESSION_ID = "sess-rec-other";

const LOG_CHANGED_AT = "2026-10-18T09:00:00.000Z";
const SUB_AGENT_CHANGED_AT = "2026-10-18T09:30:00.000Z";
const RECORDING_CHANGED_AT = "2026-10-18T10:00:00.000Z";
const OTHER_CHANGED_AT = "2026-10-17T08:00:00.000Z";

let tmpDir: string;
let logsRoot: string;
let recordingsRoot: string;
let dbPath: string;

/** Set `filePath`'s mtime to `iso`. */
function changedAt(filePath: string, iso: string): void {
  const at = new Date(iso);
  utimesSync(filePath, at, at);
}

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "cca-source-change-"));
  logsRoot = path.join(tmpDir, "projects");
  recordingsRoot = path.join(tmpDir, "recordings");
  dbPath = path.join(tmpDir, "analyzer.db");
  cpSync(FIXTURE_LOGS_ROOT, logsRoot, { recursive: true });
  const projectDir = path.join(logsRoot, PROJECT_DIR);
  changedAt(path.join(projectDir, `${SESSION_ID}.jsonl`), LOG_CHANGED_AT);
  changedAt(path.join(projectDir, SESSION_ID, "subagents", "agent-rsub1.jsonl"), SUB_AGENT_CHANGED_AT);
  changedAt(path.join(projectDir, `${OTHER_SESSION_ID}.jsonl`), OTHER_CHANGED_AT);
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Where each read says `sessionId`'s newest source change was. */
async function sourceChangedAtOf(sessionId: string) {
  const row = (await listConversations({ dbPath })).find((conversation) => conversation.id === sessionId);
  return {
    list: row?.sourceChangedAt,
    detail: (await getConversation(sessionId, { dbPath }))?.sourceChangedAt,
    transcript: (await getTranscript(sessionId, { dbPath }))?.sourceChangedAt,
  };
}

describe("a Conversation's newest source change", () => {
  it("is its log's mtime when it has nothing else", async () => {
    await refresh({ logsRoot, dbPath, recordingsRoot });

    expect(await sourceChangedAtOf(OTHER_SESSION_ID)).toEqual({
      list: OTHER_CHANGED_AT,
      detail: OTHER_CHANGED_AT,
      transcript: OTHER_CHANGED_AT,
    });
  });

  it("is a sub-agent transcript's mtime when that changed after the log", async () => {
    await refresh({ logsRoot, dbPath, recordingsRoot });

    expect(await sourceChangedAtOf(SESSION_ID)).toEqual({
      list: SUB_AGENT_CHANGED_AT,
      detail: SUB_AGENT_CHANGED_AT,
      transcript: SUB_AGENT_CHANGED_AT,
    });
  });

  it("is its Recording's mtime when that changed last", async () => {
    await openRecordingWriter(recordingsRoot).append({
      sessionId: SESSION_ID,
      agentId: null,
      method: "POST",
      path: "/v1/messages",
      query: "",
      headers: {},
      body: null,
      response: { status: 200, requestId: null, headers: {}, body: null, isStreamed: false },
      timings: { arrivedAt: RECORDING_CHANGED_AT, firstByteAt: RECORDING_CHANGED_AT, endedAt: RECORDING_CHANGED_AT },
    });
    changedAt(path.join(recordingsRoot, `${SESSION_ID}.jsonl.gz`), RECORDING_CHANGED_AT);
    await refresh({ logsRoot, dbPath, recordingsRoot });

    expect(await sourceChangedAtOf(SESSION_ID)).toEqual({
      list: RECORDING_CHANGED_AT,
      detail: RECORDING_CHANGED_AT,
      transcript: RECORDING_CHANGED_AT,
    });
  });
});
