import type { VoiceCharacter } from "../rubberband/FormantShifter";

/** Reference pitch levels for multi-resolution caching */
export interface PitchCache {
  /** Low register: C3 (~130.8 Hz) */
  low: Float32Array | null;
  /** Mid register: C4 (~261.6 Hz) */
  mid: Float32Array | null;
  /** High register: C5 (~523.3 Hz) */
  high: Float32Array | null;
}

/** Reference frequencies for pitch cache (in Hz) */
export const REFERENCE_FREQUENCIES = {
  low: 130.81, // C3
  mid: 261.63, // C4
  high: 523.25, // C5
};

/** * Pitch ratio limits for optimal Rubber Band quality.
 * Shifts outside this range introduce more artifacts.
 */
export const PITCH_RATIO_LIMITS = {
  /** Minimum pitch ratio (one octave down) */
  MIN: 0.5,
  /** Maximum pitch ratio (one octave up) */
  MAX: 2.0,
};

/**
 * Time-stretch ratio limits for phoneme-aware duration stretching.
 * Rubber Band handles ratios outside this range poorly — clamp and warn.
 */
export const STRETCH_RATIO_LIMITS = {
  /** Minimum stretch ratio (4x speed-up) */
  MIN: 0.25,
  /** Maximum stretch ratio (4x slow-down) */
  MAX: 4.0,
};

/**
 * Clamp a raw time-stretch ratio to the safe operating range and emit a
 * console warning (not error) when the unclamped value falls outside it.
 *
 * @param ratio Raw computed stretch ratio (targetDuration / nativeDuration)
 * @returns Clamped ratio within [STRETCH_RATIO_LIMITS.MIN, STRETCH_RATIO_LIMITS.MAX]
 */
export function clampStretchRatio(ratio: number): number {
  const clamped = Math.max(
    STRETCH_RATIO_LIMITS.MIN,
    Math.min(STRETCH_RATIO_LIMITS.MAX, ratio),
  );
  if (ratio < STRETCH_RATIO_LIMITS.MIN || ratio > STRETCH_RATIO_LIMITS.MAX) {
    console.warn(
      `[SingingVoice] Stretch ratio ${ratio.toFixed(3)} is outside optimal range ` +
        `[${STRETCH_RATIO_LIMITS.MIN}, ${STRETCH_RATIO_LIMITS.MAX}]; clamping to ${clamped.toFixed(3)}.`,
    );
  }
  return clamped;
}

/** Configuration for SingingVoice initialization */
export interface SingingVoiceConfig {
  /** Use high quality (Finer engine) - higher CPU, better quality */
  useHighQuality?: boolean;
  /** Preserve formants to avoid chipmunk effect (default: true) */
  preserveFormants?: boolean;
  /** Number of audio channels (default: 1 for mono voice) */
  channels?: number;
  /** Buffer size for ring buffers (default: 16384) */
  bufferSize?: number;
  /** Enable phoneme-aware time stretching (Section 3, default: false) */
  enablePhonemeStretching?: boolean;
  /** Enable formant shifting for vocal character (Section 4, default: false) */
  enableFormantShifting?: boolean;
  /** Target voice character for formant shifting (default: 'default') */
  voiceCharacter?: VoiceCharacter;
  /** Phoneme aligner service URL (optional, uses local if not provided) */
  phonemeAlignerUrl?: string;
}
