import { defineConfig, devices } from "@playwright/test";

// Far from `dev:seed`'s own scan range (3001 up); `E2E_PORT` moves it, so two worktrees can run e2e at once.
const port = process.env.E2E_PORT ?? "3123";
const baseURL = `http://localhost:${port}`;

// The one spec that switches Live on, by its exact path.
const LIVE_SPEC = /[\\/]e2e[\\/]active-now\.spec\.ts$/;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // An `instant()` spec is deterministic: a retry would only hide a regression.
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  // A Live Refresh publishes `finished` to every open page, whose `router.refresh()` lands inside another
  // worker's `instant()` lock: a spec that switches Live on runs in `live`, after every other spec, and
  // never holds an `instant()` check itself. A failure in `chromium` skips `live`.
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"], testIgnore: LIVE_SPEC },
    { name: "live", use: devices["Desktop Chrome"], testMatch: LIVE_SPEC, dependencies: ["chromium"] },
  ],
  webServer: {
    command: "pnpm e2e:server",
    env: { PORT: port },
    url: baseURL,
    // Never test whatever else holds the port, or a build of older code: a taken port fails the run.
    reuseExistingServer: false,
    // Seeds, then a cold `next build`, before `next start` answers.
    timeout: 240_000,
  },
});
