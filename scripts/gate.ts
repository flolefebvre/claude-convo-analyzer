import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

type StepResult = { name: string; ok: boolean; ms: number };

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code: number, text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = (text: string) => paint(1, text);
const dim = (text: string) => paint(2, text);
const green = (text: string) => paint(32, text);
const red = (text: string) => paint(31, text);

const formatDuration = (ms: number) => {
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${String(Math.floor(seconds % 60)).padStart(2, "0")}s`;
};

const fail = (message: string): never => {
  console.error(red(message));
  process.exit(1);
};

const steps = process.argv
  .slice(2)
  .flatMap((arg) => arg.split(","))
  .map((name) => name.trim())
  .filter(Boolean);

if (steps.length === 0) {
  fail("usage: tsx scripts/gate.ts <script>[,<script>...]");
}

const { scripts = {} } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as {
  scripts?: Record<string, string>;
};

const unknown = steps.filter((name) => !(name in scripts));
if (unknown.length > 0) {
  fail(`no such package.json script: ${unknown.join(", ")}`);
}

const width = Math.max(...steps.map((name) => name.length));
const results: StepResult[] = [];

for (const name of steps) {
  console.log(`\n${bold(`▶ ${name}`)}`);
  const startedAt = performance.now();
  const { status } = spawnSync("pnpm", ["run", name], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  results.push({ name, ok: status === 0, ms: performance.now() - startedAt });
  if (status !== 0) break;
}

console.log("");
for (const result of results) {
  const mark = result.ok ? green("✓") : red("✗");
  console.log(`  ${result.name.padEnd(width)}  ${mark}  ${dim(formatDuration(result.ms))}`);
}
for (const skipped of steps.slice(results.length)) {
  console.log(dim(`  ${skipped.padEnd(width)}  –  skipped`));
}
console.log("");

const failed = results.find((result) => !result.ok);
if (failed) {
  fail(`--gate FAILED at ${failed.name}--`);
}
console.log(green("--gate OK--"));
