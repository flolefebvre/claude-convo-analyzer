import { describe, expect, it } from "vitest";

import {
  agentHref,
  messageAnchorId,
  messageHref,
  resolveAgent,
  resolveCall,
  resolveListReturn,
  resolveMessage,
  toolCallHref,
  transcriptPageHref,
  withListReturn,
} from "@/app/_lib/transcript-url";

describe("transcriptPageHref", () => {
  it("sets the page on the agent's link", () => {
    expect(transcriptPageHref("s1", "a7", 3, undefined)).toBe("/conversation/s1?agent=a7&page=3");
  });

  it("links page 1 as the bare agent link, never ?page=1", () => {
    expect(transcriptPageHref("s1", "a7", 1, undefined)).toBe("/conversation/s1?agent=a7");
    expect(transcriptPageHref("s1", undefined, 1, undefined)).toBe("/conversation/s1");
  });

  it("pages the main agent with no ?agent=", () => {
    expect(transcriptPageHref("s1", undefined, 2, undefined)).toBe("/conversation/s1?page=2");
  });

  it("keeps the list view the transcript was opened from", () => {
    expect(transcriptPageHref("s1", "a7", 2, "page=3")).toBe("/conversation/s1?agent=a7&page=2&from=page%3D3");
  });
});

describe("resolveAgent", () => {
  it("returns undefined when the param is absent (core defaults to main)", () => {
    expect(resolveAgent(undefined)).toBeUndefined();
  });

  it("returns the id for a single string value", () => {
    expect(resolveAgent("a2")).toBe("a2");
  });

  it("takes the first value when the param repeats", () => {
    expect(resolveAgent(["a2", "a3"])).toBe("a2");
  });

  it("treats an empty string as absent", () => {
    expect(resolveAgent("")).toBeUndefined();
  });
});

describe("agentHref", () => {
  it("builds a /conversation/<id>?agent=<agent> link", () => {
    expect(agentHref("sess-1", "a2")).toBe("/conversation/sess-1?agent=a2");
  });

  it("omits the query for the root/main link when no agent is given", () => {
    expect(agentHref("sess-1")).toBe("/conversation/sess-1");
  });

  it("url-encodes the session id and agent id", () => {
    expect(agentHref("a b", "x/y")).toBe("/conversation/a%20b?agent=x%2Fy");
  });
});

describe("resolveCall", () => {
  it("reads the anchored tool call, defaulting to none", () => {
    expect(resolveCall(undefined)).toBeUndefined();
    expect(resolveCall("")).toBeUndefined();
    expect(resolveCall("toolu-1")).toBe("toolu-1");
    expect(resolveCall(["toolu-1", "toolu-2"])).toBe("toolu-1");
  });
});

describe("toolCallHref", () => {
  it("links to the agent's transcript, anchored on one tool call", () => {
    expect(toolCallHref("sess-1", "sub1", "toolu-9")).toBe("/conversation/sess-1?agent=sub1&call=toolu-9#call-toolu-9");
  });

  it("anchors on the main agent's transcript too", () => {
    expect(toolCallHref("sess-1", undefined, "toolu-9")).toBe("/conversation/sess-1?call=toolu-9#call-toolu-9");
  });

  it("degrades to the plain agent link when the call has no id", () => {
    expect(toolCallHref("sess-1", "sub1", null)).toBe("/conversation/sess-1?agent=sub1");
  });
});

describe("resolveMessage", () => {
  it("reads the anchored message, defaulting to none", () => {
    expect(resolveMessage(undefined)).toBeUndefined();
    expect(resolveMessage("")).toBeUndefined();
    expect(resolveMessage("uuid-1")).toBe("uuid-1");
    expect(resolveMessage(["uuid-1", "uuid-2"])).toBe("uuid-1");
  });
});

describe("messageAnchorId", () => {
  it("namespaces the element id so it cannot collide with a tool call", () => {
    expect(messageAnchorId("uuid-1")).toBe("msg-uuid-1");
    expect(messageAnchorId("uuid-1")).not.toBe(`call-uuid-1`);
  });
});

describe("messageHref", () => {
  it("links to the agent's transcript, anchored on one message", () => {
    expect(messageHref("sess-1", "sub1", "uuid-9")).toBe("/conversation/sess-1?agent=sub1&msg=uuid-9#msg-uuid-9");
  });

  it("anchors on the main agent's transcript too", () => {
    expect(messageHref("sess-1", undefined, "uuid-9")).toBe("/conversation/sess-1?msg=uuid-9#msg-uuid-9");
  });

  it("degrades to the plain agent link when the message has no uuid", () => {
    expect(messageHref("sess-1", "sub1", null)).toBe("/conversation/sess-1?agent=sub1");
  });

  it("url-encodes a uuid with reserved characters", () => {
    expect(messageHref("sess-1", undefined, "a b")).toBe("/conversation/sess-1?msg=a+b#msg-a%20b");
  });
});

describe("withListReturn", () => {
  const from = "sortBy=cost&dir=asc&page=2";

  it("carries the list view on a transcript link as ?from=", () => {
    expect(withListReturn("/conversation/sess-1", from)).toBe(
      "/conversation/sess-1?from=sortBy%3Dcost%26dir%3Dasc%26page%3D2",
    );
  });

  it("joins an existing query and keeps the #fragment last", () => {
    expect(withListReturn("/conversation/sess-1?agent=a2&msg=m1#msg-m1", from)).toBe(
      "/conversation/sess-1?agent=a2&msg=m1&from=sortBy%3Dcost%26dir%3Dasc%26page%3D2#msg-m1",
    );
  });

  it("leaves the link alone when there is no list view to return to", () => {
    expect(withListReturn("/conversation/sess-1?agent=a2", undefined)).toBe("/conversation/sess-1?agent=a2");
    expect(withListReturn("/conversation/sess-1", "")).toBe("/conversation/sess-1");
  });
});

describe("resolveListReturn", () => {
  it("returns to the bare list when the transcript was not opened from one", () => {
    expect(resolveListReturn(undefined)).toEqual({ href: "/", from: undefined });
    expect(resolveListReturn("")).toEqual({ href: "/", from: undefined });
  });

  it("restores the list view the transcript was opened from", () => {
    const from = "sortBy=cost&dir=asc&folder=%2Fhome%2Fdev%2Fapi&thisFolder=1&expanded=sess-a&range=7&errors=1&page=2";
    expect(resolveListReturn(from)).toEqual({ href: `/?${from}`, from });
  });

  it("keeps only the list's own view-state params", () => {
    expect(resolveListReturn("folder=%2Fhome%2Fdev%2Fapi&agent=a2&q=x&page=")).toEqual({
      href: "/?folder=%2Fhome%2Fdev%2Fapi",
      from: "folder=%2Fhome%2Fdev%2Fapi",
    });
  });

  it("never leaves the list page, whatever the param holds", () => {
    expect(resolveListReturn("//evil.example/path")).toEqual({ href: "/", from: undefined });
    expect(resolveListReturn("https://evil.example/?folder=x")).toEqual({ href: "/", from: undefined });
    expect(resolveListReturn("javascript:alert(1)")).toEqual({ href: "/", from: undefined });
  });

  it("reads the first value when the param repeats", () => {
    expect(resolveListReturn(["page=3", "page=4"])).toEqual({ href: "/?page=3", from: "page=3" });
  });
});
