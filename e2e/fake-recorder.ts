// A fake Recorder for the e2e specs: it answers the Recorder's own endpoints
// (`src/core/recorder.ts`) as the real one does, with sessions the spec names,
// and forwards nothing. The app reads it through `CCA_RECORDER_PORT`.

import http from "node:http";

import { RECORDER_HEALTH_PATH, RECORDER_STOP_PATH, type RecorderHealth } from "@/core/recorder";

/** A fake Recorder that is listening. */
export type FakeRecorder = {
  /** Settles once the app has asked it to stop; it then stops listening, as the real one does. */
  stopReceived: Promise<void>;
  /** Stop listening now, if it still does. */
  close(): Promise<void>;
};

/**
 * Start a fake Recorder on 127.0.0.1:`port` whose health reports each of
 * `sessionIds` as a session that sent an API request just now.
 *
 * @example
 * const recorder = await startFakeRecorder({ port: E2E_RECORDER_PORT, sessionIds: ["session-1"] });
 * await recorder.stopReceived;
 */
export async function startFakeRecorder({
  port,
  sessionIds,
}: {
  port: number;
  sessionIds: string[];
}): Promise<FakeRecorder> {
  let resolveStopReceived = () => {};
  const stopReceived = new Promise<void>((resolve) => (resolveStopReceived = resolve));

  const server = http.createServer((request, response) => {
    if (request.method === "GET" && request.url === RECORDER_HEALTH_PATH) {
      const lastRequestAt = new Date().toISOString();
      const health: RecorderHealth = {
        status: "running",
        port,
        recordingsRoot: "/fake-recorder/recordings",
        recentSessions: sessionIds.map((sessionId) => ({ sessionId, lastRequestAt })),
      };
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(health));
      return;
    }
    if (request.method === "POST" && request.url === RECORDER_STOP_PATH) {
      response.writeHead(202).end(() => {
        resolveStopReceived();
        void close();
      });
      return;
    }
    response.writeHead(404).end();
  });

  function close(): Promise<void> {
    if (!server.listening) return Promise.resolve();
    return new Promise((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  return { stopReceived, close };
}
