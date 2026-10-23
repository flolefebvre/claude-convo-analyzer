// The e2e server itself, not a route: it binds loopback only, as every script that serves the app does.

import { connect } from "node:net";
import { networkInterfaces } from "node:os";

import { expect, test } from "@playwright/test";

import { E2E_PORT } from "./ports";

/** This machine's first non-loopback IPv4 address, or `undefined` when it has none. */
function firstNetworkIpv4Address(): string | undefined {
  return Object.values(networkInterfaces())
    .flat()
    .find((address) => address?.family === "IPv4" && !address.internal)?.address;
}

/** The outcome of a TCP connection to `host:port`: `"connected"`, or the error's code. */
function tcpConnectionOutcome(host: string, port: number): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    socket.once("connect", () => {
      socket.destroy();
      resolve("connected");
    });
    socket.once("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message));
  });
}

test.describe("Server binding (pnpm e2e:server)", () => {
  test("refuses a connection on this machine's network address", async () => {
    const networkAddress = firstNetworkIpv4Address();
    if (networkAddress === undefined) {
      test.skip(true, "this machine has no non-loopback IPv4 address to connect to");
      return;
    }

    expect(await tcpConnectionOutcome(networkAddress, E2E_PORT)).toBe("ECONNREFUSED");
  });

  test("answers on 127.0.0.1", async ({ request }) => {
    const response = await request.get(`http://127.0.0.1:${E2E_PORT}/`);
    expect(response.ok()).toBe(true);
  });
});
