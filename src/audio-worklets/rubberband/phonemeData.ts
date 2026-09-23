/**
 * Tuple layout returned by getPhonemeDataAtSample:
 * [stretchRatio, volume, pitchBendCents, vibratoDepth, vibratoRate, grainJitter, grainSizeMs, isVowel, phonemeIndex]
 * A value of -1.0 in the modulation slots (index 3-6) means "no per-phoneme override".
 * stretchRatio is the phoneme's target-fit ratio times its elasticity.
 */
export type PhonemeSample = Float32Array; // Size 9

/**
 * Determine the phoneme parameters for the current sample position.
 * phonemeData stride is 10 floats: start, end, isVowel, elasticity, volume,
 * pitchBend, vibDepth, vibRate, grainJitter, grainSize — written by
 * PhonemeAligner.createSharedPhonemeBuffer.
 */
const DEFAULT_PHONEME_TUPLE = new Float32Array([1.0, 1.0, 0.0, -1.0, -1.0, -1.0, -1.0, 0.0, -1.0]);

export function getPhonemeDataAtSample(
  phonemeData: Float32Array | null,
  phonemeRatios: number[] | null,
  currentSample: number,
  out: Float32Array
): PhonemeSample {
  if (!phonemeData || !phonemeRatios) {
    out.set(DEFAULT_PHONEME_TUPLE);
    return out;
  }

  const count = phonemeData[0];
  for (let i = 0; i < count; i++) {
    const baseIndex = 1 + i * 10;
    const start = phonemeData[baseIndex];
    const end = phonemeData[baseIndex + 1];

    if (currentSample >= start && currentSample < end) {
      // Elasticity scales this phoneme's share of the note (1 = as aligned).
      const elasticity = phonemeData[baseIndex + 3];
      const ratio = (phonemeRatios[i] || 1.0) * (elasticity > 0 ? elasticity : 1.0);
      const isVowel = phonemeData[baseIndex + 2] !== undefined ? phonemeData[baseIndex + 2] : 0.0;
      const volume = phonemeData[baseIndex + 4] !== undefined ? phonemeData[baseIndex + 4] : 1.0;
      const pitchBend = phonemeData[baseIndex + 5] !== undefined ? phonemeData[baseIndex + 5] : 0.0;
      const vibDepth = phonemeData[baseIndex + 6] !== undefined ? phonemeData[baseIndex + 6] : -1.0;
      const vibRate = phonemeData[baseIndex + 7] !== undefined ? phonemeData[baseIndex + 7] : -1.0;
      const grainJitter = phonemeData[baseIndex + 8] !== undefined ? phonemeData[baseIndex + 8] : -1.0;
      const grainSize = phonemeData[baseIndex + 9] !== undefined ? phonemeData[baseIndex + 9] : -1.0;
      out[0] = ratio;
      out[1] = volume;
      out[2] = pitchBend;
      out[3] = vibDepth;
      out[4] = vibRate;
      out[5] = grainJitter;
      out[6] = grainSize;
      out[7] = isVowel;
      out[8] = i; // Phoneme index
      return out;
    }
  }
  out.set(DEFAULT_PHONEME_TUPLE);
  return out;
}
