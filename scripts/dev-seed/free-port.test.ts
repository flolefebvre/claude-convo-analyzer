import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { findFreePort } from "./free-port";

const servers: Server[] = [];

/** Listen on `port` (0: OS-assigned, so tests never collide) on `host`, else all interfaces, and return it. */
async function occupyPort(port = 0, host?: string): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  return address.port;
}

const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

afterEach(async () => {
  await Promise.all(servers.splice(0).map(close));
});

describe("findFreePort", () => {
  it("returns the start port when it is free", async () => {
    const port = await occupyPort();
    await close(servers.pop()!);

    expect(await findFreePort(port)).toBe(port);
  });

  it("skips a port another process is listening on", async () => {
    const taken = await occupyPort();

    const found = await findFreePort(taken);

    expect(found).toBeGreaterThan(taken);
    await expect(occupyPort(found)).resolves.toBe(found);
  });

  // Only discriminates on macOS, where a wildcard bind succeeds beside a 127.0.0.1 listener;
  // on Linux the wildcard bind already fails.
  it("skips a port another process is listening on at 127.0.0.1 only", async () => {
    const taken = await occupyPort(0, "127.0.0.1");

    expect(await findFreePort(taken)).toBeGreaterThan(taken);
  });

  it("throws once it passes 65535 without finding a free port", async () => {
    // If something else already holds 65535, it is just as taken.
    await occupyPort(65535).catch(() => undefined);

    await expect(findFreePort(65535)).rejects.toThrow(/no free port/i);
  });
});
