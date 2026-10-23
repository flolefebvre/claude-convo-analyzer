// `pnpm dev:seed` — rebuild the seed environment in `data/seed/` (as `pnpm seed`
// does, timeline ending now), then run `next dev` against it, on loopback only,
// on `PORT`, else the first free port from 3001 (see `dev-seed/serve-seeded.ts`).

import { LOOPBACK_HOST, serveSeeded } from "./dev-seed/serve-seeded";

serveSeeded({ commands: (port) => [["dev", "-H", LOOPBACK_HOST, "-p", String(port)]] });
