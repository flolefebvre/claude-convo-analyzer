import { beforeEach, describe, expect, it, vi } from "vitest";

const { databaseCtor, workerCtor } = vi.hoisted(() => ({ databaseCtor: vi.fn(), workerCtor: vi.fn() }));

// Observe whether merely importing a core module opens a sqlite connection or
// spawns a worker thread.
vi.mock("better-sqlite3", () => ({ default: databaseCtor }));
vi.mock("node:worker_threads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:worker_threads")>()),
  Worker: workerCtor,
}));

/**
 * The app's server entry points (`src/app/page.tsx`, `src/app/actions.ts`)
 * import `@/core/refresh` at module top level and gate the actual DB read with
 * `connection()`. That is only safe because importing core is side-effect-free:
 * it resolves cwd-relative paths but opens NO database until a refresh/list call
 * runs at request time. If a future change constructs a client (or otherwise
 * touches the DB) at module load, a static import would re-open the DB during
 * Next's build-time prerender — this guard catches that.
 */
describe("core module import is side-effect-free", () => {
  beforeEach(() => {
    databaseCtor.mockClear();
    workerCtor.mockClear();
    vi.resetModules();
  });

  it("opens no database connection at import time", async () => {
    await import("@/core/refresh");
    expect(databaseCtor).not.toHaveBeenCalled();
  });

  it("opens no database connection and spawns no worker when the refresh runner is imported", async () => {
    await import("@/core/refresh-runner");
    expect(databaseCtor).not.toHaveBeenCalled();
    expect(workerCtor).not.toHaveBeenCalled();
  });
});
