// Runs once as the server starts, never during `next build`. Live, when the user
// left it on, starts watching again and catches up; then the app starts a
// Refresh of its own when the stored data is missing or outdated, joining that
// catch-up if it runs. These are the starts at boot ADR-0004 allows.

/** Restore Live, then Refresh missing or outdated data, on the Node.js server. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { restoreLive } = await import("@/app/_lib/live");
    const { startRefreshIfStoredDataIsMissingOrOutdated } = await import("@/app/_lib/startup-refresh");
    await restoreLive();
    await startRefreshIfStoredDataIsMissingOrOutdated();
  }
}
