import { createAudioContext, type AudioContextCreateExtras } from '../hooks/audioEngine/audioContextFactory';
import type { LatencyMode } from '../utils/audioLatencyMode';
import type { SampleRatePref } from '../utils/audioContextPolicy';

/**
 * `?e2e=1` probe for tests/audio-context-matrix.spec.ts. Builds a context
 * through the production `createAudioContext` and returns a serialisable
 * record of what the factory reported next to what the live context exposes.
 * Contexts are tracked so the spec can close every one of them.
 */

export interface AudioContextProbeResult {
  requestedSampleRate: number | null;
  actualSampleRate: number;
  contextSampleRate: number;
  sampleRateFallback: string | null;
  requestedRenderSizeHint: 'hardware' | number | null;
  renderQuantumSize: number | null;
  contextRenderQuantumSize: number | null;
  optionFallback: string | null;
  constructorSinkId: string | null;
  /** `context.sinkId` coerced to a string; null when the member is absent. */
  contextSinkId: string | null;
  hasSinkIdMember: boolean;
  hasRenderQuantumMember: boolean;
  stateAfterResume: string;
}

const opened: AudioContext[] = [];

export interface AudioContextProbeRequest {
  latencyHint?: LatencyMode;
  sampleRatePref: SampleRatePref;
  extras?: AudioContextCreateExtras;
}

/** `context.sinkId` as a string: Chromium reports a string, or an AudioSinkInfo object for `{ type: 'none' }`. */
function describeSinkId(sink: unknown): string {
  if (typeof sink === 'string') return sink;
  if (sink && typeof sink === 'object') return 'none';
  return typeof sink === 'number' || typeof sink === 'boolean' ? String(sink) : '';
}

/**
 * Construct + resume synchronously (callers invoke this from a real click
 * listener); only the resume promise is awaited afterwards.
 */
export async function probeAudioContext(req: AudioContextProbeRequest): Promise<AudioContextProbeResult> {
  const creation = createAudioContext(req.latencyHint ?? 'interactive', req.sampleRatePref, req.extras ?? {});
  const ctx = creation.context;
  opened.push(ctx);
  const resumed = ctx.resume().catch(() => undefined);

  const withMembers = ctx as AudioContext & { sinkId?: unknown; renderQuantumSize?: unknown };
  const sink = withMembers.sinkId;
  const contextSinkId = 'sinkId' in ctx ? describeSinkId(sink) : null;

  await resumed;
  return {
    requestedSampleRate: creation.requestedSampleRate,
    actualSampleRate: creation.actualSampleRate,
    contextSampleRate: ctx.sampleRate,
    sampleRateFallback: creation.sampleRateFallback,
    requestedRenderSizeHint: creation.requestedRenderSizeHint,
    renderQuantumSize: creation.renderQuantumSize,
    contextRenderQuantumSize: typeof withMembers.renderQuantumSize === 'number' ? withMembers.renderQuantumSize : null,
    optionFallback: creation.optionFallback,
    constructorSinkId: creation.constructorSinkId,
    contextSinkId,
    hasSinkIdMember: 'sinkId' in ctx,
    hasRenderQuantumMember: 'renderQuantumSize' in ctx,
    stateAfterResume: ctx.state,
  };
}

export async function closeProbeContexts(): Promise<number> {
  const all = opened.splice(0);
  await Promise.all(all.map((c) => (c.state === 'closed' ? Promise.resolve() : c.close().catch(() => undefined))));
  return all.length;
}
