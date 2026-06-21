import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { migrationsDir } from "@/core/db";

/**
 * Regression guard for the Turbopack `import.meta.dirname === undefined` crash
 * (bug: cwd-relative migrations resolution). Vitest resolves `import.meta`
 * correctly, so this CANNOT reproduce the Turbopack failure itself; its job is
 * to lock in that the resolved path is real and correct, so a future wrong
 * static path is caught immediately.
 */
describe("migrations directory resolution", () => {
  it("resolves to a real directory on disk", () => {
    const dir = migrationsDir();
    expect(existsSync(dir)).toBe(true);
  });

  it("contains at least one migration with a migration.sql", () => {
    const dir = migrationsDir();
    const migrationDirs = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    expect(migrationDirs.length).toBeGreaterThanOrEqual(1);
    const hasSql = migrationDirs.some((name) =>
      existsSync(path.join(dir, name, "migration.sql")),
    );
    expect(hasSql).toBe(true);
  });
});
