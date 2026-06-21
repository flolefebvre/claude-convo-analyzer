import { beforeEach, describe, expect, it, vi } from "vitest";

const { databaseCtor } = vi.hoisted(() => ({ databaseCtor: vi.fn() }));

// Observe whether merely importing the core module opens a sqlite connection.
vi.mock("better-sqlite3", () => ({ default: databaseCtor }));

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
    vi.resetModules();
  });

  it("opens no database connection at import time", async () => {
    await import("@/core/refresh");
    expect(databaseCtor).not.toHaveBeenCalled();
  });
});
