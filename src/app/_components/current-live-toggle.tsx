// The Live toggle's server part: it reads whether Live is on as of this request
// (what runs, not the saved choice) and hands it to the client toggle.
// Request-time, so it renders in its own `<Suspense>` with the inert off toggle
// as fallback.

import { connection } from "next/server";

import { LiveToggle } from "@/app/_components/live-toggle";
import { getLive } from "@/app/_lib/live";

/**
 * The Live toggle, showing whether Live is on now.
 *
 * @example <Suspense fallback={<InertLiveToggle />}><CurrentLiveToggle /></Suspense>
 */
export async function CurrentLiveToggle() {
  // Live's state baked into the prerender would show whatever it was at build.
  await connection();
  return <LiveToggle live={{ isOn: getLive().isOn() }} />;
}
