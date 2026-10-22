// Runs once as the server starts, never during `next build`. The app first
// checks the stored data and starts a Refresh of its own when it is missing or
// outdated; that check is the main thread's first open of the database, so a
// fresh file is migrated before any Refresh worker opens it. Then Live, when the
// user left it on, starts watching again; its catch-up joins the startup
// Refresh or queues its follow-up after it. These are the starts at boot
// ADR-0004 allows.

/** Refresh missing or outdated data, then restore Live, on the Node.js server. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { restoreLive } = await import("@/app/_lib/live");
    const { startRefreshIfStoredDataIsMissingOrOutdated } = await import("@/app/_lib/startup-refresh");
    await startRefreshIfStoredDataIsMissingOrOutdated();
    await restoreLive();
  }
}
