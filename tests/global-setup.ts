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
      // Chromium and WebKit run their clocks without a sink; Firefox does not.
      // Workers inherit this, so startPlaybackAndAwaitClock can name the cause.
      process.env.HYPHON_E2E_NO_AUDIO_SINK = '1';
      console.warn(
        '[playwright globalSetup] pulseaudio not available — Firefox playback specs will fail: ' +
          'AudioContext.resume() never settles without an audio sink',
      );
    }
  }
}
