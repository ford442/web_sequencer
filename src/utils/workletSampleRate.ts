/**
 * Resolve AudioWorkletGlobalScope.sampleRate, falling back to 44100 only when
 * the ambient rate is missing (tests / non-worklet hosts). Never use this to
 * resample inside process() — assets must already match the live context rate.
 */
export function resolveWorkletSampleRate(scope?: { sampleRate?: number }): number {
  const rate = (scope ?? (globalThis as { sampleRate?: number })).sampleRate;
  if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
    return rate;
  }
  return 44100;
}
