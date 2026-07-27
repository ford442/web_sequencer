/**
 * Thin API + worker pool for offline 303 rendering (Phase-1 / #974).
 *
 * ```ts
 * const buf = await render303Offline('stock-open303', pattern, {
 *   oversample: 4,
 *   threadCount: 4,
 * });
 * ```
 *
 * Real-time AudioWorklet path is never used. Telemetry records
 * offlineRenderThreadCount / offlineRenderOversample / offlineRenderLatencyMs.
 */

import { engineTelemetry } from '@/utils/engineTelemetry';
import {
  bufferHasNonFinite,
  clampOversample,
  mixVoiceBuffersJs,
  renderOffline303Pattern,
  type Offline303PatternData,
  type OversampleFactor,
} from '@/audio/offline/OfflineOpen303Engine';

export type { Offline303PatternData, OversampleFactor };
export type { Offline303Params, Offline303Step } from '@/audio/offline/OfflineOpen303Engine';

export interface Offline303VoiceJob {
  modelId: string;
  pattern: Offline303PatternData;
  gain?: number;
}

export interface Render303OfflineOptions {
  oversample?: OversampleFactor;
  threadCount?: number;
  sampleRate?: number;
  blockSize?: number;
  /** Prefer in-process render (no Worker) — used by unit tests / SSR. */
  sync?: boolean;
}

export interface Offline303RenderMeta {
  buffer: Float32Array;
  latencyMs: number;
  threadCount: number;
  oversample: OversampleFactor;
}

type Pending = {
  resolve: (meta: Offline303RenderMeta) => void;
  reject: (err: Error) => void;
};

class Offline303WorkerPool {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Array<{
    workerMsg: unknown;
    pending: Pending;
  }> = [];
  private pendingById = new Map<string, Pending>();
  private nextId = 1;
  private size: number;

  constructor(size?: number) {
    const hw =
      typeof navigator !== 'undefined' && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 2;
    this.size = Math.max(1, Math.min(4, size ?? Math.min(4, hw)));
  }

  private ensureWorkers(): void {
    if (typeof Worker === 'undefined') {
      throw new Error('Worker API unavailable');
    }
    while (this.workers.length < this.size) {
      // Vite worker URL import
      const worker = new Worker(
        new URL('../workers/Offline303Renderer.worker.ts', import.meta.url),
        { type: 'module' },
      );
      worker.onmessage = (ev: MessageEvent) => this.onMessage(worker, ev);
      worker.onerror = (ev: ErrorEvent) => {
        // Reject all pending for this worker path
        for (const [, p] of this.pendingById) {
          p.reject(new Error(ev.message || 'Offline303 worker error'));
        }
        this.pendingById.clear();
      };
      this.workers.push(worker);
      this.idle.push(worker);
    }
  }

  private onMessage(worker: Worker, ev: MessageEvent): void {
    const data = ev.data as {
      type: string;
      requestId: string;
      buffer?: Float32Array;
      latencyMs?: number;
      threadCount?: number;
      oversample?: OversampleFactor;
      error?: string;
    };
    const pending = this.pendingById.get(data.requestId);
    if (!pending) {
      this.idle.push(worker);
      this.drain();
      return;
    }
    this.pendingById.delete(data.requestId);
    this.idle.push(worker);

    if (data.type === 'error') {
      pending.reject(new Error(data.error || 'Offline303 render failed'));
    } else if (data.buffer) {
      pending.resolve({
        buffer: data.buffer,
        latencyMs: data.latencyMs ?? 0,
        threadCount: data.threadCount ?? 1,
        oversample: clampOversample(data.oversample),
      });
    } else {
      pending.reject(new Error('Offline303 worker returned empty buffer'));
    }
    this.drain();
  }

  private drain(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const job = this.queue.shift()!;
      const worker = this.idle.pop()!;
      const requestId = `r${this.nextId++}`;
      this.pendingById.set(requestId, job.pending);
      worker.postMessage({ ...(job.workerMsg as object), requestId });
    }
  }

  submit(workerMsg: Record<string, unknown>): Promise<Offline303RenderMeta> {
    this.ensureWorkers();
    return new Promise((resolve, reject) => {
      this.queue.push({ workerMsg, pending: { resolve, reject } });
      this.drain();
    });
  }

  getPoolSize(): number {
    return this.size;
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
    this.queue = [];
    this.pendingById.clear();
  }
}

let pool: Offline303WorkerPool | null = null;

function getPool(threadCount?: number): Offline303WorkerPool {
  if (!pool) {
    pool = new Offline303WorkerPool(threadCount);
  }
  return pool;
}

function recordTelemetry(meta: {
  threadCount: number;
  oversample: OversampleFactor;
  latencyMs: number;
}): void {
  try {
    engineTelemetry.recordOfflineRender({
      threadCount: meta.threadCount,
      oversample: meta.oversample,
      latencyMs: meta.latencyMs,
    });
  } catch {
    /* telemetry must never break render */
  }
}

function syncRender(
  modelId: string,
  pattern: Offline303PatternData,
  options: Render303OfflineOptions,
): Offline303RenderMeta {
  const t0 =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  const oversample = clampOversample(options.oversample);
  const threadCount = Math.max(1, options.threadCount ?? 1);
  const buffer = renderOffline303Pattern(modelId, pattern, {
    oversample,
    sampleRate: options.sampleRate,
    blockSize: options.blockSize,
  });
  if (bufferHasNonFinite(buffer)) {
    throw new Error('Non-finite samples in sync offline 303 render');
  }
  const t1 =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  return { buffer, latencyMs: t1 - t0, threadCount, oversample };
}

/**
 * Render a 303 pattern offline at the requested oversample factor.
 * Returns the mono Float32 buffer at the base sample rate.
 */
export async function render303Offline(
  modelId: string,
  pattern: Offline303PatternData,
  options: Render303OfflineOptions = {},
): Promise<Float32Array> {
  const meta = await render303OfflineWithMeta(modelId, pattern, options);
  return meta.buffer;
}

/** Same as render303Offline but also returns latency / thread / oversample. */
export async function render303OfflineWithMeta(
  modelId: string,
  pattern: Offline303PatternData,
  options: Render303OfflineOptions = {},
): Promise<Offline303RenderMeta> {
  if (options.sync || typeof Worker === 'undefined') {
    const meta = syncRender(modelId, pattern, options);
    recordTelemetry(meta);
    return meta;
  }

  try {
    const p = getPool(options.threadCount);
    const meta = await p.submit({
      type: 'render',
      modelId,
      pattern,
      options: {
        oversample: options.oversample,
        threadCount: options.threadCount ?? p.getPoolSize(),
        sampleRate: options.sampleRate,
        blockSize: options.blockSize,
      },
    });
    recordTelemetry(meta);
    return meta;
  } catch {
    // Worker failed (happy-dom / test env) — fall back to sync
    const meta = syncRender(modelId, pattern, options);
    recordTelemetry(meta);
    return meta;
  }
}

/**
 * Render lead + bass1 + bass2 concurrently (independent engine instances)
 * and mix. Verifies no NaNs under multi-voice load.
 */
export async function render303OfflineMulti(
  voices: Array<{ modelId: string; pattern: Offline303PatternData; gain?: number }>,
  options: Render303OfflineOptions = {},
): Promise<Float32Array> {
  const meta = await render303OfflineMultiWithMeta(voices, options);
  return meta.buffer;
}

export async function render303OfflineMultiWithMeta(
  voices: Array<{ modelId: string; pattern: Offline303PatternData; gain?: number }>,
  options: Render303OfflineOptions = {},
): Promise<Offline303RenderMeta> {
  if (!voices.length) {
    throw new Error('render303OfflineMulti requires at least one voice');
  }

  if (options.sync || typeof Worker === 'undefined') {
    const t0 =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const oversample = clampOversample(options.oversample);
    const threadCount = Math.max(1, options.threadCount ?? voices.length);
    const rendered = voices.map((v) =>
      renderOffline303Pattern(v.modelId, v.pattern, {
        oversample,
        sampleRate: options.sampleRate,
        blockSize: options.blockSize,
      }),
    );
    const buffer = mixVoiceBuffersJs(
      rendered,
      voices.map((v) => v.gain ?? 1),
    );
    if (bufferHasNonFinite(buffer)) {
      throw new Error('Non-finite samples in multi-voice offline 303 render');
    }
    const t1 =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const meta = { buffer, latencyMs: t1 - t0, threadCount, oversample };
    recordTelemetry(meta);
    return meta;
  }

  try {
    const p = getPool(options.threadCount);
    const meta = await p.submit({
      type: 'render-multi',
      voices: voices as Offline303VoiceJob[],
      options: {
        oversample: options.oversample,
        threadCount: options.threadCount ?? p.getPoolSize(),
        sampleRate: options.sampleRate,
        blockSize: options.blockSize,
      },
    });
    recordTelemetry(meta);
    return meta;
  } catch {
    return render303OfflineMultiWithMeta(voices, { ...options, sync: true });
  }
}

/** Test / shutdown helper. */
export function terminateOffline303Pool(): void {
  pool?.terminate();
  pool = null;
}

/** Build a 64-step canonical accent/slide pattern for perf checks. */
export function makeCanonical64StepPattern(
  tempo = 130,
): Offline303PatternData {
  const notes = [36, 36, 39, 43, 36, 41, 39, 36];
  const steps = [];
  for (let i = 0; i < 64; i++) {
    const n = notes[i % notes.length];
    steps.push({
      note: n,
      accent: i % 4 === 1 || i % 4 === 3,
      slide: i % 4 === 1 || i % 4 === 3,
      velocity: i % 4 === 1 || i % 4 === 3 ? 120 : 90,
    });
  }
  return { steps, tempo, params: { cutoff: 0.35, resonance: 0.7, envMod: 0.55, decay: 0.5, accent: 0.7, volume: 0.8 } };
}
