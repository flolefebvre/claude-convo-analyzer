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

  /** The result parts of an Agent call whose stored result is `resultText`. */
  function agentResultParts(resultText: string) {
    return toolCallBodyParts({ name: "Agent", inputJson: '{"prompt":"go"}', resultText }).resultParts;
  }

  const completedLedger = {
    agentId: "a1",
    agentType: "Plan",
    content: [
      { type: "text", text: "## Plan\n\n- slice one" },
      { type: "text", text: "Done." },
    ],
    prompt: "go",
    resolvedModel: "claude-opus-4-8",
    status: "completed",
    toolStats: { readCount: 3 },
    totalDurationMs: 4_420,
    totalTokens: 12_345,
    totalToolUseCount: 7,
    usage: { input_tokens: 10, output_tokens: 20 },
  };

  it("shapes a completed Sub-agent's ledger into its facts, then its hand-back as markdown", () => {
    expect(agentResultParts(JSON.stringify(completedLedger))).toEqual([
      {
        kind: "facts",
        facts: [
          { key: "status", value: "completed" },
          { key: "duration", durationMs: 4_420 },
          { key: "tokens", count: 12_345 },
          { key: "tool uses", count: 7 },
        ],
      },
      { kind: "markdown", text: "## Plan\n\n- slice one\n\nDone." },
    ]);
  });

  it("takes a hand-back sent as a message from its handback report, not the pointer note", () => {
    const ledger = {
      ...completedLedger,
      content: [{ type: "text", text: "This agent's report was delivered to you as a message." }],
      handback: "send",
      handbackReport: { text: "# Report\n\nAll green." },
    };

    expect(agentResultParts(JSON.stringify(ledger))?.[1]).toEqual({ kind: "markdown", text: "# Report\n\nAll green." });
  });

  it("leaves out a completed ledger's missing or non-number facts, and gives it no markdown without text", () => {
    const ledger = {
      status: "completed",
      totalDurationMs: "4s",
      totalTokens: 9,
      content: [],
      handbackReport: { text: "" },
    };

    expect(agentResultParts(JSON.stringify(ledger))).toEqual([
      {
        kind: "facts",
        facts: [
          { key: "status", value: "completed" },
          { key: "tokens", count: 9 },
        ],
      },
    ]);
  });

  it("shapes a background launch into its one status fact", () => {
    const ledger = {
      agentId: "a2",
      canReadOutputFile: true,
      description: "survey",
      isAsync: true,
      outputFile: "/tmp/out",
      prompt: "go",
      resolvedModel: "claude-opus-4-8",
      status: "async_launched",
    };

    expect(agentResultParts(JSON.stringify(ledger))).toEqual([
      { kind: "facts", facts: [{ key: "status", value: "launched in the background" }] },
    ]);
  });

  it.each([
    ["a result cut off mid-JSON", JSON.stringify(completedLedger).slice(0, 80)],
    ["an unknown status", JSON.stringify({ ...completedLedger, status: "failed" })],
    ["no status", JSON.stringify({ agentId: "a3", content: [{ type: "text", text: "hi" }] })],
    ["a plain-text result", "Rotate daily."],
  ])("gives an Agent result with %s the single raw part", (_case, resultText) => {
    expect(agentResultParts(resultText)).toEqual([{ kind: "raw" }]);
  });

  it("shapes a SendMessage call's input into its facts, then its message as markdown", () => {
    const inputJson = JSON.stringify({
      to: "developer",
      summary: "Plan approved",
      message: "## Go ahead\n\n- one commit per slice",
      type: "message",
    });

    expect(toolCallBodyParts({ name: "SendMessage", inputJson, resultText: null }).inputParts).toEqual([
      {
        kind: "facts",
        facts: [
          { key: "to", value: "developer" },
          { key: "summary", value: "Plan approved" },
          { key: "type", value: "message" },
        ],
      },
      { kind: "markdown", text: "## Go ahead\n\n- one commit per slice" },
    ]);
  });

  it("gives a SendMessage call with an empty message its facts alone", () => {
    const inputJson = JSON.stringify({ to: "developer", message: "" });

    expect(toolCallBodyParts({ name: "SendMessage", inputJson, resultText: null }).inputParts).toEqual([
      { kind: "facts", facts: [{ key: "to", value: "developer" }] },
    ]);
  });

  /** The result parts of a SendMessage call whose stored result is `resultText`. */
  function sendMessageResultParts(resultText: string) {
    return toolCallBodyParts({ name: "SendMessage", inputJson: '{"to":"developer"}', resultText }).resultParts;
  }

  it("shapes a SendMessage result into the facts of its scalar fields", () => {
    const result = {
      success: true,
      message: "“Plan approved” → developer",
      msg_id: "m1",
      pin: { id: "a1", ref: "d7b25c" },
    };

    expect(sendMessageResultParts(JSON.stringify(result))).toEqual([
      {
        kind: "facts",
        facts: [
          { key: "success", value: "true" },
          { key: "message", value: "“Plan approved” → developer" },
          { key: "msg_id", value: "m1" },
        ],
      },
    ]);
  });

  it.each([
    ["a prose error", "Error: no agent named developer"],
    ["a result cut off mid-JSON", '{"success":true,"mess'],
  ])("gives a SendMessage result with %s the single raw part", (_case, resultText) => {
    expect(sendMessageResultParts(resultText)).toEqual([{ kind: "raw" }]);
  });

  it("shapes an ExitPlanMode call's input into its plan as markdown, and leaves its result raw", () => {
    const plan = "# Plan\n\n## Context\n\n- slice one";
    const resultText = JSON.stringify({ plan, isAgent: false });

    expect(toolCallBodyParts({ name: "ExitPlanMode", inputJson: JSON.stringify({ plan }), resultText })).toEqual({
      inputParts: [{ kind: "markdown", text: plan }],
      resultParts: [{ kind: "raw" }],
    });
  });

  it("gives an ExitPlanMode call with nothing to render the single raw part", () => {
    expect(toolCallBodyParts({ name: "ExitPlanMode", inputJson: '{"plan":""}', resultText: null }).inputParts).toEqual([
      { kind: "raw" },
    ]);
  });

  it("has no result parts for a call that was never answered", () => {
    expect(toolCallBodyParts({ name: "Bash", inputJson: "{}", resultText: null }).resultParts).toBeNull();
  });
});
