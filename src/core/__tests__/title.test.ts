// A Conversation's title, resolved as Claude Code resolves it: the last
// `custom-title` that carries a string, else the last `ai-title` that does,
// else the first Prompt. An empty string clears the title it stands for; a
// record without a string value is skipped. Inline logs, one shape each; the
// fixture-backed cases are in family.test.ts.

import { describe, expect, it } from "vitest";

import { parseSessionLines } from "@/core/parse";

/** The title `parseSessionLines` resolves from these records, one per line. */
function titleOf(...records: Record<string, unknown>[]): string | null {
  const prompt = { type: "user", uuid: "u1", message: { role: "user", content: "first prompt" } };
  return parseSessionLines([prompt, ...records].map((r) => JSON.stringify(r))).title;
}

describe("title resolution", () => {
  it("clears an ai-title with a later empty one, falling back to the first prompt", () => {
    expect(titleOf({ type: "ai-title", aiTitle: "Named" }, { type: "ai-title", aiTitle: "" })).toBe("first prompt");
  });

  it("clears a custom-title with a later empty one, falling back to the ai-title", () => {
    expect(
      titleOf(
        { type: "ai-title", aiTitle: "Generated" },
        { type: "custom-title", customTitle: "Renamed" },
        { type: "custom-title", customTitle: "" },
      ),
    ).toBe("Generated");
  });

  it("skips an ai-title record without a string value, keeping the earlier one", () => {
    expect(
      titleOf({ type: "ai-title", aiTitle: "Named" }, { type: "ai-title" }, { type: "ai-title", aiTitle: 42 }),
    ).toBe("Named");
  });

  it("skips a custom-title record without a string value, keeping the earlier one", () => {
    expect(
      titleOf(
        { type: "custom-title", customTitle: "Renamed" },
        { type: "custom-title" },
        { type: "custom-title", customTitle: null },
      ),
    ).toBe("Renamed");
  });
});
