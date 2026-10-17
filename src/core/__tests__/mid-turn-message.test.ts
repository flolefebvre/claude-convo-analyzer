import { describe, expect, it } from "vitest";

import { mainSession, messageByUuid, subAgentSession } from "./helpers/agent-messages";

/**
 * A Prompt or Inter-agent message can arrive while the Agent is working: it
 * lands mid-turn rather than between turns, and carries the mid-turn flag.
 */
describe("Mid-turn message parsing", () => {
  const main = mainSession();
  const sub = subAgentSession();

  it("turns a human record in the exact mid-turn wrapper into a mid-turn Prompt", () => {
    const m = messageByUuid(main, "hm1");
    expect(m.kind).toBe("prompt");
    expect(m.text).toBe("ok do it");
    expect(m.origin).toEqual({ midTurn: true });
  });

  it("flags a coordinator message delivered in the mid-turn wrapper", () => {
    expect(messageByUuid(sub, "c1").origin).toEqual({ coordinator: true, midTurn: true });
  });

  it("leaves a message delivered between turns unflagged", () => {
    expect(messageByUuid(main, "p1").origin?.midTurn).toBeUndefined();
  });

  it("parses a queued_command Prompt as a mid-turn Prompt, timestamped from the attachment", () => {
    const m = messageByUuid(main, "q1");
    expect(m.role).toBe("user");
    expect(m.kind).toBe("prompt");
    expect(m.text).toBe("also keep the old export");
    expect(m.origin).toEqual({ midTurn: true });
    expect(m.timestamp).toBe(Date.parse("2026-07-01T10:01:41.000Z"));
  });

  it("parses a queued_command peer message as a mid-turn Inter-agent message", () => {
    const m = messageByUuid(main, "q2");
    expect(m.kind).toBe("inter-agent");
    expect(m.text).toBe("Release is frozen until Friday.");
    expect(m.origin).toEqual({
      senderName: "release session",
      senderFrom: "uds:/run/user/1000/cc-socks/5151.sock",
      midTurn: true,
    });
  });

  it("parses a queued_command coordinator message, timestamped from its record when the attachment has none", () => {
    const m = messageByUuid(sub, "c2");
    expect(m.kind).toBe("inter-agent");
    expect(m.text).toBe("Also cover the attachment case.");
    expect(m.origin).toEqual({ coordinator: true, midTurn: true });
    expect(m.timestamp).toBe(Date.parse("2026-07-01T10:00:40.000Z"));
  });

  it("classifies an origin-less queued_command by its task-notification command mode, unflagged", () => {
    const m = messageByUuid(main, "q4");
    expect(m.kind).toBe("task-notification");
    expect(m.origin).toEqual({
      taskId: "bq4old",
      taskStatus: "completed",
      taskSummary: 'Background command "pnpm test" completed (exit code 0)',
    });
  });

  it("keeps one copy of a message delivered twice, by source uuid or peer message id", () => {
    const uuids = main.messages.map((m) => m.uuid);
    expect(uuids).not.toContain("q1dup"); // same `source_uuid` as q1
    expect(uuids).not.toContain("q2dup"); // same `origin.msg_id` as the p4 record
    expect(uuids).toContain("p4");
  });

  it("skips an attachment without a prompt and every other attachment type", () => {
    const uuids = main.messages.map((m) => m.uuid);
    expect(uuids).not.toContain("qbad");
    expect(uuids).not.toContain("other-att");
  });
});
