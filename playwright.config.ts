import { defineConfig, devices } from "@playwright/test";

// Far from `dev:seed`'s own scan range (3001 up); `E2E_PORT` moves it, so two worktrees can run e2e at once.
const port = process.env.E2E_PORT ?? "3123";
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // An `instant()` spec is deterministic: a retry would only hide a regression.
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
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
