import { describe, expect, it } from "vitest";

import { DEFAULT_PORT, parseLaunchArguments } from "./launch-arguments";

describe("parseLaunchArguments", () => {
  it("serves on port 4747 and opens the browser by default", () => {
    expect(DEFAULT_PORT).toBe(4747);
    expect(parseLaunchArguments([], {})).toEqual({ kind: "launch", port: 4747, shouldOpenBrowser: true });
  });

  it("takes the port from --port, in either spelling", () => {
    expect(parseLaunchArguments(["--port", "5000"], {})).toMatchObject({ port: 5000 });
    expect(parseLaunchArguments(["--port=5001"], {})).toMatchObject({ port: 5001 });
  });

  it("takes the port from PORT, which --port overrides; an empty PORT counts as unset", () => {
    expect(parseLaunchArguments([], { PORT: "6000" })).toMatchObject({ port: 6000 });
    expect(parseLaunchArguments(["--port", "5000"], { PORT: "6000" })).toMatchObject({ port: 5000 });
    expect(parseLaunchArguments([], { PORT: "" })).toMatchObject({ port: 4747 });
  });

  it("skips opening the browser with --no-open", () => {
    expect(parseLaunchArguments(["--no-open"], {})).toEqual({ kind: "launch", port: 4747, shouldOpenBrowser: false });
  });

  it("asks for the usage with --help or -h", () => {
    expect(parseLaunchArguments(["--help"], {})).toEqual({ kind: "help" });
    expect(parseLaunchArguments(["-h"], {})).toEqual({ kind: "help" });
  });

  it("refuses a port that is not an integer from 1 to 65535, naming where it came from", () => {
    for (const port of ["0", "65536", "abc", "47.5", "-1"]) {
      expect(parseLaunchArguments([`--port=${port}`], {})).toEqual({
        kind: "invalid",
        message: `--port: expected an integer from 1 to 65535, got "${port}"`,
      });
    }
    expect(parseLaunchArguments([], { PORT: "x" })).toEqual({
      kind: "invalid",
      message: 'PORT: expected an integer from 1 to 65535, got "x"',
    });
  });

  it("refuses --port without a value", () => {
    expect(parseLaunchArguments(["--port"], {})).toEqual({
      kind: "invalid",
      message: "--port: expected a port number",
    });
    expect(parseLaunchArguments(["--port", "--no-open"], {})).toEqual({
      kind: "invalid",
      message: "--port: expected a port number",
    });
  });

  it("refuses an unknown argument", () => {
    expect(parseLaunchArguments(["--verbose"], {})).toEqual({
      kind: "invalid",
      message: 'unknown argument "--verbose"',
    });
    expect(parseLaunchArguments(["serve"], {})).toEqual({ kind: "invalid", message: 'unknown argument "serve"' });
  });
});
