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
  },
});
