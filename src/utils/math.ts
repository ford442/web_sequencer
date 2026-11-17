// @mode: typescript
/**
 * Shared scalar helpers, one definition each (#1596 P4), so call sites stop
 * re-declaring them. A leaf module with no imports: AudioWorklet code
 * (master-loudness-processor via loudness/limiter) imports it, so keep it
 * free of DOM and of anything that pulls a larger module graph.
 * musicTheory.ts re-exports midiToHz / hzToMidi next to the note-name parser.
 */

/**
 * `value` limited to [min, max]. NaN passes through; callers that need a
 * fallback check `Number.isFinite` first. The Math.min/Math.max form (what five
 * of the six removed copies used) also turns -0 into +0 when min is 0, which
 * round-trip tests that compare with `toEqual` rely on.
 */
export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/** Linear interpolation from `a` (t = 0) to `b` (t = 1); `t` is not clamped. */
export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

/** Equal-tempered frequency of a (possibly fractional) MIDI note, A4 = 69 = 440 Hz. */
export function midiToHz(midi: number): number {
    return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Inverse of {@link midiToHz}; fractional for frequencies between semitones. */
export function hzToMidi(hz: number): number {
    return 69 + 12 * Math.log2(hz / 440);
}
