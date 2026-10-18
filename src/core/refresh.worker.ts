// The worker thread a Refresh runs in (ADR-0004): relays `refresh()`'s progress,
// then its summary or its failure, to the refresh runner.

import { parentPort } from "node:worker_threads";

import { refresh } from "@/core/refresh";
import type { RefreshWorkerMessage } from "@/core/refresh-runner";

function post(message: RefreshWorkerMessage): void {
  parentPort?.postMessage(message);
}

void refresh({ onProgress: (progress) => post({ type: "progress", progress }) }).then(
  (summary) => post({ type: "summary", summary }),
  (error: unknown) =>
    post({
      type: "failure",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
);
