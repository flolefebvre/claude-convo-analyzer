import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    // The core is server-side only (Node APIs + native sqlite); no DOM needed.
    environment: "node",
    include: ["src/**/*.{test,spec}.ts", "src/**/__tests__/**/*.ts"],
    // Shared setup modules under `__tests__/helpers/` declare no tests of their
    // own — they would fail the "no test suite found" check if collected.
    exclude: ["**/node_modules/**", "**/__tests__/helpers/**"],
  },
});
