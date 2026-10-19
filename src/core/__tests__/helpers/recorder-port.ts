// Ports for tests that run a Recorder in its own process: a free one to start
// it on, and waiting on what answers there.

import net, { type AddressInfo } from "node:net";
import { readRecorderStatus, requestRecorderStop, type RecorderStatus } from "@/core/recorder-control";

/** A port on 127.0.0.1 nothing listens on right now. */
export async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Resolve once the status on `port` is `status`, polling every 50 ms. */
export async function waitForRecorderStatus(port: number, status: RecorderStatus["status"]): Promise<void> {
  while ((await readRecorderStatus(port)).status !== status) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** Stop the Recorder a test started on `port` in its own process, and wait until the port is free. */
export async function stopDetachedRecorder(port: number): Promise<void> {
  await waitForRecorderStatus(port, "running");
  await requestRecorderStop(port);
  await waitForRecorderStatus(port, "off");
}
