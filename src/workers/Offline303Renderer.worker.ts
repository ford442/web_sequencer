/**
 * Offline 303 renderer worker (Phase-1 / #974).
 *
 * Protocol (postMessage):
 *   → { type: 'render', requestId, modelId, pattern, options? }
 *   → { type: 'render-multi', requestId, voices, options? }
 *   ← { type: 'result', requestId, buffer, latencyMs, threadCount, oversample }
 *   ← { type: 'error', requestId, error }
 *
 * Uses the pure-TS OfflineOpen303Engine (oversample 1|2|4). Real-time
 * AudioWorklet path is untouched. Transferable ArrayBuffers carry the result.
 */

import {
  bufferHasNonFinite,
  clampOversample,
  mixVoiceBuffersJs,
  renderOffline303Pattern,
  type Offline303PatternData,
  type OversampleFactor,
} from '../audio/offline/OfflineOpen303Engine';

export interface Offline303RenderOptions {
  oversample?: OversampleFactor;
  threadCount?: number;
  sampleRate?: number;
  blockSize?: number;
}

export interface Offline303VoiceJob {
  modelId: string;
  pattern: Offline303PatternData;
  gain?: number;
}

type Inbound =
  | {
      type: 'render';
      requestId: string;
      modelId: string;
      pattern: Offline303PatternData;
      options?: Offline303RenderOptions;
    }
  | {
      type: 'render-multi';
      requestId: string;
      voices: Offline303VoiceJob[];
      options?: Offline303RenderOptions;
    };

type Outbound =
  | {
      type: 'result';
      requestId: string;
      buffer: Float32Array;
      latencyMs: number;
      threadCount: number;
      oversample: OversampleFactor;
    }
  | {
      type: 'error';
      requestId: string;
      error: string;
    };

function resolveThreadCount(requested: number | undefined): number {
  const hw =
    typeof navigator !== 'undefined' && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4;
  const n = requested ?? hw;
  return Math.max(1, Math.min(16, Math.floor(n)));
}

function renderOne(
  modelId: string,
  pattern: Offline303PatternData,
  options: Offline303RenderOptions | undefined,
): { buffer: Float32Array; oversample: OversampleFactor; threadCount: number } {
  const oversample = clampOversample(options?.oversample);
  const threadCount = resolveThreadCount(options?.threadCount);
  const buffer = renderOffline303Pattern(modelId, pattern, {
    oversample,
    sampleRate: options?.sampleRate,
    blockSize: options?.blockSize,
  });
  return { buffer, oversample, threadCount };
}

self.onmessage = (event: MessageEvent<Inbound>) => {
  const msg = event.data;
  if (!msg || !msg.requestId) return;

  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now();

  try {
    let buffer: Float32Array;
    let oversample: OversampleFactor;
    let threadCount: number;

    if (msg.type === 'render-multi') {
      if (!msg.voices?.length) {
        throw new Error('render-multi requires at least one voice');
      }
      oversample = clampOversample(msg.options?.oversample);
      threadCount = resolveThreadCount(msg.options?.threadCount);

      // Each voice uses a fresh engine instance (independent filter/envelope
      // state) — equivalent to OpenMP-parallel per-voice rendering with
      // thread-local state. Mixing happens after all voices complete.
      const rendered: Float32Array[] = [];
      const gains: number[] = [];
      for (const voice of msg.voices) {
        const part = renderOffline303Pattern(voice.modelId, voice.pattern, {
          oversample,
          sampleRate: msg.options?.sampleRate,
          blockSize: msg.options?.blockSize,
        });
        rendered.push(part);
        gains.push(voice.gain ?? 1);
      }
      buffer = mixVoiceBuffersJs(rendered, gains);
    } else if (msg.type === 'render') {
      const r = renderOne(msg.modelId, msg.pattern, msg.options);
      buffer = r.buffer;
      oversample = r.oversample;
      threadCount = r.threadCount;
    } else {
      throw new Error(`Unknown message type`);
    }

    if (bufferHasNonFinite(buffer)) {
      throw new Error('Non-finite samples (NaN/Inf) in offline 303 render');
    }

    const t1 =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const response: Outbound = {
      type: 'result',
      requestId: msg.requestId,
      buffer,
      latencyMs: t1 - t0,
      threadCount,
      oversample,
    };
    // Transfer the underlying ArrayBuffer to avoid a copy.
    (self as unknown as Worker).postMessage(response, [buffer.buffer]);
  } catch (err) {
    const response: Outbound = {
      type: 'error',
      requestId: msg.requestId,
      error: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(response);
  }
};

export type { Inbound as Offline303WorkerInbound, Outbound as Offline303WorkerOutbound };
