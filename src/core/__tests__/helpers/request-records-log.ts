// A Main-thread log written from the API requests it should record (Claude
// Code 2.1.300+, docs/conversation-log-format.md §9), for the cases a fixture
// file would need one variant each of: what the system prompt, the tools, the
// parameters and the messages were, request by request.
//
// Not a test file: it declares no tests and lives under `__tests__/helpers/`,
// which vitest's `include` excludes (see `vitest.config.ts`).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { sentMessageHash } from "@/core/canonical-json";

/** A message as an API request sends it; `content` may be a string, blocks, or missing. */
export type RequestRecordMessage = { role: string; content?: unknown };

/** One API request a written log records, which a Turn of the log answers. */
export type RecordedRequest = {
  /** The system prompt: its blocks, or one string. */
  system: unknown;
  tools: unknown[];
  /** Every message it sends, in order. */
  messages: RequestRecordMessage[];
  /** `params`: the body fields but `system`, `tools` and `messages`; `model` and `max_tokens` by default. */
  parameters?: Record<string, unknown>;
  /** `cacheControl`: where its `cache_control` markers go; none by default. */
  cacheBreakpoints?: { path: unknown[]; value: unknown }[];
  /** Null for a record that logs no `timestamp`; by default, its Turn's. */
  sentAt?: null;
};

/** The Project path of every log {@link writeRequestRecordsLog} writes. */
const PROJECT_PATH = "/Users/me/dev/sent";

/** The `params` of a request that names none. */
const DEFAULT_PARAMETERS = { model: "claude-opus-4-8", max_tokens: 32000 };

/**
 * Write the log of Conversation `sessionId` under `logsRoot`: for each of
 * `requests`, in order, its shape when new, a blob of each of its messages, its
 * `api-request` record — its tail every message it sends, so it stands on its
 * own — and the Turn answering it, one minute after the previous one.
 *
 * @example
 * writeRequestRecordsLog(logsRoot, "sess-sent", [{ system: "Answer briefly.", tools: [], messages: [prompt] }]);
 */
export function writeRequestRecordsLog(logsRoot: string, sessionId: string, requests: RecordedRequest[]): void {
  const lines: string[] = [];
  const shapeHashByJson = new Map<string, string>();
  requests.forEach((request, index) => {
    const timestamp = new Date(Date.UTC(2026, 9, 21, 10, index)).toISOString();
    const shapeJson = JSON.stringify({ system: request.system, tools: request.tools });
    let shapeHash = shapeHashByJson.get(shapeJson);
    if (shapeHash === undefined) {
      shapeHash = `shape-${shapeHashByJson.size + 1}`;
      shapeHashByJson.set(shapeJson, shapeHash);
      lines.push(JSON.stringify({ type: "api-request-shape", sessionId, shapeHash, shape: JSON.parse(shapeJson) }));
    }
    for (const message of request.messages) {
      lines.push(JSON.stringify({ type: "api-request-blob", sessionId, hash: sentMessageHash(message), message }));
    }
    const recordId = `req-${index + 1}`;
    lines.push(
      JSON.stringify({
        type: "api-request",
        sessionId,
        id: recordId,
        keep: 0,
        tail: request.messages.map(sentMessageHash),
        shapeHash,
        params: request.parameters ?? DEFAULT_PARAMETERS,
        cacheControl: request.cacheBreakpoints ?? [],
        querySource: "repl_main_thread",
        requestDigest: `digest-${index + 1}`,
        ...(request.sentAt === null ? {} : { timestamp }),
      }),
    );
    lines.push(
      JSON.stringify({
        type: "assistant",
        uuid: `turn-${index + 1}`,
        requestRef: recordId,
        timestamp,
        cwd: PROJECT_PATH,
        version: "2.1.305",
        sessionId,
        message: {
          id: `msg-${index + 1}`,
          role: "assistant",
          model: "claude-opus-4-8",
          content: [{ type: "text", text: `Answer ${index + 1}.` }],
          usage: { input_tokens: 10, output_tokens: 20 },
        },
      }),
    );
  });
  const logFolder = path.join(logsRoot, "-Users-me-dev-sent");
  mkdirSync(logFolder, { recursive: true });
  writeFileSync(path.join(logFolder, `${sessionId}.jsonl`), `${lines.join("\n")}\n`);
}
