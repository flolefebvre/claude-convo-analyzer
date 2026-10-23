#!/usr/bin/env node
// The package's `claude-convo-analyzer` command. It checks the Node version
// before loading anything else, so a Node too old for the launcher and the app
// still gets the one-line answer: only `./node-version` is imported statically,
// and the launcher proper is loaded after the check.

import { nodeVersionProblem } from "./node-version";

const nodeProblem = nodeVersionProblem(process.versions.node);
if (nodeProblem !== null) {
  console.error(nodeProblem);
  process.exit(1);
}

import("./launch")
  .then(({ launch }) => launch())
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
