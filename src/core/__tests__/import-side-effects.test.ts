import { beforeEach, describe, expect, it, vi } from "vitest";

const { databaseCtor } = vi.hoisted(() => ({ databaseCtor: vi.fn() }));

vi.mock("better-sqlite3", () => ({ default: databaseCtor }));

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
