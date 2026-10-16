import { transportClockController } from './TransportClockController';

/**
 * Run UI work when the audio clock reaches `audioTime` — a step's audible
 * time — rather than when the clock posted the step, which is up to
 * STEP_LOOKAHEAD_MS earlier (#1344 P5). Runs now if that time has come; is
 * dropped if the transport stopped or restarted in between, so a playhead
 * never paints after STOP.
 */
export function scheduleAtAudioTime(context: BaseAudioContext, audioTime: number, fn: () => void): void {
  const delayMs = (audioTime - context.currentTime) * 1000;
  if (!(delayMs > 1)) {
    fn();
    return;
  }
  const run = transportClockController.runId;
  setTimeout(() => {
    if (transportClockController.runId === run) fn();
  }, delayMs);
}
