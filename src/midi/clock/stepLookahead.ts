import { readRenderQuantumSize } from '../../utils/audioContextPolicy';
import { STEP_LOOKAHEAD_MARGIN_MS, STEP_LOOKAHEAD_MAX_MS, STEP_LOOKAHEAD_MS } from '../../shared/rt/clock';

/** The latency members the lookahead reads; a fake context in tests supplies just these. */
export type LatencySource = Pick<BaseAudioContext, 'sampleRate'> & {
  baseLatency?: number;
  outputLatency?: number;
  renderQuantumSize?: number;
};

function finiteSec(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Step lookahead (ms) for the live context:
 * clamp(baseLatency + outputLatency + margin, STEP_LOOKAHEAD_MS, STEP_LOOKAHEAD_MAX_MS).
 * When the context exposes `renderQuantumSize`, the result also covers one
 * quantum plus the margin, so a step posted early still lands inside the block
 * it names. Used by both the clock worklet and the main-thread fallback.
 */
export function deriveStepLookaheadMs(
  context: LatencySource,
  renderQuantumSize: number | null = readRenderQuantumSize(context as BaseAudioContext),
): number {
  const latencyMs = (finiteSec(context.baseLatency) + finiteSec(context.outputLatency)) * 1000;
  let ms = latencyMs + STEP_LOOKAHEAD_MARGIN_MS;
  if (renderQuantumSize != null && context.sampleRate > 0) {
    ms = Math.max(ms, (renderQuantumSize / context.sampleRate) * 1000 + STEP_LOOKAHEAD_MARGIN_MS);
  }
  return Math.min(STEP_LOOKAHEAD_MAX_MS, Math.max(STEP_LOOKAHEAD_MS, ms));
}
