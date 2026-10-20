// The ports an e2e run owns, shared by `playwright.config.ts` and the specs that need them.

/**
 * The port the e2e server listens on: `E2E_PORT`, else 3123, far from `dev:seed`'s own scan range (3001 up).
 * Moving it lets two worktrees run e2e at once.
 */
export const E2E_PORT = Number(process.env.E2E_PORT ?? "3123");

/**
 * The Recorder port the e2e server reads (`CCA_RECORDER_PORT`): 1000 above {@link E2E_PORT}, so two worktrees
 * with different e2e ports never share it, and the host's own Recorder on 4242 is never read — unless
 * `E2E_PORT` is 3242.
 */
export const E2E_RECORDER_PORT = E2E_PORT + 1000;
