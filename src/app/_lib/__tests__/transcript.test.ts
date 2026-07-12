import { describe, expect, it } from "vitest";

import type { TranscriptAgentNode, TranscriptToolCall } from "@/core/read";

import {
  RESULT_TRUNCATE_CHARS,
  agentLineage,
  classifyToolCall,
  findSpawnedNode,
  parseSlashCommand,
  toolCallSnippet,
  truncationNote,
} from "@/app/_lib/transcript";

/** Build a minimal tool call; only `name`/`inputJson` matter for most helpers. */
function call(partial: Partial<TranscriptToolCall> = {}): TranscriptToolCall {
  return {
    toolUseId: "tu_1",
    name: "Bash",
    inputJson: "{}",
    resultText: null,
    resultTruncated: false,
    resultCharSize: null,
    isError: false,
    ...partial,
  };
}

describe("classifyToolCall", () => {
  it("classifies the Agent spawn tool as an agent", () => {
    expect(classifyToolCall({ name: "Agent" })).toBe("agent");
  });

  it("classifies the Skill tool as a skill", () => {
    expect(classifyToolCall({ name: "Skill" })).toBe("skill");
  });

  it("classifies any other tool name as a plain tool", () => {
    expect(classifyToolCall({ name: "Bash" })).toBe("tool");
    expect(classifyToolCall({ name: "Read" })).toBe("tool");
    expect(classifyToolCall({ name: "unknown" })).toBe("tool");
  });
});

describe("toolCallSnippet", () => {
  it("pulls the command for a Bash call", () => {
    expect(
      toolCallSnippet(
        call({ name: "Bash", inputJson: '{"command":"pnpm test"}' }),
      ),
    ).toBe("pnpm test");
  });

  it("pulls the skill (and args) for a Skill call", () => {
    expect(
      toolCallSnippet(
        call({
          name: "Skill",
          inputJson: '{"skill":"tdd","args":"getTranscript reader"}',
        }),
      ),
    ).toBe("tdd getTranscript reader");
  });

  it("combines subagent type and prompt for an Agent call", () => {
    expect(
      toolCallSnippet(
        call({
          name: "Agent",
          inputJson:
            '{"subagent_type":"Explore","prompt":"scan the core readers"}',
        }),
      ),
    ).toBe("Explore: scan the core readers");
  });

  it("falls back to the first string field for a generic tool (Read)", () => {
    expect(
      toolCallSnippet(
        call({
          name: "Read",
          inputJson: '{"file_path":"src/core/read.ts"}',
        }),
      ),
    ).toBe("src/core/read.ts");
  });

  it("returns a safe empty fallback for malformed or empty JSON (never throws)", () => {
    expect(toolCallSnippet(call({ name: "Bash", inputJson: "not json" }))).toBe(
      "",
    );
    expect(toolCallSnippet(call({ name: "Bash", inputJson: "" }))).toBe("");
    expect(toolCallSnippet(call({ name: "Read", inputJson: "{}" }))).toBe("");
  });

  it("collapses a multi-line value to one line and truncates long ones", () => {
    const long = "x".repeat(400);
    const out = toolCallSnippet(
      call({ name: "Bash", inputJson: JSON.stringify({ command: long }) }),
    );
    expect(out.length).toBeLessThan(long.length);
    expect(out.endsWith("…")).toBe(true);

    const multi = toolCallSnippet(
      call({
        name: "Bash",
        inputJson: JSON.stringify({ command: "line one\nline two" }),
      }),
    );
    expect(multi).toBe("line one line two");
  });
});

describe("truncationNote", () => {
  it("returns null when the result was not truncated", () => {
    expect(
      truncationNote(call({ resultTruncated: false, resultCharSize: 42 })),
    ).toBeNull();
  });

  it("states the full char count and the stored limit when truncated", () => {
    const note = truncationNote(
      call({ resultTruncated: true, resultCharSize: 12_619 }),
    );
    expect(note).toContain("12,619");
    expect(note).toContain("10,000");
  });

  it("still notes the stored limit when the full size is unknown", () => {
    const note = truncationNote(
      call({ resultTruncated: true, resultCharSize: null }),
    );
    expect(note).not.toBeNull();
    expect(note).toContain("10,000");
  });

  it("exposes the app-side stored-limit constant", () => {
    expect(RESULT_TRUNCATE_CHARS).toBe(10_000);
  });
});

describe("parseSlashCommand", () => {
  it("passes plain prompt text through unchanged", () => {
    const r = parseSlashCommand("just a normal message");
    expect(r.isSlashCommand).toBe(false);
    expect(r.rest).toBe("just a normal message");
    expect(r.commandName).toBeNull();
    expect(r.commandArgs).toBeNull();
  });

  it("treats null text as a non-slash empty prompt", () => {
    const r = parseSlashCommand(null);
    expect(r.isSlashCommand).toBe(false);
    expect(r.rest).toBe("");
  });

  it("parses a full command with name and args", () => {
    const raw =
      "<command-name>/grill-me</command-name><command-message>grill-me</command-message><command-args>walk every branch</command-args>";
    const r = parseSlashCommand(raw);
    expect(r.isSlashCommand).toBe(true);
    expect(r.commandName).toBe("/grill-me");
    expect(r.commandArgs).toBe("walk every branch");
  });

  it("parses a command with no args tag", () => {
    const r = parseSlashCommand("<command-name>/clear</command-name>");
    expect(r.isSlashCommand).toBe(true);
    expect(r.commandName).toBe("/clear");
    expect(r.commandArgs).toBeNull();
  });

  it("is robust to a partial/unclosed command-name tag", () => {
    // Missing closing tag must not throw; falls back to non-slash passthrough.
    const raw = "<command-name>/oops and then some free text";
    expect(() => parseSlashCommand(raw)).not.toThrow();
    const r = parseSlashCommand(raw);
    expect(r.isSlashCommand).toBe(false);
  });

  it("keeps surrounding free text as rest", () => {
    const raw =
      "before <command-name>/run</command-name><command-args>build</command-args> after";
    const r = parseSlashCommand(raw);
    expect(r.isSlashCommand).toBe(true);
    expect(r.rest).toContain("before");
    expect(r.rest).toContain("after");
    expect(r.rest).not.toContain("command-name");
  });
});

describe("agentLineage", () => {
  const tree: TranscriptAgentNode = node("1", "", [
    node("a1", "Explore", []),
    node("a2", "general-purpose", [node("a3", "Explore", [])]),
  ]);

  function node(
    id: string,
    agentType: string,
    children: TranscriptAgentNode[],
  ): TranscriptAgentNode {
    return {
      id,
      agentType,
      resolvedModel: null,
      costUsd: 0,
      tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 },
      unpriced: false,
      hasError: false,
      metaCount: 0,
      spawnedByMessageId: null,
      spawnedByToolUseId: null,
      children,
    };
  }

  it("returns just the root when the root is selected", () => {
    expect(agentLineage(tree, "1").map((n) => n.id)).toEqual(["1"]);
  });

  it("returns the ancestor chain from root to a nested node", () => {
    expect(agentLineage(tree, "a3").map((n) => n.id)).toEqual(["1", "a2", "a3"]);
  });

  it("returns an empty chain for an unknown id", () => {
    expect(agentLineage(tree, "nope")).toEqual([]);
  });
});

describe("findSpawnedNode", () => {
  function node(
    id: string,
    spawn: { toolUseId?: string | null; messageId?: number | null },
    children: TranscriptAgentNode[] = [],
  ): TranscriptAgentNode {
    return {
      id,
      agentType: "Explore",
      resolvedModel: null,
      costUsd: 0,
      tokens: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 },
      unpriced: false,
      hasError: false,
      metaCount: 0,
      spawnedByMessageId: spawn.messageId ?? null,
      spawnedByToolUseId: spawn.toolUseId ?? null,
      children,
    };
  }

  const tree = node("root", {}, [
    node("a1", { toolUseId: "tu_a", messageId: 10 }),
    node("a2", { toolUseId: "tu_b", messageId: 20 }, [
      node("a3", { toolUseId: "tu_c", messageId: 30 }),
    ]),
  ]);

  it("correlates by tool_use id, even for a deeply nested node", () => {
    expect(findSpawnedNode(tree, { toolUseId: "tu_c", messageId: 999 })?.id).toBe(
      "a3",
    );
  });

  it("prefers the tool_use id when a message spawned several agents", () => {
    // Two agents share message 40; only the tool_use id disambiguates.
    const t = node("root", {}, [
      node("x1", { toolUseId: "tu_x", messageId: 40 }),
      node("x2", { toolUseId: "tu_y", messageId: 40 }),
    ]);
    expect(findSpawnedNode(t, { toolUseId: "tu_y", messageId: 40 })?.id).toBe("x2");
  });

  it("falls back to the message id when the call has no tool_use id", () => {
    expect(findSpawnedNode(tree, { toolUseId: null, messageId: 20 })?.id).toBe(
      "a2",
    );
  });

  it("returns null when nothing correlates", () => {
    expect(findSpawnedNode(tree, { toolUseId: "tu_missing", messageId: 777 })).toBeNull();
  });
});
