// Port probing for `pnpm dev:seed`. A probe binds all interfaces, deliberately
// stricter than the server's loopback-only bind: a port held on any interface or
// stack counts as taken, because on macOS binding 127.0.0.1 succeeds while
// another program listens on 0.0.0.0, which would then lose its loopback traffic.

import { createServer } from "node:net";

const MAX_PORT = 65535;

/** Whether a listener can bind `port` on all interfaces right now. */
function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, () => server.close(() => resolve(true)));
  });
}

/**
 * The first port from `from` up to 65535 that nothing is listening on; throws
 * when there is none.
 *
 * @example
 * const port = await findFreePort(3001); // 3002 when 3001 is taken
 */
export async function findFreePort(from: number): Promise<number> {
  for (let port = from; port <= MAX_PORT; port++) {
    if (await isFree(port)) return port;
  }
  throw new Error(`No free port between ${from} and ${MAX_PORT}`);
}
