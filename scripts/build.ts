#!/usr/bin/env tsx
/**
 * `pnpm build`: `next build`, with its output forwarded as it comes, failing
 * when that output holds Turbopack's warning block (`turbopackWarningBlock`),
 * which `next build` itself exits 0 after. Otherwise it exits with `next
 * build`'s own status. Arguments are passed on to `next build`.
 */
import { spawn } from "node:child_process";

import { turbopackWarningBlock } from "./turbopack-warnings";

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const red = (text: string) => (useColor ? `\x1b[31m${text}\x1b[0m` : text);

const outputChunks: Buffer[] = [];
const child = spawn("pnpm", ["exec", "next", "build", ...process.argv.slice(2)], {
  stdio: ["inherit", "pipe", "pipe"],
  shell: process.platform === "win32",
  // Piped, next would drop its colors; keep them for a terminal.
  env: useColor ? { ...process.env, FORCE_COLOR: "1" } : process.env,
});
child.stdout.on("data", (chunk: Buffer) => {
  outputChunks.push(chunk);
  process.stdout.write(chunk);
});
child.stderr.on("data", (chunk: Buffer) => {
  outputChunks.push(chunk);
  process.stderr.write(chunk);
});

child.on("error", (error) => {
  console.error(red(`next build could not start: ${error.message}`));
  process.exit(1);
});

child.on("close", (status) => {
  if (status !== 0) process.exit(status ?? 1);
  const warningBlock = turbopackWarningBlock(Buffer.concat(outputChunks).toString());
  if (warningBlock === null) process.exit(0);
  console.error(red("\nBuild failed: next build printed a Turbopack warning, and pnpm build allows none:\n"));
  console.error(warningBlock);
  process.exit(1);
});
