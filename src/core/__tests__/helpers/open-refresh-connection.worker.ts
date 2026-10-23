// A worker that opens the database at `workerData.dbPath` the way a Refresh
// worker does, the moment `workerData.startSignal` flips to 1, and posts
// whether the open succeeded. Several such workers released by one signal race
// on the same fresh file.

import { parentPort, workerData } from "node:worker_threads";
import { openRefreshConnection } from "@/core/db";

const { dbPath, startSignal } = workerData as { dbPath: string; startSignal: Int32Array };

parentPort?.postMessage({ kind: "ready" });
Atomics.wait(startSignal, 0, 0);
try {
  openRefreshConnection(dbPath).close();
  parentPort?.postMessage({ kind: "opened" });
} catch (error) {
  parentPort?.postMessage({ kind: "failed", message: error instanceof Error ? error.message : String(error) });
}
