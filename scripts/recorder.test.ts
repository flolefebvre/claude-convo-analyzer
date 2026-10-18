// `pnpm recorder` as a process: it prints the ANTHROPIC_BASE_URL line, and a
// SIGTERM lets an in-flight streamed API request finish before it exits 0.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readRecordings } from "@/core/recording";
import {
  deferred,
  MESSAGES_RESPONSE_EVENTS,
  respondWithFirstEventUntil,
  startFakeUpstream,
  textUntilEnd,
  type FakeUpstream,
} from "@/core/__tests__/helpers/fake-upstream";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

let recordingsRoot: string;
let upstream: FakeUpstream;
let releaseRest: () => void;
let recorderProcess: ChildProcess | undefined;

beforeEach(async () => {
  recordingsRoot = mkdtempSync(path.join(tmpdir(), "cca-recorder-script-"));
  const release = deferred();
  releaseRest = release.resolve;
  upstream = await startFakeUpstream(respondWithFirstEventUntil(release.promise));
});

afterEach(async () => {
  recorderProcess?.kill("SIGKILL");
  recorderProcess = undefined;
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

describe("pnpm recorder", () => {
  it("prints the ANTHROPIC_BASE_URL to use, on 127.0.0.1", async () => {
    expect(await startRecorderProcess()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("lets an in-flight streamed API request finish on SIGTERM, records it, then exits 0", async () => {
    const reader = await startStreamedRequest(await startRecorderProcess());
    const exited = exitCodeOf(recorderProcess!);

    recorderProcess!.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(recorderProcess!.exitCode).toBeNull();
    releaseRest();

    expect(await textUntilEnd(reader)).toBe(MESSAGES_RESPONSE_EVENTS.slice(1).join(""));
    expect(await exited).toBe(0);
    expect(readRecordings(recordingsRoot).map((recorded) => recorded.sessionId)).toEqual(["sess-script"]);
  });

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

  it("exits 1 at once on a second signal, a second or more after the first", async () => {
    await startStreamedRequest(await startRecorderProcess());
    const exited = exitCodeOf(recorderProcess!);

    recorderProcess!.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 1100));
    recorderProcess!.kill("SIGINT");

    expect(await exited).toBe(1);
  });
});
