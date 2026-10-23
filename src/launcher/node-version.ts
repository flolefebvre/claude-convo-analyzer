// The launcher's first check, run before anything else loads: it must still
// work on a Node too old for the rest of the launcher and the app.

/** The oldest Node the app runs on, as the generated manifest's `engines` states it. */
export const MINIMUM_NODE_VERSION = { major: 20, minor: 9 };

/**
 * `null` when Node `version` (as `process.versions.node` spells it) can run the
 * app, else the one line telling the user which Node is needed and where to get it.
 *
 * @example nodeVersionProblem("18.20.4"); // "claude-convo-analyzer needs Node.js 20.9 or newer …"
 */
export function nodeVersionProblem(version: string): string | null {
  const [major, minor] = version.split(".").map((part) => parseInt(part, 10));
  const isRecentEnough =
    major > MINIMUM_NODE_VERSION.major || (major === MINIMUM_NODE_VERSION.major && minor >= MINIMUM_NODE_VERSION.minor);
  if (isRecentEnough) return null;
  const minimum = `${MINIMUM_NODE_VERSION.major}.${MINIMUM_NODE_VERSION.minor}`;
  return `claude-convo-analyzer needs Node.js ${minimum} or newer, and this is Node.js ${version}: install a current one from https://nodejs.org`;
}
