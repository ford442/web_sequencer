/**
 * Tuple layout returned by getPhonemeDataAtSample:
 * [stretchRatio, volume, pitchBendCents, vibratoDepth, vibratoRate, grainJitter, grainSizeMs, isVowel]
 * A value of -1.0 in the modulation slots (index 3-6) means "no per-phoneme override".
 */
export type PhonemeSample = [number, number, number, number, number, number, number, number];

const DEFAULT_PHONEME_SAMPLE: PhonemeSample = [1.0, 1.0, 0.0, -1.0, -1.0, -1.0, -1.0, 0.0];

/**
 * Determine the phoneme parameters for the current sample position.
 * phonemeData stride is 10 floats: start, end, isVowel, stretch(unused), volume,
 * pitchBend, vibDepth, vibRate, grainJitter, grainSize.
 */
export function getPhonemeDataAtSample(
  phonemeData: Float32Array | null,
  phonemeRatios: number[] | null,
  currentSample: number
): PhonemeSample {
  if (!phonemeData || !phonemeRatios) return DEFAULT_PHONEME_SAMPLE;

  const count = phonemeData[0];
  for (let i = 0; i < count; i++) {
    const baseIndex = 1 + i * 10;
    const start = phonemeData[baseIndex];
    const end = phonemeData[baseIndex + 1];

    if (currentSample >= start && currentSample < end) {
      const ratio = phonemeRatios[i] || 1.0;
      const isVowel = phonemeData[baseIndex + 2] !== undefined ? phonemeData[baseIndex + 2] : 0.0;
      const volume = phonemeData[baseIndex + 4] !== undefined ? phonemeData[baseIndex + 4] : 1.0;
      const pitchBend = phonemeData[baseIndex + 5] !== undefined ? phonemeData[baseIndex + 5] : 0.0;
      const vibDepth = phonemeData[baseIndex + 6] !== undefined ? phonemeData[baseIndex + 6] : -1.0;
      const vibRate = phonemeData[baseIndex + 7] !== undefined ? phonemeData[baseIndex + 7] : -1.0;
      const grainJitter = phonemeData[baseIndex + 8] !== undefined ? phonemeData[baseIndex + 8] : -1.0;
      const grainSize = phonemeData[baseIndex + 9] !== undefined ? phonemeData[baseIndex + 9] : -1.0;
      return [ratio, volume, pitchBend, vibDepth, vibRate, grainJitter, grainSize, isVowel];
    }
  }
  return DEFAULT_PHONEME_SAMPLE;
}
