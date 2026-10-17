import { describe, expect, it } from "vitest";

import { mainSession, messageByUuid, parseLine } from "./helpers/agent-messages";

/**
 * A Prompt is text the human speaks to the Agent: typed (`origin.kind: human`)
 * or inserted on their behalf by a plugin (`plugin` with `asUser`). Classified
 * by `origin` before `isMeta`; records without an `origin` keep the older rules.
 */
describe("Prompt classification by origin", () => {
  const main = mainSession();

  it("classifies a human-origin record as a Prompt with no extras", () => {
    const m = messageByUuid(main, "h1");
    expect(m.kind).toBe("prompt");
    expect(m.origin).toBeNull();
  });

  it("classifies a plugin prompt sent as the user, naming the plugin", () => {
    const m = messageByUuid(main, "pl1");
    expect(m.kind).toBe("prompt");
    expect(m.origin).toEqual({ plugin: "session-history" });
  });

  it("keeps a plugin record not sent as the user on the older rules", () => {
    expect(messageByUuid(main, "pl2").kind).toBe("meta");
  });

  it("keeps an isMeta human record without the mid-turn wrapper as Meta", () => {
    expect(messageByUuid(main, "hm2").kind).toBe("meta");
  });

  it("keeps an unknown origin kind on the older rules", () => {
    const { messages } = parseLine({
      type: "user",
      uuid: "ac1",
      origin: { kind: "auto-continuation" },
      message: { role: "user", content: "continue" },
    });
    expect(messages[0]?.kind).toBe("prompt");
    expect(messages[0]?.origin).toBeNull();
  });
});
