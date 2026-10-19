import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Nested git worktrees carry their own build output.
    ".claude/worktrees/**",
    // Vendored skills, tracked by skills-lock.json.
    ".agents/skills/**",
  ]),
  {
    rules: {
      // A rest-destructure may name a key only to drop it (`const { body, ...rest } = x`), the idiomatic omit.
      "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true }],
    },
  },
  {
    // src/core is framework-free (ADR-0002): server-side domain logic only.
    files: ["src/core/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["next", "next/*", "react", "react-dom", "react/*"],
              message: "src/core must stay framework-free (ADR-0002): no next/react imports.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
