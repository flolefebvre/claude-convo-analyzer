// `pnpm e2e:server` — the app `pnpm e2e` tests: rebuild the seed environment in
// `data/seed/`, `next build` with the instant-navigation testing API exposed
// (`EXPOSE_TESTING_API=1`, read by next.config.ts), then `next start` on
// loopback only, on `PORT`.
// A production build, because only it prefetches: a client navigation's
// `instant()` verdict means nothing on `next dev`.

import { LOOPBACK_HOST, serveSeeded } from "./dev-seed/serve-seeded";

serveSeeded({
  env: { EXPOSE_TESTING_API: "1" },
  commands: (port) => [["build"], ["start", "-H", LOOPBACK_HOST, "-p", String(port)]],
});
