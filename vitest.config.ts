import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts", "src/**/__tests__/**/*.ts"],
    exclude: ["**/node_modules/**", "**/__tests__/helpers/**"],
  },
});
