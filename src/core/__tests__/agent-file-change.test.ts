// A Refresh after one Agent's log file changed re-parses and rewrites that
// file, not its whole Conversation (ADR-0010) — and stores, table for table,
// what a cold Refresh of the same files stores.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { refresh } from "@/core/refresh";

const FIXTURES_ROOT = path.join(import.meta.dirname, "fixtures", "logs");

/** The tables a Refresh writes, each with its foreign-key columns and the table each names. */
const FOREIGN_KEYS_BY_TABLE = {
  project: {},
  conversation: { project_id: "project", continued_from_conversation_id: "conversation" },
  agent: { conversation_id: "conversation", parent_agent_id: "agent", spawned_by_message_id: "message" },
  message: {
    conversation_id: "conversation",
    agent_id: "agent",
    api_request_id: "api_request",
    copied_from_message_id: "message",
  },
  tool_call: { message_id: "message", agent_id: "agent" },
  pr_link: { conversation_id: "conversation" },
  turn_duration: { conversation_id: "conversation" },
  api_request: { conversation_id: "conversation", agent_id: "agent", failed_attempt_of_message_id: "message" },
  turn: { message_id: "message", agent_id: "agent", conversation_id: "conversation" },
} as const;

/** The interned tables: keyed by their hash, which is already natural. */
const INTERNED_TABLES = ["system_prompt", "tool_set", "sent_message"] as const;

type Row = Record<string, unknown>;

/**
 * Every row a Refresh stored in the database at `dbPath`, whatever row ids it
 * gave: each id, and each foreign key, replaced by the natural key of its row —
 * a Project's path, a Conversation's session id, an Agent's session and
 * external id, a Message's Agent and place in it, an API request's Agent and
 * place in its file — and each table's rows sorted.
 */
function storedContent(dbPath: string): Record<string, Row[]> {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rowsByTable = new Map<string, Row[]>();
    for (const table of Object.keys(FOREIGN_KEYS_BY_TABLE)) {
      rowsByTable.set(table, db.prepare(`SELECT * FROM "${table}" ORDER BY "id"`).all() as Row[]);
    }
    const naturalKeyByIdByTable = new Map<string, Map<unknown, string>>();
    const keyBy = (table: string, naturalKeyOf: (row: Row, index: number) => string) =>
      naturalKeyByIdByTable.set(
        table,
        new Map(rowsByTable.get(table)!.map((row, i) => [row.id, naturalKeyOf(row, i)])),
      );
    const keyOf = (table: string, id: unknown) => (id === null ? null : naturalKeyByIdByTable.get(table)!.get(id)!);
    keyBy("project", (row) => String(row.path));
    keyBy("conversation", (row) => String(row.session_id));
    keyBy(
      "agent",
      (row) => `${keyOf("conversation", row.conversation_id)}/${String(row.external_agent_id ?? "<main>")}`,
    );
    /** Row ids are given in file order within one Agent: its rows' rank is their place in it. */
    const rankWithin = (groupOf: (row: Row) => string) => {
      const countByGroup = new Map<string, number>();
      return (row: Row) => {
        const group = groupOf(row);
        const rank = countByGroup.get(group) ?? 0;
        countByGroup.set(group, rank + 1);
        return `${group}#${rank}`;
      };
    };
    keyBy(
      "message",
      rankWithin((row) => keyOf("agent", row.agent_id)!),
    );
    keyBy("api_request", (row) => `${keyOf("agent", row.agent_id)}@${String(row.position_in_file)}`);
    for (const table of ["tool_call", "pr_link", "turn_duration", "turn"]) keyBy(table, () => "");

    const content: Record<string, Row[]> = {};
    for (const [table, foreignKeys] of Object.entries(FOREIGN_KEYS_BY_TABLE)) {
      content[table] = rowsByTable
        .get(table)!
        .map((row) => {
          const { id, ...columns } = row;
          const naturalRow: Row = { key: keyOf(table, id), ...columns };
          for (const [column, namedTable] of Object.entries(foreignKeys)) {
            naturalRow[column] = keyOf(namedTable, row[column]);
          }
          return naturalRow;
        })
        .sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    }
    for (const table of INTERNED_TABLES) {
      content[table] = db.prepare(`SELECT * FROM "${table}" ORDER BY "hash"`).all() as Row[];
    }
    return content;
  } finally {
    db.close();
  }
}

const NESTED_LOG_FOLDER = "-Users-me-dev-nested";

/** An assistant line of Sub-agent `agentId`, one more Turn of its own. */
function subAgentTurnLine(agentId: string, uuid: string): string {
  return JSON.stringify({
    type: "assistant",
    uuid,
    isSidechain: true,
    agentId,
    requestId: `${uuid}-req`,
    timestamp: "2026-06-20T07:03:00.000Z",
    cwd: "/Users/me/dev/nested",
    version: "2.1.180",
    message: {
      id: `${uuid}-msg`,
      role: "assistant",
      model: "claude-haiku-4-5-20251001",
      content: [{ type: "text", text: "one more" }],
      usage: { input_tokens: 1, output_tokens: 4, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  });
}

describe("a Refresh after an Agent's log file changed", () => {
  let tmpDir: string;
  let logsRoot: string;
  let dbPath: string;

  /** The log file of the `sess-nested` Agent `agentId`: its Main thread for `main`. */
  const nestedLogPath = (agentId: string) =>
    agentId === "main"
      ? path.join(logsRoot, NESTED_LOG_FOLDER, "sess-nested.jsonl")
      : path.join(logsRoot, NESTED_LOG_FOLDER, "sess-nested", "subagents", `agent-${agentId}.jsonl`);
  const linesOf = (agentId: string) => readFileSync(nestedLogPath(agentId), "utf8").split("\n").filter(Boolean);
  const writeLines = (agentId: string, lines: string[]) =>
    writeFileSync(nestedLogPath(agentId), `${lines.join("\n")}\n`);
  const appendLine = (agentId: string, line: string) => writeLines(agentId, [...linesOf(agentId), line]);

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "cca-agent-file-change-"));
    logsRoot = path.join(tmpDir, "logs");
    dbPath = path.join(tmpDir, "incremental.db");
    cpSync(FIXTURES_ROOT, logsRoot, { recursive: true });
    // subc's spawn names a model other than the one subc's own Turns use, so
    // a resolved model taken from the spawn and one taken from the Turns differ.
    writeLines(
      "subb",
      linesOf("subb").map((line) =>
        line.replace(
          '"agentType":"general-purpose","resolvedModel":"claude-haiku-4-5-20251001"',
          '"agentType":"general-purpose","resolvedModel":"claude-sonnet-4-6"',
        ),
      ),
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** Refresh the logs root into the incremental database, apply `change`, Refresh it again, and return that summary. */
  async function refreshAfter(change: () => void) {
    await refresh({ logsRoot, dbPath });
    change();
    return refresh({ logsRoot, dbPath });
  }

  /** What a cold Refresh of the logs root, as it is now, stores. */
  async function coldContent() {
    const coldDbPath = path.join(tmpDir, "cold.db");
    await refresh({ logsRoot, dbPath: coldDbPath });
    return storedContent(coldDbPath);
  }

  /** The stored `sess-nested` Agent `agentId`, its parent and spawn by natural key. */
  const nestedAgent = (content: Record<string, Row[]>, agentId: string) =>
    content.agent!.find((agent) => agent.key === `sess-nested/${agentId}`);

  it("parses the Main thread alone when only it grew, and stores what a cold Refresh does", async () => {
    const summary = await refreshAfter(() =>
      appendLine(
        "main",
        '{"type":"user","uuid":"nu3","timestamp":"2026-06-20T07:05:00.000Z","cwd":"/Users/me/dev/nested","version":"2.1.180","message":{"role":"user","content":"one more"}}',
      ),
    );

    expect(summary.conversationsParsed).toBe(1);
    expect(summary.logFilesParsed).toBe(1);
    expect(storedContent(dbPath)).toEqual(await coldContent());
  });

  it("parses a grown Sub-agent with the Main thread and its parent, and stores what a cold Refresh does", async () => {
    const summary = await refreshAfter(() => appendLine("subc", subAgentTurnLine("subc", "ca9")));

    // The Main thread, subc, and subb whose ledger names it.
    expect(summary.logFilesParsed).toBe(3);
    expect(storedContent(dbPath)).toEqual(await coldContent());
  });

  it("stores a new Sub-agent as a cold Refresh does", async () => {
    const summary = await refreshAfter(() =>
      writeFileSync(nestedLogPath("subd"), `${subAgentTurnLine("subd", "da1")}\n`),
    );

    expect(summary.logFilesParsed).toBe(2);
    expect(storedContent(dbPath)).toEqual(await coldContent());
  });

  it.each([
    // subb loses the line naming subc, and what follows.
    ["shortened", () => writeLines("subb", linesOf("subb").slice(0, 2))],
    ["removed", () => rmSync(nestedLogPath("subb"))],
  ])("stores what a cold Refresh does when a parent's file is %s under a kept child", async (_, change) => {
    await refreshAfter(change);

    // subc is no longer anyone's spawn: its own Turns' model, not the lost spawn's.
    const cold = await coldContent();
    expect(nestedAgent(cold, "subc")).toMatchObject({
      parent_agent_id: "sess-nested/<main>",
      agent_type: null,
      resolved_model: "claude-haiku-4-5-20251001",
    });
    expect(storedContent(dbPath)).toEqual(cold);
  });

  it("rewrites a grown parent Sub-agent without parsing its kept child, and stores what a cold Refresh does", async () => {
    const summary = await refreshAfter(() => appendLine("subb", subAgentTurnLine("subb", "ba9")));

    // The Main thread, subb, and suba whose ledger names it: not subc.
    expect(summary.logFilesParsed).toBe(3);
    const cold = await coldContent();
    expect(nestedAgent(cold, "subc")).toMatchObject({
      parent_agent_id: "sess-nested/subb",
      resolved_model: "claude-sonnet-4-6",
    });
    expect(storedContent(dbPath)).toEqual(cold);
  });

  it("attaches a child to its parent once the parent logs the spawn after the child's file is complete", async () => {
    const completeSubb = linesOf("subb");
    // First seen before subb logged subc's result: subc is no one's spawn yet.
    writeLines("subb", completeSubb.slice(0, 2));

    const summary = await refreshAfter(() => writeLines("subb", completeSubb));

    expect(summary.logFilesParsed).toBe(3);
    const cold = await coldContent();
    expect(nestedAgent(cold, "subc")).toMatchObject({
      parent_agent_id: "sess-nested/subb",
      agent_type: "general-purpose",
    });
    expect(storedContent(dbPath)).toEqual(cold);
  });
});
