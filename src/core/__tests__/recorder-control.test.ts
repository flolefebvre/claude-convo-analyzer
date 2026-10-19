// What the app does to a Recorder from outside it: read its status on a port,
// start one detached, and ask it to stop.

import { readFileSync } from "node:fs";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readRecorderStatus, requestRecorderStop, startRecorderDetached } from "@/core/recorder-control";
import { readRecordings } from "@/core/recording";
import { MESSAGES_RESPONSE_EVENTS, textUntilEnd } from "./helpers/fake-upstream";
import { setUpRecorderHarness } from "./helpers/recorder-harness";
import { freePort, stopDetachedRecorder } from "./helpers/recorder-port";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

const harness = setUpRecorderHarness();

/** Servers a test holds a port with, and their open connections, closed after it. */
let portHolders: { server: net.Server; sockets: Set<net.Socket> }[] = [];
/** Ports a detached Recorder was started on, stopped after the test. */
let detachedRecorderPorts: number[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const port of detachedRecorderPorts) await stopDetachedRecorder(port);
  detachedRecorderPorts = [];
  await Promise.all(
    portHolders.map(({ server, sockets }) => {
      const closed = new Promise((resolve) => server.close(resolve));
      for (const socket of sockets) socket.destroy();
      return closed;
    }),
  );
  portHolders = [];
});

/** Hold a free port with `server`, as another program would; resolves with the port. */
async function holdPort(server: net.Server): Promise<number> {
  const sockets = new Set<net.Socket>();
  server.on("connection", (socket) => sockets.add(socket));
  portHolders.push({ server, sockets });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

/** A plain web server that is not a Recorder. */
function holdPortWithWebServer(): Promise<number> {
  return holdPort(http.createServer((_request, response) => response.end("hello")));
}

describe("the Recorder's status", () => {
  it("is its health when a Recorder answers on the port", async () => {
    const recorder = await harness.startRecorder("http://127.0.0.1:1");

    expect(await readRecorderStatus(recorder.port)).toEqual({
      status: "running",
      port: recorder.port,
      recordingsRoot: harness.recordingsRoot,
      recentSessions: [],
    });
  });

  it("is off when nothing listens on the port", async () => {
    const port = await freePort();

    expect(await readRecorderStatus(port)).toEqual({ status: "off", port });
  });

  it("is port taken when another program answers on the port", async () => {
    const port = await holdPortWithWebServer();

    expect(await readRecorderStatus(port)).toEqual({ status: "portTaken", port });
  });

  it("is port taken when a program accepts the connection but never answers", async () => {
    const port = await holdPort(net.createServer(() => {}));

    expect(await readRecorderStatus(port)).toEqual({ status: "portTaken", port });
  });
});

describe("asking a Recorder to stop", () => {
  it("lets an in-flight API request finish, then the Recorder is off", async () => {
    const { recorder, reader, releaseRest } = await harness.startHeldStream();

    await requestRecorderStop(recorder.port);
    releaseRest();

    expect(await textUntilEnd(reader)).toBe(MESSAGES_RESPONSE_EVENTS.slice(1).join(""));
    await recorder.stopped;
    expect(await readRecorderStatus(recorder.port)).toEqual({ status: "off", port: recorder.port });
    expect(readRecordings(harness.recordingsRoot).map((recorded) => recorded.sessionId)).toEqual(["sess-in-flight"]);
  });

  it("throws, naming the port, when no Recorder answers there", async () => {
    const port = await freePort();

    await expect(requestRecorderStop(port)).rejects.toThrow(String(port));
  });
});

describe("starting a Recorder detached", () => {
  it("runs the Recorder script on the port, found by its health, logging next to the Recordings root", async () => {
    const port = await freePort();
    detachedRecorderPorts.push(port);

    const outcome = await startRecorderDetached({ port, recordingsRoot: harness.recordingsRoot, repoRoot: REPO_ROOT });

    expect(outcome.outcome === "failed" ? outcome.message : outcome.outcome).toBe("started");
    expect(outcome).toMatchObject({ outcome: "started", health: { port, recordingsRoot: harness.recordingsRoot } });
    expect(await readRecorderStatus(port)).toMatchObject({ status: "running", port });
    expect(readFileSync(path.join(harness.tmpDir, "recorder.log"), "utf8")).toContain(`Recorder on 127.0.0.1:${port}`);
  });

  it("starts nothing when a Recorder already answers on the port", async () => {
    const recorder = await harness.startRecorder("http://127.0.0.1:1");

    const outcome = await startRecorderDetached({
      port: recorder.port,
      recordingsRoot: path.join(harness.tmpDir, "elsewhere"),
      repoRoot: REPO_ROOT,
    });

    expect(outcome).toMatchObject({ outcome: "alreadyRunning", health: { recordingsRoot: harness.recordingsRoot } });
  });

  it("fails, naming the port, when another program holds it", async () => {
    const port = await holdPortWithWebServer();

    const outcome = await startRecorderDetached({ port, recordingsRoot: harness.recordingsRoot, repoRoot: REPO_ROOT });

    expect(outcome).toEqual({ outcome: "failed", message: `Port ${port} is taken by another program.` });
  });

  it("fails with the log's last lines, naming the port, when the Recorder exits before answering", async () => {
    const port = await freePort();
    vi.stubEnv("CCA_RECORDER_UPSTREAM", "not a url"); // inherited by the Recorder, which cannot start on it

    const outcome = await startRecorderDetached({ port, recordingsRoot: harness.recordingsRoot, repoRoot: REPO_ROOT });

    expect(outcome.outcome).toBe("failed");
    expect(outcome.outcome === "failed" && outcome.message).toMatch(
      new RegExp(`^The Recorder on port ${port} exited before it started:\\n.*Invalid URL`, "s"),
    );
  });

  it("fails with what the launcher printed, naming the port, when it cannot launch the Recorder", async () => {
    const port = await freePort();

    const outcome = await startRecorderDetached({
      port,
      recordingsRoot: harness.recordingsRoot,
      repoRoot: harness.tmpDir, // no Recorder script there
    });

    expect(outcome.outcome).toBe("failed");
    expect(outcome.outcome === "failed" && outcome.message).toMatch(
      new RegExp(`^The Recorder on port ${port} could not be launched:\\n.*\\S`, "s"),
    );
  });
});
