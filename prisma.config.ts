import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7 CLI config, for `prisma migrate` / `prisma generate`. The runtime
// uses the better-sqlite3 adapter on the path from `defaultDbPath()` in
// src/core/db.ts; the CLI resolves the same `CCA_DB_PATH` (empty counts as
// unset) inline, since this file runs outside the app, so a CLI run under a
// configured env touches the same file the app would.
const dbPath = path.resolve(process.env.CCA_DB_PATH || path.join("data", "analyzer.db"));
const databaseUrl = process.env.DATABASE_URL ?? `file:${dbPath}`;

export default defineConfig({
  schema: path.join("src", "core", "prisma", "schema.prisma"),
  migrations: {
    path: path.join("src", "core", "prisma", "migrations"),
  },
  datasource: {
    url: databaseUrl,
  },
});
