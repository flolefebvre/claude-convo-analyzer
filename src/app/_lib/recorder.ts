// The app's Recorder: core's control over a Recorder (framework-free, ADR-0002)
// composed with the app's defaults — the configured port, the Recordings root,
// and this repo, from which the app server runs, as where the Recorder script
// lives.

import { defaultRecorderPort } from "@/core/recorder";
import {
  readRecorderStatus,
  requestRecorderStop,
  startRecorderDetached,
  type RecorderStartOutcome,
  type RecorderStatus,
} from "@/core/recorder-control";
import { defaultRecordingsRoot } from "@/core/recording";

/**
 * What answers on the configured Recorder port (`CCA_RECORDER_PORT`, else 4242).
 *
 * @example const recorderStatus = await readConfiguredRecorderStatus();
 */
export function readConfiguredRecorderStatus(): Promise<RecorderStatus> {
  return readRecorderStatus(defaultRecorderPort());
}

/**
 * Start the Recorder detached on the configured port, recording to the
 * configured Recordings root; it outlives the app.
 *
 * @example const outcome = await startConfiguredRecorder();
 */
export function startConfiguredRecorder(): Promise<RecorderStartOutcome> {
  return startRecorderDetached({
    port: defaultRecorderPort(),
    recordingsRoot: defaultRecordingsRoot(),
    repoRoot: /*turbopackIgnore: true*/ process.cwd(),
  });
}

/**
 * Ask the Recorder on `port` to stop cleanly; throws, naming the port, when it
 * does not accept.
 *
 * @example await requestStopOfRecorder(recorderStatus.port);
 */
export function requestStopOfRecorder(port: number): Promise<void> {
  return requestRecorderStop(port);
}
