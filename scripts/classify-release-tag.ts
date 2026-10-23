#!/usr/bin/env tsx
/**
 * `tsx scripts/classify-release-tag.ts <tag>`: the release workflow's `version`
 * job. Prints the tag's kind against package.json's version (scripts/release-tag.ts)
 * and, on a runner, writes it as the step output `kind`. Exits 1, naming the tag
 * and the version, when the tag matches neither kind.
 */
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";

import { releaseTagKind } from "./release-tag";

const repoRoot = path.resolve(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf-8")) as { version: string };

const tag = process.argv[2];
if (tag === undefined) {
  console.error("Usage: tsx scripts/classify-release-tag.ts <tag>");
  process.exit(1);
}

try {
  const kind = releaseTagKind(tag, version);
  console.log(`${tag}: ${kind} of ${version}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `kind=${kind}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
