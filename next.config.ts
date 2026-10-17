import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native module (better-sqlite3) + Prisma client must use native require,
  // never the Server Components bundler (ADR-0002). The core only runs
  // server-side.
  serverExternalPackages: ["better-sqlite3", "@prisma/client", "@prisma/adapter-better-sqlite3"],
  // The app is only ever served over loopback, where gzip costs CPU and saves
  // nothing. Next's gzip path also leaks a `drain` listener per backpressured
  // write before 16.4.2 (`MaxListenersExceededWarning` on long transcripts).
  compress: false,
  cacheComponents: true,
  partialPrefetching: true,
  // The AGENTS.md Documentation section carries the bundled-docs pointer;
  // don't let `next dev` inject its managed block on top of it.
  agentRules: false,
  reactCompiler: true,
  experimental: {
    turbopackRustReactCompiler: true,
  },
};

export default nextConfig;
