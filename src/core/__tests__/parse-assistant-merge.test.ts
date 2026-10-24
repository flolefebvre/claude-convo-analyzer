import { describe, expect, it } from "vitest";
import { parseSessionLines } from "@/core/parse";

/**
 * Claude Code writes ONE assistant turn (one `message.id`) across several JSONL
 * lines — one per content block (a `thinking` line, a `text` line, then a
 * `tool_use` line), each carrying the Turn's `usage` as it stood when written. The
 * parser must MERGE those records into a single assistant message: concatenated
 * text, every `tool_use` block collected, and usage counted exactly once — the
 * highest value of each bucket across the records, never summed. Keeping only the
 * first record (the old behaviour) dropped the body and tool calls of a
 * thinking-first turn, surfacing as empty "assistant" rows in the transcript.
 */
describe("assistant content-block record merge", () => {
  /** One assistant JSONL line carrying a single content block; `extra` overrides `message` fields. */
  const line = (content: unknown, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      type: "assistant",
      uuid: `a-${JSON.stringify(content).length}-${Math.abs(hash(JSON.stringify(content)))}`,
      requestId: "req-1",
      timestamp: "2026-06-20T09:00:05.000Z",
      message: {
        id: "msg-1",
        role: "assistant",
        model: "claude-opus-4-8",
        content: [content],
        usage: { input_tokens: 4098, output_tokens: 277 },
        ...extra,
      },
    });

  // A tiny deterministic hash so distinct lines get distinct uuids without
  // Math.random (banned) — uuid isn't asserted, only uniqueness matters.
  function hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return h;
  }

  it("merges a thinking→text→tool_use turn into one non-empty message", () => {
    const { messages } = parseSessionLines([
      line({ type: "thinking", thinking: "let me plan", signature: "sig" }),
      line({ type: "text", text: "Now let me create the plan tasks." }),
      line({ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }),
    ]);

    expect(messages).toHaveLength(1);
    const m = messages[0];
    expect(m?.role).toBe("assistant");
    // The body is the text block — not null, not the dropped thinking.
    expect(m?.text).toBe("Now let me create the plan tasks.");
    // The tool_use block survives the merge.
    expect(m?.toolUses).toHaveLength(1);
    expect(m?.toolUses[0]?.name).toBe("Bash");
  });

  it("keeps a thinking-only-first turn's text from a later record", () => {
    const { messages } = parseSessionLines([
      line({ type: "thinking", thinking: "hmm" }),
      line({ type: "text", text: "done" }),
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe("done");
  });

  it("collects every tool_use block across split records", () => {
    const { messages } = parseSessionLines([
      line({ type: "tool_use", id: "t1", name: "Read", input: {} }),
      line({ type: "tool_use", id: "t2", name: "Edit", input: {} }),
      line({ type: "tool_use", id: "t3", name: "Bash", input: {} }),
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.toolUses.map((t) => t.name)).toEqual(["Read", "Edit", "Bash"]);
  });

  it("joins multiple text blocks and counts the repeated usage once", () => {
    const { messages } = parseSessionLines([
      line({ type: "text", text: "first" }),
      line({ type: "tool_use", id: "t1", name: "Bash", input: {} }),
      line({ type: "text", text: "second" }),
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe("first\nsecond");
    // Usage is identical on all three lines → taken once, never summed.
    expect(messages[0]?.inputTokens).toBe(4098);
    expect(messages[0]?.outputTokens).toBe(277);
  });

  it("takes a Turn's usage as the highest of its Records, bucket by bucket", () => {
    const usage = (outputTokens: number, cacheReadTokens: number) => ({
      usage: { input_tokens: 3, output_tokens: outputTokens, cache_read_input_tokens: cacheReadTokens },
    });
    const { messages } = parseSessionLines([
      line({ type: "thinking", thinking: "" }, usage(12, 900)),
      line({ type: "text", text: "Reading the file." }, usage(26, 900)),
      line({ type: "tool_use", id: "t1", name: "Read", input: {} }, usage(40, 850)),
    ]);
    expect(messages).toHaveLength(1);
    // Output grows as the response streams: the highest is the last Record's.
    expect(messages[0]?.outputTokens).toBe(40);
    // Each bucket keeps its own highest, wherever it was seen.
    expect(messages[0]?.cacheReadTokens).toBe(900);
    expect(messages[0]?.inputTokens).toBe(3);
  });
});
