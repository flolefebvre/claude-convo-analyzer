import { defineConfig, devices } from "@playwright/test";

import { E2E_PORT } from "./e2e/ports";

const baseURL = `http://127.0.0.1:${E2E_PORT}`;

// The specs with side effects on state every open page shares, by their exact paths: Live switched on.
const SHARED_STATE_SPECS = [/[\\/]e2e[\\/]active-now\.spec\.ts$/];

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // An `instant()` spec is deterministic: a retry would only hide a regression.
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  // A Live Refresh publishes `finished` to every open page, whose `router.refresh()` lands inside another
  // worker's `instant()` lock: a spec with such a side effect runs in `shared-state`, after every other
  // spec, one file at a time, and never holds an `instant()` check itself. A failure in `chromium` skips
  // `shared-state`.
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"], testIgnore: SHARED_STATE_SPECS },
    {
      name: "shared-state",
      use: devices["Desktop Chrome"],
      testMatch: SHARED_STATE_SPECS,
      workers: 1,
      dependencies: ["chromium"],
    },
  ],
  webServer: {
    command: "pnpm e2e:server",
    env: { PORT: String(E2E_PORT) },
    url: baseURL,
    // Never test whatever else holds the port, or a build of older code: a taken port fails the run.
    reuseExistingServer: false,
    // Seeds, then a cold `next build`, before `next start` answers.
    timeout: 240_000,
  },
});
