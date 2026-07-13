/**
 * TB-303 parameter conversion helpers (exponential curves).
 */

/** Convert RBS cutoff (0-127) to Hz using exponential curve. */
export function convertCutoffToHz(rbsCutoff: number): number {
  const clampedCutoff = Math.max(0, Math.min(127, rbsCutoff));
  return 100 * Math.pow(2, clampedCutoff / 21.17);
}

/** Convert RBS resonance (0-127) to Hyphon resonance (0-20). */
export function convertResonance(rbsResonance: number): number {
  const clampedResonance = Math.max(0, Math.min(127, rbsResonance));
  return clampedResonance / 6.35;
}

/** Convert RBS decay (0-127) to seconds using exponential curve. */
export function convertDecayToSeconds(rbsDecay: number): number {
  const clampedDecay = Math.max(0, Math.min(127, rbsDecay));
  return 0.05 * Math.pow(40, clampedDecay / 127);
}

/** Convert RBS accent (0-127) to velocity boost (0-0.4). */
export function convertAccentToBoost(rbsAccent: number): number {
  const clampedAccent = Math.max(0, Math.min(127, rbsAccent));
  return clampedAccent / 317.5;
}

/** Map a value from one range to another (linear). */
export function mapRange(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const clampedValue = Math.max(inMin, Math.min(inMax, value));
  return ((clampedValue - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}
