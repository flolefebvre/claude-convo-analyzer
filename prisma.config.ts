import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma 7 CLI config. The runtime DB path is resolved in src/core/db.ts;
// here we only need a URL for `prisma migrate` / `prisma generate`. The
// migration's DDL is what gets committed, so the concrete URL used at CLI
// time is irrelevant to runtime (which uses the better-sqlite3 adapter).
const databaseUrl =
  process.env.DATABASE_URL ??
  `file:${path.join(process.cwd(), "data", "analyzer.db")}`;

export default defineConfig({
  schema: path.join("src", "core", "prisma", "schema.prisma"),
  migrations: {
    path: path.join("src", "core", "prisma", "migrations"),
  },
  datasource: {
    url: databaseUrl,
  },
});
