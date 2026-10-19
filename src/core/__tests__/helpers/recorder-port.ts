// Ports for tests that run a Recorder in its own process: a free one to start
// it on, and waiting on what answers there.

import net, { type AddressInfo } from "node:net";
import { readRecorderStatus, requestRecorderStop, type RecorderStatus } from "@/core/recorder-control";

/** How long a wait on a port's status lasts before giving up. */
const STATUS_WAIT_TIMEOUT_MS = 4000;

/** A port on 127.0.0.1 nothing listens on right now. */
export async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Whether the status on `port` became `status` within 4 s, polling every 50 ms. */
export async function waitForRecorderStatus(port: number, status: RecorderStatus["status"]): Promise<boolean> {
  const deadline = Date.now() + STATUS_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if ((await readRecorderStatus(port)).status === status) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/**
 * Stop the Recorder a test started on `port` in its own process, if it came
 * up, and wait until the port is free.
 */
export async function stopDetachedRecorder(port: number): Promise<void> {
  if (!(await waitForRecorderStatus(port, "running"))) return;
  await requestRecorderStop(port);
  await waitForRecorderStatus(port, "off");
}
