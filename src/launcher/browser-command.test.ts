import { describe, expect, it } from "vitest";

import { browserOpenCommand } from "./browser-command";

const URL = "http://127.0.0.1:4747";

describe("browserOpenCommand", () => {
  it("uses open on macOS", () => {
    expect(browserOpenCommand("darwin", URL)).toEqual({ command: "open", args: [URL] });
  });

  it("uses start through cmd on Windows, with an empty window title", () => {
    expect(browserOpenCommand("win32", URL)).toEqual({ command: "cmd", args: ["/c", "start", '""', URL] });
  });

  it("uses xdg-open elsewhere", () => {
    expect(browserOpenCommand("linux", URL)).toEqual({ command: "xdg-open", args: [URL] });
    expect(browserOpenCommand("freebsd", URL)).toEqual({ command: "xdg-open", args: [URL] });
  });
});
