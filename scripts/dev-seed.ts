// `pnpm dev:seed` — rebuild the seed environment in `data/seed/` (as `pnpm seed`
// does, timeline ending now), then run `next dev` against it on `PORT`, else the
// first free port from 3001 (see `dev-seed/serve-seeded.ts`).

import { serveSeeded } from "./dev-seed/serve-seeded";

serveSeeded({ commands: (port) => [["dev", "-p", String(port)]] });
