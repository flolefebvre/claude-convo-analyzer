import { describe, expect, it } from "vitest";

import { mainSession, messageByUuid, parseLine, subAgentSession } from "./helpers/agent-messages";

/**
 * An Inter-agent message is text another Agent addressed to this one
 * (`origin.kind` `peer` or `coordinator`). It always has a sender, and its
 * `text` is the message without the delivery wrapper.
 */
describe("Inter-agent message parsing", () => {
  const main = mainSession();
  const sub = subAgentSession();

  it("classifies a peer message from an in-process sub-agent, naming it by task id", () => {
    const m = messageByUuid(main, "p1");
    expect(m.kind).toBe("inter-agent");
    expect(m.text).toBe("Item 1 is **done**; starting item 2.");
    expect(m.origin).toEqual({ senderName: "general-purpose", senderFrom: "general-purpose", senderTaskId: "a1f00d" });
  });

  it("classifies a cross-session peer message by its session name, without a task id", () => {
    const m = messageByUuid(main, "p4");
    expect(m.kind).toBe("inter-agent");
    expect(m.text).toBe("Heads-up from the docs session: the README moved.");
    expect(m.origin).toEqual({ senderName: "docs session", senderFrom: "uds:/run/user/1000/cc-socks/4242.sock" });
  });

  it("marks a hand-back and uses its report text as the body", () => {
    const m = messageByUuid(main, "p2");
    expect(m.kind).toBe("inter-agent");
    expect(m.text).toBe("Final report: the parser is refactored.");
    expect(m.origin?.handback).toBe(true);
  });

  it("falls back to the verbatim body for a hand-back without report text", () => {
    const m = messageByUuid(main, "p3");
    expect(m.text).toBe("[Subagent hand-back] The report follows:\n  Second report, no report text.");
    expect(m.origin).toEqual({ senderFrom: "a1f00d", senderTaskId: "a1f00d", handback: true });
  });

  it("classifies a coordinator message and strips its exact delivery wrapper", () => {
    const m = messageByUuid(sub, "c1");
    expect(m.kind).toBe("inter-agent");
    expect(m.text).toBe("Plan approved. Proceed.");
    expect(m.origin?.coordinator).toBe(true);
  });

  it("keeps a coordinator message whose wrapper wording differs as it was logged", () => {
    const { messages } = parseLine({
      type: "user",
      uuid: "c9",
      isMeta: true,
      origin: { kind: "coordinator" },
      message: { role: "user", content: "The coordinator says:\nhello" },
    });
    expect(messages[0]?.kind).toBe("inter-agent");
    expect(messages[0]?.text).toBe("The coordinator says:\nhello");
    expect(messages[0]?.origin).toEqual({ coordinator: true });
  });

  it("never seeds the title fallback", () => {
    const { title } = parseLine({
      type: "user",
      uuid: "p9",
      isMeta: true,
      origin: { kind: "peer", from: "x", body: "hello" },
      message: { role: "user", content: "wrapped hello" },
    });
    expect(title).toBeNull();
  });
});
