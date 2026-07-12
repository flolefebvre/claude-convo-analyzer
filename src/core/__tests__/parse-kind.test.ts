import { describe, expect, it } from "vitest";
import { parseSessionLines } from "@/core/parse";

/**
 * `kind` classifies USER records for the transcript view: only genuine human
 * prompts render as user messages; tool-result carriers and machine-injected
 * meta records (skill instructions, command output, system reminders) are
 * excluded. Assistant rows have no meaningful kind (null).
 */
describe("message kind derivation", () => {
  const promptRecord = JSON.stringify({
    type: "user",
    uuid: "u-prompt",
    timestamp: "2026-06-20T09:00:00.000Z",
    isMeta: false,
    message: { role: "user", content: "please refactor the parser" },
  });

  const toolResultRecord = JSON.stringify({
    type: "user",
    uuid: "u-tr",
    timestamp: "2026-06-20T09:00:06.000Z",
    toolUseResult: { stdout: "hi\n", stderr: "", interrupted: false },
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu-1", is_error: false, content: "hi\n" },
      ],
    },
  });

  const metaRecord = JSON.stringify({
    type: "user",
    uuid: "u-meta",
    timestamp: "2026-06-20T09:00:01.000Z",
    isMeta: true,
    message: {
      role: "user",
      content: [{ type: "text", text: "Base directory for this skill: /skills/x" }],
    },
  });

  const assistantRecord = JSON.stringify({
    type: "assistant",
    uuid: "a1",
    requestId: "req-1",
    timestamp: "2026-06-20T09:00:05.000Z",
    message: {
      id: "msg-1",
      role: "assistant",
      model: "claude-opus-4-8",
      content: [{ type: "text", text: "working" }],
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  });

  it("classifies a genuine user prompt as kind 'prompt'", () => {
    const { messages } = parseSessionLines([promptRecord]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.kind).toBe("prompt");
  });

  it("classifies a tool-result carrier as kind 'tool-result'", () => {
    const { messages } = parseSessionLines([toolResultRecord]);
    expect(messages[0]?.kind).toBe("tool-result");
  });

  it("classifies an isMeta user record as kind 'meta'", () => {
    const { messages } = parseSessionLines([metaRecord]);
    expect(messages[0]?.kind).toBe("meta");
  });

  it("leaves assistant messages with a null kind", () => {
    const { messages } = parseSessionLines([assistantRecord]);
    expect(messages[0]?.kind).toBeNull();
  });
});
