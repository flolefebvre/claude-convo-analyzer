import { describe, expect, it } from "vitest";

import { toolCallBodyParts } from "@/core/tool-call-views";

describe("toolCallBodyParts", () => {
  it("shapes an Agent call's input into its facts, then its Task prompt as markdown", () => {
    const inputJson = JSON.stringify({
      subagent_type: "Plan",
      description: "plan the change",
      prompt: "# Task\n\nDo it.",
      run_in_background: false,
    });

    expect(toolCallBodyParts({ name: "Agent", inputJson, resultText: "done" })).toEqual({
      inputParts: [
        {
          kind: "facts",
          facts: [
            { key: "subagent_type", value: "Plan" },
            { key: "description", value: "plan the change" },
            { key: "run_in_background", value: "false" },
          ],
        },
        { kind: "markdown", text: "# Task\n\nDo it." },
      ],
      resultParts: [{ kind: "raw" }],
    });
  });

  it("keeps only the Agent call's present scalar facts", () => {
    const inputJson = JSON.stringify({
      description: "",
      model: null,
      max_turns: 0,
      tags: ["a"],
      options: { deep: true },
      prompt: "go",
    });

    expect(toolCallBodyParts({ name: "Agent", inputJson, resultText: null }).inputParts).toEqual([
      { kind: "facts", facts: [{ key: "max_turns", value: "0" }] },
      { kind: "markdown", text: "go" },
    ]);
  });

  it("gives an Agent call with only a Task prompt its markdown part alone", () => {
    expect(toolCallBodyParts({ name: "Agent", inputJson: '{"prompt":"go"}', resultText: null }).inputParts).toEqual([
      { kind: "markdown", text: "go" },
    ]);
  });

  it("gives an Agent call with nothing to render the single raw part", () => {
    expect(toolCallBodyParts({ name: "Agent", inputJson: '{"tags":[]}', resultText: null }).inputParts).toEqual([
      { kind: "raw" },
    ]);
  });

  it("gives a tool with no view the single raw part for its input and result", () => {
    expect(toolCallBodyParts({ name: "Bash", inputJson: '{"command":"ls"}', resultText: "a\n" })).toEqual({
      inputParts: [{ kind: "raw" }],
      resultParts: [{ kind: "raw" }],
    });
  });

  it.each(['{"prompt":"cut off mid-', "not json", "[1,2]", '"a string"'])(
    "gives an Agent input it can't read (%j) the single raw part",
    (inputJson) => {
      expect(toolCallBodyParts({ name: "Agent", inputJson, resultText: null }).inputParts).toEqual([{ kind: "raw" }]);
    },
  );

  it("has no result parts for a call that was never answered", () => {
    expect(toolCallBodyParts({ name: "Bash", inputJson: "{}", resultText: null }).resultParts).toBeNull();
  });
});
