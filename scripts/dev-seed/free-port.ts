// Port probing for `pnpm dev:seed`. A port is free only when both a wildcard
// bind and a 127.0.0.1 bind succeed. The wildcard bind catches a listener on any
// interface where the OS enforces it (Linux); the loopback bind catches a
// 127.0.0.1 listener on macOS, where a wildcard bind succeeds beside one.

import { createServer } from "node:net";

const MAX_PORT = 65535;

/** Whether a listener can bind `port` on `host`, else all interfaces, right now. */
function canBind(port: number, host?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

/** Whether `port` is free both on all interfaces and on 127.0.0.1. */
async function isFree(port: number): Promise<boolean> {
  return (await canBind(port)) && (await canBind(port, "127.0.0.1"));
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
