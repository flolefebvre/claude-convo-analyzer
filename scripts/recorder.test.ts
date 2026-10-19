// `pnpm recorder` as a process: it prints the ANTHROPIC_BASE_URL line, and a
// SIGTERM or a POST to its stop endpoint lets an in-flight streamed API request
// finish before it exits 0. With `--detach` it leaves a Recorder running on its
// own and exits at once.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RECORDER_STOP_PATH } from "@/core/recorder";
import { readRecorderStatus, recorderLogPath } from "@/core/recorder-control";
import { readRecordings } from "@/core/recording";
import {
  deferred,
  MESSAGES_RESPONSE_EVENTS,
  respondWithFirstEventUntil,
  startFakeUpstream,
  textUntilEnd,
  type FakeUpstream,
} from "@/core/__tests__/helpers/fake-upstream";
import { freePort, stopDetachedRecorder } from "@/core/__tests__/helpers/recorder-port";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

let recordingsRoot: string;
let upstream: FakeUpstream;
let releaseRest: () => void;
let recorderProcess: ChildProcess | undefined;
/** Ports a `--detach` run left a Recorder on, stopped after the test. */
let detachedRecorderPorts: number[] = [];

beforeEach(async () => {
  recordingsRoot = mkdtempSync(path.join(tmpdir(), "cca-recorder-script-"));
  const release = deferred();
  releaseRest = release.resolve;
  upstream = await startFakeUpstream(respondWithFirstEventUntil(release.promise));
});

afterEach(async () => {
  recorderProcess?.kill("SIGKILL");
  recorderProcess = undefined;
  for (const port of detachedRecorderPorts) await stopDetachedRecorder(port);
  detachedRecorderPorts = [];
  releaseRest();
  await upstream.close();
  rmSync(recordingsRoot, { recursive: true, force: true });
});

/** Run the script on a free port in front of the fake upstream; resolves with the base URL it prints. */
function startRecorderProcess(): Promise<string> {
  recorderProcess = spawn(process.execPath, ["--import", "tsx", "scripts/recorder.ts"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      CCA_RECORDER_PORT: "0",
      CCA_RECORDER_UPSTREAM: upstream.url,
      CCA_RECORDINGS_ROOT: recordingsRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  recorderProcess.stderr!.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  return new Promise((resolve, reject) => {
    let stdout = "";
    recorderProcess!.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      const baseUrl = /^ANTHROPIC_BASE_URL=(\S+)$/m.exec(stdout)?.[1];
      if (baseUrl) resolve(baseUrl);
    });
    recorderProcess!.once("exit", (code) =>
      reject(new Error(`recorder exited with ${code} before listening: ${stderr}`)),
    );
  });
}

/** Run the script with `args` and `env` added, to its exit. */
function runToExit(
  args: string[],
  env: Record<string, string>,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/recorder.ts", ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, CCA_RECORDER_UPSTREAM: upstream.url, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  return new Promise((resolve) => child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr })));
}

function exitCodeOf(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => child.once("exit", (code) => resolve(code)));
}

/** Send one API request through the Recorder and read its response up to the first event. */
async function startStreamedRequest(baseUrl: string): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-claude-code-session-id": "sess-script" },
    body: JSON.stringify({ model: "claude-haiku-4-5", messages: [{ role: "user", content: "hi" }] }),
  });
  const reader = response.body!.getReader();
  await reader.read();
  return reader;
}

/** The two ways to ask the running script to stop, given its base URL. */
const askToStopBy: Record<string, (baseUrl: string) => Promise<void>> = {
  SIGTERM: async () => void recorderProcess!.kill("SIGTERM"),
  "a POST to the stop endpoint": async (baseUrl) => {
    expect((await fetch(`${baseUrl}${RECORDER_STOP_PATH}`, { method: "POST" })).status).toBe(202);
  },
};

describe("pnpm recorder", () => {
  it("prints the ANTHROPIC_BASE_URL to use, on 127.0.0.1", async () => {
    expect(await startRecorderProcess()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it.each(Object.entries(askToStopBy))(
    "lets an in-flight streamed API request finish on %s, records it, then exits 0",
    async (_, askToStop) => {
      const baseUrl = await startRecorderProcess();
      const reader = await startStreamedRequest(baseUrl);
      const exited = exitCodeOf(recorderProcess!);

      await askToStop(baseUrl);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(recorderProcess!.exitCode).toBeNull();
      releaseRest();

      expect(await textUntilEnd(reader)).toBe(MESSAGES_RESPONSE_EVENTS.slice(1).join(""));
      expect(await exited).toBe(0);
      expect(readRecordings(recordingsRoot).map((recorded) => recorded.sessionId)).toEqual(["sess-script"]);
    },
  );

  it("still drains when one Ctrl-C reaches it several times in a burst", async () => {
    const reader = await startStreamedRequest(await startRecorderProcess());
    const exited = exitCodeOf(recorderProcess!);

    for (let delivery = 0; delivery < 3; delivery++) {
      recorderProcess!.kill("SIGINT");
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(recorderProcess!.exitCode).toBeNull();
    releaseRest();

    await textUntilEnd(reader);
    expect(await exited).toBe(0);
  });

  it("with --detach, leaves a Recorder answering health on the port, prints its pid, and exits 0", async () => {
    const port = await freePort();
    detachedRecorderPorts.push(port);
    const detachedRecordingsRoot = path.join(recordingsRoot, "recordings");

    const { exitCode, stdout } = await runToExit(["--detach"], {
      CCA_RECORDER_PORT: String(port),
      CCA_RECORDINGS_ROOT: detachedRecordingsRoot,
    });

    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/^Recorder detached as pid \d+, logging to .*recorder\.log$/m);
    expect(stdout).toContain(`ANTHROPIC_BASE_URL=http://127.0.0.1:${port}\n`);
    expect(await readRecorderStatus(port)).toMatchObject({ status: "running", recordingsRoot: detachedRecordingsRoot });
    expect(readFileSync(recorderLogPath(detachedRecordingsRoot), "utf8")).toContain(`Recorder on 127.0.0.1:${port}`);
  });

  it("with --detach, exits 1 with why when another program holds the port", async () => {
    const holder = http.createServer((_request, response) => response.end("not a recorder"));
    await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
    const { port } = holder.address() as AddressInfo;

    const { exitCode, stdout, stderr } = await runToExit(["--detach"], {
      CCA_RECORDER_PORT: String(port),
      CCA_RECORDINGS_ROOT: path.join(recordingsRoot, "recordings"),
    }).finally(() => new Promise((resolve) => holder.close(resolve)));

    expect(exitCode).toBe(1);
    expect(stdout).not.toContain("ANTHROPIC_BASE_URL");
    expect(stderr).toContain(`Port ${port} is taken by another program.`);
  });

  it("with --detach, exits 1 with the log's lines when the Recorder exits before answering", async () => {
    const port = await freePort();

    const { exitCode, stdout, stderr } = await runToExit(["--detach"], {
      CCA_RECORDER_PORT: String(port),
      CCA_RECORDINGS_ROOT: path.join(recordingsRoot, "recordings"),
      CCA_RECORDER_UPSTREAM: "not a url",
    });

    expect(exitCode).toBe(1);
    expect(stdout).not.toContain("ANTHROPIC_BASE_URL");
    expect(stderr).toMatch(new RegExp(`^The Recorder on port ${port} exited before it started:\n.*Invalid URL`, "s"));
  });

  it("refuses --detach on port 0, which only the Recorder would know", async () => {
    const { exitCode, stderr } = await runToExit(["--detach"], {
      CCA_RECORDER_PORT: "0",
      CCA_RECORDINGS_ROOT: path.join(recordingsRoot, "recordings"),
    });

    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/--detach needs a fixed port/);
  });

  it("exits 1 at once on a second signal, a second or more after the first", async () => {
    await startStreamedRequest(await startRecorderProcess());
    const exited = exitCodeOf(recorderProcess!);

    recorderProcess!.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    recorderProcess!.kill("SIGINT");

    expect(await exited).toBe(1);
  });
});
