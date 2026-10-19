// The Recorder item's server part: it reads what answers on the configured
// Recorder port as of this request, so the first streamed paint is right, and
// hands it to the client item, which keeps it current. Request-time, so it
// renders in its own `<Suspense>` with the inert item as fallback.

import { connection } from "next/server";

import { RecorderControl } from "@/app/_components/recorder-control";
import { readConfiguredRecorderStatus } from "@/app/_lib/recorder";

/**
 * The Recorder item, showing whether the Recorder runs now.
 *
 * @example <Suspense fallback={<InertRecorderControl />}><CurrentRecorderControl /></Suspense>
 */
export async function CurrentRecorderControl() {
  // The status baked into the prerender would show whatever it was at build.
  await connection();
  const { status, port } = await readConfiguredRecorderStatus();
  return <RecorderControl recorderStatus={{ status, port }} />;
}
