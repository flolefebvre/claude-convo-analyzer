// The app's hold on a Recorder (ADR-0006), from outside its process: read its
// status on a port, start one detached so it outlives the app, and ask it to
// stop through its stop endpoint. Every answer comes from the port, since the
// Recorder may have been started from a terminal or by an earlier app; a start
// uses its new Recorder's pid only to notice it exiting before it answers.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { RECORDER_HEALTH_PATH, RECORDER_STOP_PATH, type RecorderHealth } from "@/core/recorder";

/** How long a status read waits for the port to answer. */
const STATUS_READ_TIMEOUT_MS = 1000;
/** How long a start waits for the new Recorder to answer its health endpoint. */
const START_TIMEOUT_MS = 5000;
/** How often a start polls the health endpoint meanwhile. */
const START_POLL_INTERVAL_MS = 100;
/** How many of the log's last lines a failed start reports. */
const FAILURE_LOG_LINE_COUNT = 10;

/** What answers on the Recorder's port: a Recorder (its health), nothing, or another program. */
export type RecorderStatus = RecorderHealth | { status: "off"; port: number } | { status: "portTaken"; port: number };

/** How a start ended: a Recorder answers on the port (this start's or one already there), or it failed. */
export type RecorderStartOutcome =
  { outcome: "started" | "alreadyRunning"; health: RecorderHealth } | { outcome: "failed"; message: string };

/** Where a detached Recorder runs from and records to. */
export type DetachedRecorderOptions = {
  /** A fixed port on 127.0.0.1, which the start waits on. */
  port: number;
  recordingsRoot: string;
  /** The repo holding `scripts/recorder.ts`, the Recorder's working directory. */
  repoRoot: string;
};

/**
 * What answers on 127.0.0.1:`port`: the Recorder's health, `off` when the
 * connection is refused, `portTaken` for anything else (another program, or
 * one that never answers).
 *
 * @example
 * const recorderStatus = await readRecorderStatus(defaultRecorderPort());
 * if (recorderStatus.status === "running") show(recorderStatus.recentSessions.length);
 */
export function readRecorderStatus(port: number): Promise<RecorderStatus> {
  return new Promise((resolve) => {
    const request = http.get(
      { host: "127.0.0.1", port, path: RECORDER_HEALTH_PATH, timeout: STATUS_READ_TIMEOUT_MS, agent: false },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const health = response.statusCode === 200 ? healthIn(Buffer.concat(chunks).toString("utf8")) : null;
          resolve(health ?? { status: "portTaken", port });
        });
        response.on("error", () => resolve({ status: "portTaken", port }));
      },
    );
    request.on("timeout", () => request.destroy(new Error("timed out")));
    request.on("error", (error: NodeJS.ErrnoException) =>
      resolve({ status: error.code === "ECONNREFUSED" ? "off" : "portTaken", port }),
    );
  });
}

/**
 * Ask the Recorder on `port` to stop cleanly; resolves once it has accepted
 * (its in-flight API requests then finish before it exits). Throws, naming the
 * port, when no Recorder accepts.
 *
 * @example await requestRecorderStop(recorderStatus.port);
 */
export function requestRecorderStop(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const refused = (reason: string) => reject(new Error(`The Recorder on port ${port} did not stop: ${reason}`));
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: RECORDER_STOP_PATH,
        timeout: STATUS_READ_TIMEOUT_MS,
        agent: false,
      },
      (response) => {
        response.resume();
        if (response.statusCode === 202) resolve();
        else refused(`it answered ${response.statusCode}`);
      },
    );
    request.on("timeout", () => request.destroy(new Error("it did not answer")));
    request.on("error", (error) => refused(error.message));
    request.end();
  });
}

/**
 * Start the Recorder through `scripts/recorder.ts --detach`, so it outlives
 * this process and its process tree, its output appended to `recorder.log`
 * beside the Recordings root. Resolves once the health endpoint answers on the
 * port; a Recorder already there is left alone, and a port held by another
 * program fails at once.
 *
 * @example
 * const outcome = await startRecorderDetached({ port: 4242, recordingsRoot: defaultRecordingsRoot(), repoRoot: process.cwd() });
 * if (outcome.outcome === "failed") show(outcome.message);
 */
export async function startRecorderDetached(options: DetachedRecorderOptions): Promise<RecorderStartOutcome> {
  const { port, recordingsRoot, repoRoot } = options;
  const statusBefore = await readRecorderStatus(port);
  if (statusBefore.status === "running") return { outcome: "alreadyRunning", health: statusBefore };
  if (statusBefore.status === "portTaken") return portTakenOutcome(port);

  const logPath = recorderLogPath(recordingsRoot);
  const logOffset = existsSync(logPath) ? statSync(logPath).size : 0;
  const launch = await launchedRecorder(port, recordingsRoot, repoRoot);
  if (launch.pid === null) {
    const launcherLines = lastLines(launch.output);
    const failure = `The Recorder on port ${port} could not be launched`;
    return { outcome: "failed", message: launcherLines ? `${failure}:\n${launcherLines}` : `${failure}.` };
  }

  const deadline = Date.now() + START_TIMEOUT_MS;
  let isRecorderAlive = isProcessAlive(launch.pid);
  while (isRecorderAlive && Date.now() < deadline) {
    const status = await readRecorderStatus(port);
    if (status.status === "running") return { outcome: "started", health: status };
    if (status.status === "portTaken") return portTakenOutcome(port);
    await new Promise((resolve) => setTimeout(resolve, START_POLL_INTERVAL_MS));
    isRecorderAlive = isProcessAlive(launch.pid);
  }
  if (isRecorderAlive) process.kill(launch.pid, "SIGTERM");
  const logLines = existsSync(logPath) ? lastLines(readFileSync(logPath).subarray(logOffset).toString("utf8")) : "";
  const failure = isRecorderAlive
    ? `The Recorder on port ${port} did not answer within ${START_TIMEOUT_MS / 1000} s`
    : `The Recorder on port ${port} exited before it started`;
  return { outcome: "failed", message: logLines ? `${failure}:\n${logLines}` : `${failure}.` };
}

/**
 * Run `scripts/recorder.ts --detach`, which leaves the Recorder running as an
 * orphan and exits at once; resolves with the pid it printed (null when it
 * printed none) and everything it printed. The pipes close with the launcher.
 */
function launchedRecorder(
  port: number,
  recordingsRoot: string,
  repoRoot: string,
): Promise<{ pid: number | null; output: string }> {
  return new Promise((resolve) => {
    const launcher = spawn(process.execPath, ["--import", "tsx", path.join("scripts", "recorder.ts"), "--detach"], {
      cwd: repoRoot,
      // The inherited `CCA_*` variables (the upstream, above all) reach the Recorder; these two are this start's.
      env: { ...process.env, CCA_RECORDER_PORT: String(port), CCA_RECORDINGS_ROOT: recordingsRoot },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    launcher.stdout.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    launcher.stderr.on("data", (chunk: Buffer) => (output += chunk.toString("utf8")));
    launcher.once("error", (error) => resolve({ pid: null, output: error.message }));
    launcher.once("close", (exitCode) => {
      const printedPid = /^Recorder detached as pid (\d+)/m.exec(output)?.[1];
      resolve({ pid: exitCode === 0 && printedPid ? Number(printedPid) : null, output });
    });
  });
}

/** Whether a process with this pid exists (the Recorder, orphaned, is reaped by init when it exits). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The Recorder's log when it runs detached (`pnpm recorder --detach`, the
 * app's Start): `recorder.log` beside the Recordings root.
 *
 * @example recorderLogPath("/home/me/.claude-convo-analyzer/recordings"); // "/home/me/.claude-convo-analyzer/recorder.log"
 */
export function recorderLogPath(recordingsRoot: string): string {
  return path.join(path.dirname(recordingsRoot), "recorder.log");
}

function portTakenOutcome(port: number): RecorderStartOutcome {
  return { outcome: "failed", message: `Port ${port} is taken by another program.` };
}

/** The last non-blank lines of `text`, or "" when it has none. */
function lastLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(-FAILURE_LOG_LINE_COUNT)
    .join("\n");
}

/** The health a body spells out, or null when it is not a Recorder's. */
function healthIn(body: string): RecorderHealth | null {
  try {
    const parsed = JSON.parse(body) as Partial<RecorderHealth> | null;
    if (parsed?.status !== "running" || typeof parsed.port !== "number" || !Array.isArray(parsed.recentSessions)) {
      return null;
    }
    return parsed as RecorderHealth;
  } catch {
    return null;
  }
}
