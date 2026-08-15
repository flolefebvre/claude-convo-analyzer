import { describe, expect, it } from "vitest";
import { parseSessionLines } from "@/core/parse";

describe("assistant effort parsing", () => {
  const assistant = (fields: Record<string, unknown>) =>
    JSON.stringify({
      type: "assistant",
      uuid: "a1",
      timestamp: "2026-06-20T09:00:05.000Z",
      message: {
        id: "msg-1",
        role: "assistant",
        model: "claude-opus-4-8",
        content: [{ type: "text", text: "done" }],
        usage: { input_tokens: 5, output_tokens: 3 },
      },
      ...fields,
    });

  it("lifts the top-level effort onto the assistant message", () => {
    const parsed = parseSessionLines([assistant({ effort: "high" })]);
    expect(parsed.messages[0]?.effort).toBe("high");
  });

  it("leaves effort null on an assistant record that carries none", () => {
    const parsed = parseSessionLines([assistant({})]);
    expect(parsed.messages[0]?.effort).toBeNull();
  });

  it("passes an unknown future level through unchanged", () => {
    const parsed = parseSessionLines([assistant({ effort: "low" })]);
    expect(parsed.messages[0]?.effort).toBe("low");
  });

  it("leaves effort null on user records", () => {
    const line = JSON.stringify({
      type: "user",
      uuid: "u1",
      timestamp: "2026-06-20T09:00:00.000Z",
      effort: "high",
      message: { role: "user", content: "go" },
    });
    expect(parseSessionLines([line]).messages[0]?.effort).toBeNull();
  });

  it("takes effort from the first line of a turn split across content blocks", () => {
    const first = assistant({ effort: "high", uuid: "a1" });
    const second = assistant({ effort: "xhigh", uuid: "a2" });
    const parsed = parseSessionLines([first, second]);
    expect(parsed.messages).toHaveLength(1);
    expect(parsed.messages[0]?.effort).toBe("high");
  });
});
