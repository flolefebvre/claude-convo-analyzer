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
});
