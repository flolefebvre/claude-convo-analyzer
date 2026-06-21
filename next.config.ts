import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module (better-sqlite3) + Prisma client must use native require,
  // never the Server Components bundler (ADR-0002). The core only runs
  // server-side.
  serverExternalPackages: [
    "better-sqlite3",
    "@prisma/client",
    "@prisma/adapter-better-sqlite3",
  ],
};

export default nextConfig;
