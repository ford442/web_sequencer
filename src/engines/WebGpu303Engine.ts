/**
 * WebGPU TB-303 authenticity-tier engine (Phase-3 / #976).
 *
 * Offline / freeze / export / multisample only. Never runs on AudioWorklet.
 *
 * Fallback chain (epic principle):
 *   GPU high-fid → highfid-cpu → stock Open303 / JC-303 → JS
 *
 * Reuses WebGpuOscillator-style size-bucket buffer pooling and the same
 * diode-ladder topology as OfflineHighFid303Engine for spectrogram A/B.
 */

/// <reference types="@webgpu/types" />

import {
  clampOversample,
  type Offline303Params,
  type Offline303PatternData,
  type OversampleFactor,
  DEFAULT_OFFLINE_303_PARAMS,
  bufferHasNonFinite,
} from '@/audio/offline/OfflineOpen303Engine';
import { renderOfflineHighFid303Pattern } from '@/audio/offline/OfflineHighFid303Engine';
import {
  VOICE_303_WGSL,
  VOICE_303_UNIFORM_BYTES,
  NOTE_EVENT_BYTES,
} from '@/webgpu/shaders/303Voice.wgsl';
import { engineTelemetry, logEngineFallback } from '@/utils/engineTelemetry';
import { probeWebGPU } from '@/engines/backends/webgpuProbe';

export const GPU_HIGHFID_MODEL_ID = 'gpu-highfid' as const;

export function isGpuHighFidModel(modelId: string): boolean {
  return modelId === GPU_HIGHFID_MODEL_ID || modelId === 'gpu-highfid';
}

export interface WebGpu303RenderOptions {
  oversample?: OversampleFactor;
  sampleRate?: number;
  /** Prefer CPU highfid immediately (tests / forced fallback). */
  forceCpuFallback?: boolean;
  /** Abort GPU path if estimated latency budget exceeded (ms). Soft hint only. */
  maxLatencyMs?: number;
}

export interface WebGpu303RenderMeta {
  buffer: Float32Array;
  latencyMs: number;
  oversample: OversampleFactor;
  usedGpu: boolean;
  fallbackReason: string | null;
  readbackBytes: number;
}

export type WebGpu303Params = Offline303Params;

type PooledBuffers = { output: GPUBuffer; read: GPUBuffer };

/**
 * Host-side WebGPU 303 renderer.
 *
 * Async API: `render303(params, lengthSamples, options?)` and pattern helper
 * `renderPattern(...)`. Both fall back to highfid-cpu when WebGPU is missing
 * or dispatch/readback fails.
 */
export class WebGpu303Engine {
  device: GPUDevice | null = null;
  adapter: GPUAdapter | null = null;
  pipeline: GPUComputePipeline | null = null;
  bindGroupLayout: GPUBindGroupLayout | null = null;
  isSupported = false;
  private initPromise: Promise<boolean> | null = null;
  private params: WebGpu303Params = { ...DEFAULT_OFFLINE_303_PARAMS };

  private bufferPool: Map<number, PooledBuffers[]> = new Map();
  private readonly MAX_POOL_SIZE_PER_BUCKET = 4;
  private readonly SIZE_BUCKET_BYTES = 4096;
  /** ~30 s @ 48 kHz mono — guard against OOM on huge freeze bounces. */
  private readonly MAX_BUFFER_SIZE = 48_000 * 30 * 4;

  private lastFallbackReason: string | null = null;

  async init(): Promise<boolean> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<boolean> {
    const probe = await probeWebGPU();
    if (!probe.ok || !probe.device || !probe.adapterHandle) {
      this.lastFallbackReason = probe.reason ?? 'navigator.gpu unavailable';
      logEngineFallback(
        'gpu-highfid',
        'webgpu',
        this.lastFallbackReason,
      );
      try {
        engineTelemetry.recordGpu303Render({
          latencyMs: 0,
          readbackBytes: 0,
          fallbackReason: this.lastFallbackReason,
          usedGpu: false,
        });
      } catch {
        /* telemetry optional */
      }
      return false;
    }

    try {
      this.adapter = probe.adapterHandle;
      this.device = probe.device;
      const module = this.device.createShaderModule({ code: VOICE_303_WGSL });

      // Surface compile errors early (Chrome / Edge).
      if (typeof module.getCompilationInfo === 'function') {
        const info = await module.getCompilationInfo();
        const errors = info.messages.filter((m) => m.type === 'error');
        if (errors.length > 0) {
          const msg = errors.map((e) => e.message).join('; ');
          this.lastFallbackReason = `WGSL compile error: ${msg}`;
          logEngineFallback('gpu-highfid', 'webgpu', this.lastFallbackReason);
          this.device = null;
          return false;
        }
      }

      this.bindGroupLayout = this.device.createBindGroupLayout({
        entries: [
          {
            binding: 0,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'uniform' },
          },
          {
            binding: 1,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'read-only-storage' },
          },
          {
            binding: 2,
            visibility: GPUShaderStage.COMPUTE,
            buffer: { type: 'storage' },
          },
        ],
      });

      this.pipeline = this.device.createComputePipeline({
        layout: this.device.createPipelineLayout({
          bindGroupLayouts: [this.bindGroupLayout],
        }),
        compute: { module, entryPoint: 'render303' },
      });

      this.isSupported = true;
      this.lastFallbackReason = null;
      try {
        engineTelemetry.registerResolution('gpu-highfid', 'webgpu', 'device-ready');
      } catch {
        /* optional */
      }
      return true;
    } catch (e) {
      this.lastFallbackReason =
        e instanceof Error ? e.message : 'GPUDevice / pipeline creation failed';
      logEngineFallback('gpu-highfid', 'webgpu', this.lastFallbackReason, e);
      this.isSupported = false;
      this.device = null;
      this.pipeline = null;
      return false;
    }
  }

  setParams(partial: Partial<WebGpu303Params>): void {
    this.params = { ...this.params, ...partial };
  }

  getParams(): WebGpu303Params {
    return { ...this.params };
  }

  getLastFallbackReason(): string | null {
    return this.lastFallbackReason;
  }

  private getSizeBucket(size: number): number {
    return Math.ceil(size / this.SIZE_BUCKET_BYTES) * this.SIZE_BUCKET_BYTES;
  }

  private acquireBuffers(size: number): PooledBuffers | null {
    if (!this.device) return null;
    const bucket = this.getSizeBucket(size);
    const pool = this.bufferPool.get(bucket);
    if (pool && pool.length > 0) return pool.pop()!;
    try {
      const output = this.device.createBuffer({
        size: bucket,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      const read = this.device.createBuffer({
        size: bucket,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });
      return { output, read };
    } catch (e) {
      logEngineFallback('gpu-highfid', 'webgpu', 'GPUBuffer allocation failed', e);
      return null;
    }
  }

  private releaseBuffers(buffers: PooledBuffers, size: number): void {
    const bucket = this.getSizeBucket(size);
    let pool = this.bufferPool.get(bucket);
    if (!pool) {
      pool = [];
      this.bufferPool.set(bucket, pool);
    }
    if (pool.length < this.MAX_POOL_SIZE_PER_BUCKET) {
      pool.push(buffers);
    } else {
      buffers.output.destroy();
      buffers.read.destroy();
    }
  }

  destroy(): void {
    for (const pool of this.bufferPool.values()) {
      for (const b of pool) {
        b.output.destroy();
        b.read.destroy();
      }
    }
    this.bufferPool.clear();
    try {
      this.device?.destroy?.();
    } catch {
      /* ignore */
    }
    this.device = null;
    this.pipeline = null;
    this.bindGroupLayout = null;
    this.isSupported = false;
    this.initPromise = null;
  }

  private packUniforms(
    sampleRate: number,
    numSamples: number,
    oversample: number,
    numEvents: number,
    params: WebGpu303Params,
  ): ArrayBuffer {
    const buf = new ArrayBuffer(VOICE_303_UNIFORM_BYTES);
    const view = new DataView(buf);
    view.setFloat32(0, sampleRate, true);
    view.setUint32(4, numSamples, true);
    view.setUint32(8, oversample, true);
    view.setUint32(12, numEvents, true);
    view.setFloat32(16, params.waveform, true);
    view.setFloat32(20, params.cutoff, true);
    view.setFloat32(24, params.resonance, true);
    view.setFloat32(28, params.envMod, true);
    view.setFloat32(32, params.decay, true);
    view.setFloat32(36, params.accent, true);
    view.setFloat32(40, params.volume, true);
    view.setFloat32(44, params.slideTime, true);
    view.setFloat32(48, params.accentDecay, true);
    view.setFloat32(52, params.squareDrv, true);
    return buf;
  }

  private packEvents(
    events: Array<{
      startSample: number;
      midiNote: number;
      velocity: number;
      slide: boolean;
    }>,
  ): ArrayBuffer {
    const n = Math.max(1, events.length);
    const buf = new ArrayBuffer(n * NOTE_EVENT_BYTES);
    const view = new DataView(buf);
    if (events.length === 0) {
      // Dummy event so storage buffer is non-empty (WGSL array length ≥ 1).
      return buf;
    }
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const o = i * NOTE_EVENT_BYTES;
      view.setUint32(o + 0, e.startSample >>> 0, true);
      view.setFloat32(o + 4, e.midiNote, true);
      view.setFloat32(o + 8, e.velocity, true);
      view.setUint32(o + 12, e.slide ? 1 : 0, true);
    }
    return buf;
  }

  /**
   * Render `lengthSamples` of a sustained note (multisample / one-shot).
   * Async; returns Float32Array or falls back to highfid-cpu.
   */
  async render303(
    params: Partial<WebGpu303Params>,
    lengthSamples: number,
    options: WebGpu303RenderOptions & {
      midiNote?: number;
      velocity?: number;
    } = {},
  ): Promise<Float32Array> {
    const meta = await this.render303WithMeta(params, lengthSamples, options);
    return meta.buffer;
  }

  async render303WithMeta(
    params: Partial<WebGpu303Params>,
    lengthSamples: number,
    options: WebGpu303RenderOptions & {
      midiNote?: number;
      velocity?: number;
    } = {},
  ): Promise<WebGpu303RenderMeta> {
    const sampleRate = options.sampleRate ?? 44100;
    const midiNote = options.midiNote ?? 36;
    const velocity = options.velocity ?? 90;
    const merged = { ...this.params, ...params };
    const pattern: Offline303PatternData = {
      steps: [{ note: midiNote, velocity }],
      stepDurationSec: lengthSamples / sampleRate,
      params: merged,
    };
    return this.renderPatternWithMeta(pattern, options);
  }

  /** Render a sequencer pattern through the GPU (or highfid-cpu fallback). */
  async renderPattern(
    pattern: Offline303PatternData,
    options: WebGpu303RenderOptions = {},
  ): Promise<Float32Array> {
    const meta = await this.renderPatternWithMeta(pattern, options);
    return meta.buffer;
  }

  async renderPatternWithMeta(
    pattern: Offline303PatternData,
    options: WebGpu303RenderOptions = {},
  ): Promise<WebGpu303RenderMeta> {
    const oversample = clampOversample(options.oversample);
    const sampleRate = options.sampleRate ?? 44100;
    const params: WebGpu303Params = {
      ...DEFAULT_OFFLINE_303_PARAMS,
      ...this.params,
      ...pattern.params,
    };

    if (options.forceCpuFallback) {
      return this.cpuFallback(pattern, oversample, sampleRate, 'forced CPU fallback');
    }

    const ok = await this.init();
    if (!ok || !this.device || !this.pipeline || !this.bindGroupLayout) {
      return this.cpuFallback(
        pattern,
        oversample,
        sampleRate,
        this.lastFallbackReason ?? 'WebGPU unavailable',
      );
    }

    try {
      const gpuMeta = await this.dispatchGpu(pattern, params, oversample, sampleRate);
      if (
        options.maxLatencyMs != null &&
        gpuMeta.latencyMs > options.maxLatencyMs
      ) {
        // Soft budget miss — keep GPU result but record reason for HUD.
        this.lastFallbackReason = `gpu latency ${gpuMeta.latencyMs.toFixed(1)}ms > budget ${options.maxLatencyMs}ms (result kept)`;
        try {
          engineTelemetry.recordGpu303Render({
            latencyMs: gpuMeta.latencyMs,
            readbackBytes: gpuMeta.readbackBytes,
            fallbackReason: this.lastFallbackReason,
            usedGpu: true,
          });
        } catch {
          /* optional */
        }
      }
      return gpuMeta;
    } catch (e) {
      const reason =
        e instanceof Error ? e.message : 'GPU dispatch/readback failed';
      logEngineFallback('gpu-highfid', 'webgpu', reason, e);
      return this.cpuFallback(pattern, oversample, sampleRate, reason);
    }
  }

  private cpuFallback(
    pattern: Offline303PatternData,
    oversample: OversampleFactor,
    sampleRate: number,
    reason: string,
  ): WebGpu303RenderMeta {
    this.lastFallbackReason = reason;
    const t0 =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const buffer = renderOfflineHighFid303Pattern(pattern, {
      oversample,
      sampleRate,
    });
    const t1 =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const latencyMs = t1 - t0;
    if (bufferHasNonFinite(buffer)) {
      throw new Error('Non-finite samples in highfid-cpu fallback');
    }
    try {
      engineTelemetry.recordGpu303Render({
        latencyMs,
        readbackBytes: 0,
        fallbackReason: reason,
        usedGpu: false,
      });
      engineTelemetry.registerResolution('gpu-highfid', 'highfid-cpu', reason);
    } catch {
      /* optional */
    }
    return {
      buffer,
      latencyMs,
      oversample,
      usedGpu: false,
      fallbackReason: reason,
      readbackBytes: 0,
    };
  }

  private async dispatchGpu(
    pattern: Offline303PatternData,
    params: WebGpu303Params,
    oversample: OversampleFactor,
    sampleRate: number,
  ): Promise<WebGpu303RenderMeta> {
    const device = this.device!;
    const tempo = pattern.tempo ?? 120;
    const stepDur = pattern.stepDurationSec ?? 60 / tempo / 4;
    const framesPerStep = Math.max(1, Math.round(stepDur * sampleRate));
    const numSamples = framesPerStep * pattern.steps.length;
    const bufferSize = numSamples * 4;

    if (bufferSize > this.MAX_BUFFER_SIZE) {
      throw new Error(
        `gpu-highfid buffer ${bufferSize}B exceeds max ${this.MAX_BUFFER_SIZE}B`,
      );
    }

    const events: Array<{
      startSample: number;
      midiNote: number;
      velocity: number;
      slide: boolean;
    }> = [];
    for (let i = 0; i < pattern.steps.length; i++) {
      const step = pattern.steps[i];
      events.push({
        startSample: i * framesPerStep,
        midiNote: step.note,
        velocity: step.velocity ?? (step.accent ? 120 : 90),
        slide: !!step.slide,
      });
    }

    const t0 =
      typeof performance !== 'undefined' ? performance.now() : Date.now();

    const buffers = this.acquireBuffers(bufferSize);
    if (!buffers) {
      throw new Error('GPUBuffer allocation failed');
    }

    const uniformData = this.packUniforms(
      sampleRate,
      numSamples,
      oversample,
      events.length,
      params,
    );
    const eventData = this.packEvents(events);

    const uniformBuffer = device.createBuffer({
      size: VOICE_303_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const eventBuffer = device.createBuffer({
      size: Math.max(NOTE_EVENT_BYTES, eventData.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(uniformBuffer, 0, uniformData);
    device.queue.writeBuffer(eventBuffer, 0, eventData);

    const bindGroup = device.createBindGroup({
      layout: this.bindGroupLayout!,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: eventBuffer } },
        { binding: 2, resource: { buffer: buffers.output } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline!);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(buffers.output, 0, buffers.read, 0, bufferSize);
    device.queue.submit([encoder.finish()]);

    await buffers.read.mapAsync(GPUMapMode.READ);
    const mapped = new Float32Array(buffers.read.getMappedRange(), 0, numSamples);
    const result = new Float32Array(mapped);
    buffers.read.unmap();

    this.releaseBuffers(buffers, bufferSize);
    uniformBuffer.destroy();
    eventBuffer.destroy();

    const t1 =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    const latencyMs = t1 - t0;
    const readbackBytes = bufferSize;

    if (bufferHasNonFinite(result)) {
      throw new Error('Non-finite samples in GPU 303 render');
    }

    this.lastFallbackReason = null;
    try {
      engineTelemetry.recordGpu303Render({
        latencyMs,
        readbackBytes,
        fallbackReason: null,
        usedGpu: true,
      });
      engineTelemetry.recordLatency('gpu-highfid', latencyMs);
      engineTelemetry.registerResolution('gpu-highfid', 'webgpu', 'render-ok');
    } catch {
      /* optional */
    }

    return {
      buffer: result,
      latencyMs,
      oversample,
      usedGpu: true,
      fallbackReason: null,
      readbackBytes,
    };
  }
}

/** Singleton helper for OfflineRenderer / MultisampleGenerator. */
let sharedEngine: WebGpu303Engine | null = null;

export function getSharedWebGpu303Engine(): WebGpu303Engine {
  if (!sharedEngine) sharedEngine = new WebGpu303Engine();
  return sharedEngine;
}

export function resetSharedWebGpu303Engine(): void {
  sharedEngine?.destroy();
  sharedEngine = null;
}

/**
 * Render via GPU high-fid with automatic highfid-cpu fallback.
 * Preferred entry for freeze / export / MultisampleGenerator.
 */
export async function renderGpuHighFid303(
  pattern: Offline303PatternData,
  options: WebGpu303RenderOptions = {},
): Promise<WebGpu303RenderMeta> {
  return getSharedWebGpu303Engine().renderPatternWithMeta(pattern, options);
}

/**
 * Wrap a mono Float32 render into an AudioBuffer for AudioBufferSourceNode
 * playback (never schedule GPU work on the audio thread).
 */
export function float32ToAudioBuffer(
  ctx: BaseAudioContext,
  samples: Float32Array,
  sampleRate?: number,
): AudioBuffer {
  const sr = sampleRate ?? ctx.sampleRate;
  const buf = ctx.createBuffer(1, samples.length, sr);
  buf.copyToChannel(samples, 0);
  return buf;
}
