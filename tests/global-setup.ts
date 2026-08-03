/**
 * Ensure a PulseAudio daemon is available before Firefox/WebKit E2E.
 * Without a sink, Firefox keeps AudioContext permanently `suspended` even after
 * user gestures — transport/playhead assertions then fail (#1036).
 */
import { execSync } from 'node:child_process';

export default function globalSetup(): void {
  try {
    execSync('pulseaudio --check', { stdio: 'ignore' });
  } catch {
    try {
      execSync('pulseaudio --start --exit-idle-time=-1', { stdio: 'ignore' });
    } catch {
      // CI images without pulseaudio still run Chromium; FF/WK may need the sink.
      console.warn(
        '[playwright globalSetup] pulseaudio not available — Firefox AudioContext may stay suspended',
      );
    }
  }
}
