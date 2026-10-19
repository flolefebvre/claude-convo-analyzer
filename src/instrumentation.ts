// Runs once as the server starts, never during `next build`. Its one job:
// Live, when the user left it on, starts watching again and catches up — the
// one start at boot ADR-0004 allows.

/** Restore Live on the Node.js server. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { restoreLive } = await import("@/app/_lib/live");
    await restoreLive();
  }
}
