import type { NextConfig } from "next";

// `pnpm package` builds the npm package from Next's standalone output
// (scripts/package.ts); every other build stays a regular one, which `next
// start` serves.
const isPackageBuild = process.env.NPM_PACKAGE_BUILD === "1";

const nextConfig: NextConfig = {
  ...(isPackageBuild && {
    output: "standalone",
    // The migrations are read from disk at the first open of a database (src/core/db.ts).
    outputFileTracingIncludes: { "**": ["src/core/prisma/migrations/**"] },
    // sharp, Next's optional image optimizer, and its dependencies: native, and
    // unused (no `next/image`).
    outputFileTracingExcludes: { "**": ["**/node_modules/{sharp,@img,detect-libc,semver}/**"] },
  }),
  // Native module (better-sqlite3) + Prisma client must use native require,
  // never the Server Components bundler (ADR-0002). The core only runs
  // server-side.
  serverExternalPackages: ["better-sqlite3", "@prisma/client", "@prisma/adapter-better-sqlite3"],
  // The app is only ever served over loopback, where gzip costs CPU and saves
  // nothing.
  compress: false,
  cacheComponents: true,
  partialPrefetching: true,
  // The AGENTS.md Documentation section carries the bundled-docs pointer;
  // don't let `next dev` inject its managed block on top of it.
  agentRules: false,
  reactCompiler: true,
  experimental: {
    turbopackRustReactCompiler: true,
    // On only for the `pnpm e2e:server` build, which `instant()` drives; the app is never deployed.
    exposeTestingApiInProductionBuild: process.env.EXPOSE_TESTING_API === "1",
  },
};

export default nextConfig;
