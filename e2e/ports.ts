// The port an e2e run owns, shared by `playwright.config.ts` and any spec that needs it.

/**
 * The port the e2e server listens on: `E2E_PORT`, else 3123, far from `dev:seed`'s own scan range (3001 up).
 * Moving it lets two worktrees run e2e at once.
 */
export const E2E_PORT = Number(process.env.E2E_PORT ?? "3123");
