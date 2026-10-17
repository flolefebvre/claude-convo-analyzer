// The agent-messages fixture (`fixtures/agent-message-logs/`), parsed once per
// test file: one conversation whose main session and sub-agent carry every
// shape of Inter-agent message, Task notification and mid-turn delivery seen in
// real logs, each record addressable by its `uuid`.
//
// Not a test file: it declares no tests and lives under `__tests__/helpers/`,
// which vitest's `include` excludes (see `vitest.config.ts`).

import { readFileSync } from "node:fs";
import path from "node:path";

import { type ParsedMessage, type ParsedSession, parseSessionLines } from "@/core/parse";

/** Logs root holding the agent-messages fixture conversation (`sess-agents`). */
export const AGENT_MESSAGE_LOGS = path.join(import.meta.dirname, "..", "fixtures", "agent-message-logs");

const SESSION_DIR = path.join(AGENT_MESSAGE_LOGS, "-Users-me-dev-agents");

/** Parse one fixture file through the public parser. */
function parseFixture(file: string): ParsedSession {
  return parseSessionLines(readFileSync(path.join(SESSION_DIR, file), "utf8").split("\n"));
}

/** The parsed main session (`sess-agents.jsonl`). */
export const mainSession = (): ParsedSession => parseFixture("sess-agents.jsonl");

/** The parsed sub-agent transcript (`agent-a1f00d.jsonl`). */
export const subAgentSession = (): ParsedSession =>
  parseFixture(path.join("sess-agents", "subagents", "agent-a1f00d.jsonl"));

/** Parse a single inline record, for the one-off variants the fixture leaves out. */
export function parseLine(record: Record<string, unknown>): ParsedSession {
  return parseSessionLines([JSON.stringify(record)]);
}

/** The parsed message carrying `uuid`; fails the test when it is missing. */
export function messageByUuid(session: ParsedSession, uuid: string): ParsedMessage {
  const found = session.messages.find((m) => m.uuid === uuid);
  if (found === undefined) throw new Error(`no parsed message with uuid ${uuid}`);
  return found;
}
