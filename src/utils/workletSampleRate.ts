import { reportWorkletSampleRateFallback } from '../audio-worklets/workletPerfReporter';

export const WORKLET_FALLBACK_SAMPLE_RATE = 44100;

/**
 * Resolve AudioWorkletGlobalScope.sampleRate, falling back to 44100 only when
 * the ambient rate is missing (tests / non-worklet hosts). Never use this to
 * resample inside process() — assets must already match the live context rate.
 *
 * A missing rate means the processor is not running inside a real worklet, so
 * the fallback is logged once through WorkletPerfReporter rather than silent.
 */
export function resolveWorkletSampleRate(scope?: { sampleRate?: number }): number {
  const rate = (scope ?? (globalThis as { sampleRate?: number })).sampleRate;
  if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
    return rate;
  }
  reportWorkletSampleRateFallback('resolveWorkletSampleRate', WORKLET_FALLBACK_SAMPLE_RATE);
  return WORKLET_FALLBACK_SAMPLE_RATE;
}
