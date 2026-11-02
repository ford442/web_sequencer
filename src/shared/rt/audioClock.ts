/**
 * AudioContext time → absolute frame (#1497): the one conversion that stamps
 * control-plane records, on the main thread and in the worklets alike. It
 * matches hyphon::frameAt in emscripten/core/voice.h.
 *
 * Real-time shared code (src/shared/rt/tsconfig.json): ES2022 only.
 */

/**
 * Absolute frame on the AudioContext clock for `audioTime` (seconds).
 * Anything missing, zero, negative or non-finite is frame 0, which a voice
 * plays at the start of its next block.
 */
export function frameAtTime(audioTime: unknown, sampleRate: number): number {
  return typeof audioTime === 'number' && audioTime > 0 && Number.isFinite(audioTime)
    ? Math.round(audioTime * sampleRate)
    : 0;
}
