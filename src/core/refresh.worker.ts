// The worker thread a Refresh runs in (ADR-0004): relays `refresh()`'s progress
// and summary to the refresh runner. A throw surfaces as the worker's `error`.

import { parentPort } from "node:worker_threads";

import { refresh } from "@/core/refresh";
import type { RefreshWorkerMessage } from "@/core/refresh-runner";

function post(message: RefreshWorkerMessage): void {
  parentPort?.postMessage(message);
}

void refresh({ onProgress: (progress) => post({ type: "progress", progress }) }).then((summary) =>
  post({ type: "summary", summary }),
);
