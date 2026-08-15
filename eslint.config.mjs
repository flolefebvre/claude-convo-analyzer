import { includeIgnoreFile } from "@eslint/compat";
import noComments from "eslint-plugin-no-comments";
import { defineConfig } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { fileURLToPath } from "node:url";

const gitignorePath = fileURLToPath(new URL(".gitignore", import.meta.url));

const eslintConfig = defineConfig([
  includeIgnoreFile(gitignorePath, "Ignore what git ignores"),
  ...nextVitals,
  ...nextTs,
  {
    ignores: ["src/components/ui/**"],
    plugins: { "no-comments": noComments },
    rules: {
      "no-comments/disallowComments": ["error", { allow: ["eslint", "global", "@ts-", "prettier-ignore"] }],
    },
  },
  {
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
