/**
 * Phoneme elasticity (Vocal Workstation plan, Phase 5): a per-phoneme
 * "squish / stretch" weight the painter stores on PhonemeData.elasticity.
 *
 * Elasticity redistributes time inside the note rather than changing its
 * length: a phoneme at 1.5 takes a bigger share of the note and the others
 * give it up. The result is written to stride slot 3 of the phoneme buffer
 * (see src/audio-worklets/rubberband/phonemeData.ts), where the worklet
 * multiplies it into that phoneme's stretch ratio.
 */

import type { PhonemeData } from '@/types';
import type { PhonemeSegment } from './alignment/types';

export const ELASTICITY_MIN = 0.5;
export const ELASTICITY_MAX = 1.5;
export const ELASTICITY_DEFAULT = 1.0;

export function clampElasticity(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return ELASTICITY_DEFAULT;
  return Math.min(ELASTICITY_MAX, Math.max(ELASTICITY_MIN, value));
}

/**
 * Pairs each aligned segment (seconds) with the painter phoneme (0..1 of the
 * sample) under its midpoint. Painter phonemes can be added, moved or deleted,
 * so matching by index drifts; matching by time does not. Without a usable
 * duration it falls back to index order.
 */
export function matchUserPhonemes(
  segments: readonly PhonemeSegment[],
  userPhonemes: readonly PhonemeData[] | undefined,
  durationSec: number,
): (PhonemeData | undefined)[] {
  if (!userPhonemes || userPhonemes.length === 0) return segments.map(() => undefined);
  if (!(durationSec > 0)) return segments.map((_, i) => userPhonemes[i]);

  return segments.map((segment) => {
    const mid = (segment.start + segment.end) / 2 / durationSec;
    return userPhonemes.find((p) => mid >= p.start && (mid < p.end || (p.end >= 1 && mid <= 1)));
  });
}

/**
 * Slot-3 values: each phoneme's elasticity times one note-wide factor that
 * keeps Σ duration × ratio × slot unchanged, so the note still fills its step
 * length. All-1 elasticity (or no ratios) leaves every slot at exactly 1.
 */
export function elasticityScales(
  segments: readonly PhonemeSegment[],
  ratios: readonly number[] | undefined,
  elasticities: readonly number[],
): number[] {
  if (elasticities.every((e) => e === ELASTICITY_DEFAULT)) return elasticities.slice();
  if (!ratios || ratios.length !== segments.length) return elasticities.slice();

  let fitted = 0;
  let weighted = 0;
  for (let i = 0; i < segments.length; i++) {
    const stretched = (segments[i].end - segments[i].start) * (ratios[i] || 1.0);
    fitted += stretched;
    weighted += stretched * elasticities[i];
  }
  const k = weighted > 0 ? fitted / weighted : 1.0;
  return elasticities.map((e) => e * k);
}
