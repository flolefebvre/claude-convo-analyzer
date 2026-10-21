import os from "node:os";
import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    // The core is server-side only (Node APIs + native sqlite); no DOM needed.
    environment: "node",
    // No test reads or writes the machine's real Recordings or settings file:
    // both default paths point under the temp directory. A test that wants
    // Recordings passes its own root.
    env: {
      CCA_RECORDINGS_ROOT: path.join(os.tmpdir(), "cca-tests-have-no-recordings"),
      CCA_SETTINGS_PATH: path.join(os.tmpdir(), "cca-tests-settings", "settings.json"),
    },
    include: ["src/**/*.{test,spec}.ts", "src/**/__tests__/**/*.ts", "scripts/**/*.test.ts"],
    // Shared setup modules under `__tests__/helpers/` declare no tests of their
    // own — they would fail the "no test suite found" check if collected.
    exclude: ["**/node_modules/**", "**/__tests__/helpers/**"],
    // `--changed` reruns everything when one of these changes. Anchored to the
    // repo root: the default `**` globs skip `.claude/worktrees`. The fixtures
    // are read from disk, not imported, so the module graph can't see them.
    forceRerunTriggers: [
      ...configDefaults.forceRerunTriggers,
      ...[
        "package.json",
        "pnpm-lock.yaml",
        "vitest.config.ts",
        "prisma.config.ts",
        "src/core/prisma/schema.prisma",
        "src/core/prisma/migrations/**",
        "src/core/__tests__/fixtures/**",
        // The worker test reaches these only through a Worker URL and type
        // imports, which the module graph cannot see.
        "src/core/refresh.ts",
        "src/core/refresh.worker.ts",
        // scripts/recorder.test.ts runs these in a child process.
        "scripts/recorder.ts",
        "src/core/recorder.ts",
      ].map((relativePath) => path.resolve(import.meta.dirname, relativePath)),
    ],
  },
});
