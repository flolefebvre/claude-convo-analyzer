#!/usr/bin/env tsx
/**
 * The gate: runs the package.json scripts named on the command line, stage by
 * stage, stopping after the first stage with a failure. `,` separates stages,
 * run in order; `+` joins the scripts of a stage, run in parallel with their
 * output buffered and printed as each finishes. The run ends with a summary and
 * a `--<script> OK--` / `--<script> FAILED at <steps>--` marker, named after the
 * package.json script that ran it (`gate`, `check`).
 *
 * Usage: `tsx scripts/gate.ts format:check+lint+typecheck,test+build` — the
 * sequences live in the `gate` and `check` scripts in package.json, so adding a
 * check means editing those lines.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

type StepResult = { name: string; ok: boolean; ms: number; bufferedOutput: string };

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: number, text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = (text: string) => paint(1, text);
const dim = (text: string) => paint(2, text);
const green = (text: string) => paint(32, text);
const red = (text: string) => paint(31, text);

/** Human-readable duration, e.g. `1.2s` or `2m 04s`. */
const formatDuration = (ms: number) => {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
};

const fail = (message: string): never => {
  console.error(red(message));
  process.exit(1);
};

const stages = process.argv
  .slice(2)
  .flatMap((arg) => arg.split(","))
  .map((stage) =>
    stage
      .split("+")
      .map((name) => name.trim())
      .filter(Boolean),
  )
  .filter((stage) => stage.length > 0);
const steps = stages.flat();

if (steps.length === 0) {
  fail("usage: tsx scripts/gate.ts <script>[+<script>...][,<script>...]");
}

const { scripts = {} } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
  scripts?: Record<string, string>;
};

const lifecycleEvent = process.env.npm_lifecycle_event;
const invokingScript = lifecycleEvent && lifecycleEvent in scripts ? lifecycleEvent : "gate";

const unknown = steps.filter((name) => !(name in scripts));
if (unknown.length > 0) {
  fail(`no such package.json script: ${unknown.join(", ")}`);
}

const runStep = (name: string, isBuffered: boolean) =>
  new Promise<StepResult>((resolve) => {
    // Monotonic: `Date.now()` can step backwards when the host clock resyncs.
    const startedAt = performance.now();
    const outputChunks: Buffer[] = [];
    const child = spawn("pnpm", ["run", name], {
      stdio: isBuffered ? ["ignore", "pipe", "pipe"] : "inherit",
      shell: process.platform === "win32",
    });
    child.stdout?.on("data", (chunk: Buffer) => outputChunks.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => outputChunks.push(chunk));
    const settle = (ok: boolean) =>
      resolve({ name, ok, ms: performance.now() - startedAt, bufferedOutput: Buffer.concat(outputChunks).toString() });
    child.on("error", () => settle(false));
    child.on("close", (status) => settle(status === 0));
  });

const width = Math.max(...steps.map((name) => name.length));

const runStagesUntilFailure = async () => {
  const resultsByStep = new Map<string, StepResult>();
  for (const stage of stages) {
    const isBuffered = stage.length > 1;
    if (isBuffered) {
      console.log(`\n${bold(`▶ ${stage.join(" + ")}`)} ${dim("in parallel, each output printed as it finishes")}`);
    } else {
      console.log(`\n${bold(`▶ ${stage[0]}`)}`);
    }
    const stageResults = await Promise.all(
      stage.map(async (name) => {
        const result = await runStep(name, isBuffered);
        if (isBuffered) {
          console.log(`\n${bold(`▶ ${name}`)}`);
          process.stdout.write(result.bufferedOutput);
        }
        return result;
      }),
    );
    for (const result of stageResults) resultsByStep.set(result.name, result);
    if (stageResults.some((result) => !result.ok)) break;
  }
  return resultsByStep;
};

const printSummary = (resultsByStep: Map<string, StepResult>) => {
  console.log("");
  for (const name of steps) {
    const result = resultsByStep.get(name);
    if (!result) {
      console.log(dim(`  ${name.padEnd(width)}  –  skipped`));
      continue;
    }
    const mark = result.ok ? green("✓") : red("✗");
    console.log(`  ${name.padEnd(width)}  ${mark}  ${dim(formatDuration(result.ms))}`);
  }
  console.log("");

  console.log(
    dim(
      'Agent: if you added comments, check them against the "Comments and docs" rule in AGENTS.md — trim the ones that fail.',
    ),
  );
  console.log("");

  const failedSteps = steps.filter((name) => resultsByStep.get(name)?.ok === false);
  if (failedSteps.length > 0) {
    fail(`--${invokingScript} FAILED at ${failedSteps.join(", ")}--`);
  }
  console.log(green(`--${invokingScript} OK--`));
};

void runStagesUntilFailure().then(printSummary);
