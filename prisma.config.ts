import path from "node:path";
import { defineConfig } from "prisma/config";

const databaseUrl = process.env.DATABASE_URL ?? `file:${path.join(process.cwd(), "data", "analyzer.db")}`;

export default defineConfig({
  schema: path.join("src", "core", "prisma", "schema.prisma"),
  migrations: {
    path: path.join("src", "core", "prisma", "migrations"),
  },
  datasource: {
    url: databaseUrl,
  },
});
