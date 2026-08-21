/**
 * Phase-3 (#976) gpu-highfid WebGPU 303 voice engine tests.
 *
 * happy-dom has no WebGPU — verifies graceful fallback to highfid-cpu,
 * registry offline-only entry, deterministic output, and telemetry hooks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  GPU_HIGHFID_MODEL_ID,
  WebGpu303Engine,
  isGpuHighFidModel,
  renderGpuHighFid303,
  resetSharedWebGpu303Engine,
  float32ToAudioBuffer,
} from '@/engines/WebGpu303Engine';
import { VOICE_303_WGSL } from '@/webgpu/shaders/303Voice.wgsl';
import { bufferHasNonFinite } from '@/audio/offline/OfflineOpen303Engine';
import { renderOfflineHighFid303Pattern } from '@/audio/offline/OfflineHighFid303Engine';
import {
  makeCanonical64StepPattern,
  render303OfflineWithMeta,
  terminateOffline303Pool,
} from '@/audio/OfflineRenderer';
import {
  getAvailableTB303Models,
  getTB303Model,
  normalizeTB303Model,
  resolveRealtimeTB303Model,
  tb303ModelFamily,
} from '@/engines/TB303Models';
import { EngineTelemetry } from '@/utils/engineTelemetry';
import { resetWebGpuProbeForTests } from '@/engines/backends/webgpuProbe';

describe('gpu-highfid registry', () => {
  it('is catalogued as offline-only highfid family', () => {
    const m = getTB303Model('gpu-highfid');
    expect(m).toMatchObject({
      id: 'gpu-highfid',
      family: 'highfid',
      available: true,
      offlineOnly: true,
    });
    expect(tb303ModelFamily('gpu-highfid')).toBe('highfid');
  });

  it('is hidden from realtime selector by default', () => {
    expect(getAvailableTB303Models().some((m) => m.id === 'gpu-highfid')).toBe(
      false,
    );
    expect(
      getAvailableTB303Models({ includeOfflineOnly: true }).some(
        (m) => m.id === 'gpu-highfid',
      ),
    ).toBe(true);
  });

  it('resolveRealtimeTB303Model falls back to stock for offline-only voices', () => {
    expect(resolveRealtimeTB303Model('gpu-highfid')).toBe('stock-open303');
  });

  it('normalizeTB303Model preserves gpu-highfid for persistence', () => {
    expect(normalizeTB303Model('gpu-highfid', undefined, { reportFallback: false })).toBe('gpu-highfid');
  });
});

describe('WGSL 303 shader source', () => {
  it('exports a non-empty WGSL module with expected entry points', () => {
    expect(VOICE_303_WGSL.length).toBeGreaterThan(500);
    expect(VOICE_303_WGSL).toContain('fn render303');
    expect(VOICE_303_WGSL).toContain('diodeShape');
    expect(VOICE_303_WGSL).toContain('polyBlep');
    expect(VOICE_303_WGSL).toContain('@compute');
    expect(VOICE_303_WGSL).toContain('workgroup_size(1)');
  });
});

describe('WebGpu303Engine fallback', () => {
  beforeEach(() => {
    resetWebGpuProbeForTests();
  });
  afterEach(() => {
    resetSharedWebGpu303Engine();
    resetWebGpuProbeForTests();
  });

  it('identifies gpu model ids', () => {
    expect(isGpuHighFidModel(GPU_HIGHFID_MODEL_ID)).toBe(true);
    expect(isGpuHighFidModel('gpu-highfid')).toBe(true);
    expect(isGpuHighFidModel('highfid-cpu')).toBe(false);
  });

  it('falls back to highfid-cpu without crashing when WebGPU is missing', async () => {
    const eng = new WebGpu303Engine();
    const ok = await eng.init();
    // happy-dom: no navigator.gpu
    expect(ok).toBe(false);
    expect(eng.isSupported).toBe(false);

    const pattern = {
      steps: [
        { note: 36, velocity: 90 },
        { note: 36, accent: true, slide: true, velocity: 120 },
        { note: 39, velocity: 90 },
        { note: 43, accent: true, slide: true, velocity: 120 },
      ],
      stepDurationSec: 0.15,
      params: {
        cutoff: 0.35,
        resonance: 0.7,
        envMod: 0.55,
        decay: 0.5,
        accent: 0.7,
        volume: 0.8,
      },
    };

    const meta = await eng.renderPatternWithMeta(pattern, { oversample: 1 });
    expect(meta.usedGpu).toBe(false);
    expect(meta.fallbackReason).toBeTruthy();
    expect(bufferHasNonFinite(meta.buffer)).toBe(false);
    expect(meta.buffer.length).toBeGreaterThan(100);

    const cpu = renderOfflineHighFid303Pattern(pattern, { oversample: 1 });
    expect(meta.buffer.length).toBe(cpu.length);
    for (let i = 0; i < cpu.length; i++) {
      expect(meta.buffer[i]).toBe(cpu[i]);
    }
    eng.destroy();
  });

  it('forceCpuFallback yields deterministic bit-identical output', async () => {
    const pattern = {
      steps: [
        { note: 36, velocity: 90 },
        { note: 43, accent: true, velocity: 120 },
      ],
      stepDurationSec: 0.1,
      params: { cutoff: 0.4, resonance: 0.65, volume: 0.8 },
    };
    const a = await renderGpuHighFid303(pattern, {
      oversample: 2,
      forceCpuFallback: true,
    });
    const b = await renderGpuHighFid303(pattern, {
      oversample: 2,
      forceCpuFallback: true,
    });
    expect(a.usedGpu).toBe(false);
    expect(a.buffer.length).toBe(b.buffer.length);
    for (let i = 0; i < a.buffer.length; i++) {
      expect(a.buffer[i]).toBe(b.buffer[i]);
    }
  });

  it('render303 sustained note API works via fallback', async () => {
    const eng = new WebGpu303Engine();
    const buf = await eng.render303(
      { cutoff: 0.3, resonance: 0.5, volume: 0.7 },
      4410,
      { forceCpuFallback: true, midiNote: 40, velocity: 100 },
    );
    expect(buf.length).toBe(4410);
    expect(bufferHasNonFinite(buf)).toBe(false);
    eng.destroy();
  });

  it('float32ToAudioBuffer builds a playable AudioBuffer', () => {
    const samples = new Float32Array(128);
    samples[0] = 0.5;
    const channel = new Float32Array(128);
    const ctx = {
      sampleRate: 44100,
      createBuffer: (_ch: number, length: number, _sr: number) => ({
        length,
        numberOfChannels: 1,
        sampleRate: 44100,
        copyToChannel: (src: Float32Array, _c: number) => {
          channel.set(src);
        },
        getChannelData: () => channel,
      }),
    } as unknown as BaseAudioContext;
    const audioBuf = float32ToAudioBuffer(ctx, samples, 44100);
    expect(audioBuf.length).toBe(128);
    expect(audioBuf.numberOfChannels).toBe(1);
    expect(audioBuf.getChannelData(0)[0]).toBeCloseTo(0.5);
  });
});

describe('render303Offline gpu-highfid path', () => {
  beforeEach(() => {
    terminateOffline303Pool();
    resetSharedWebGpu303Engine();
    resetWebGpuProbeForTests();
  });

  afterEach(() => {
    terminateOffline303Pool();
    resetSharedWebGpu303Engine();
  });

  it('renders via OfflineRenderer (CPU fallback in test env)', async () => {
    const pattern = makeCanonical64StepPattern(130);
    const meta = await render303OfflineWithMeta('gpu-highfid', pattern, {
      oversample: 2,
      sync: true,
    });
    expect(meta.oversample).toBe(2);
    expect(meta.buffer.length).toBeGreaterThan(10_000);
    expect(bufferHasNonFinite(meta.buffer)).toBe(false);
    expect(meta.latencyMs).toBeLessThan(8_000);
  });

  it('async path also falls back gracefully', async () => {
    const pattern = {
      steps: [
        { note: 36, velocity: 90 },
        { note: 39, accent: true, slide: true, velocity: 120 },
      ],
      stepDurationSec: 0.12,
      params: { cutoff: 0.35, resonance: 0.7, volume: 0.8 },
    };
    const meta = await render303OfflineWithMeta('gpu-highfid', pattern, {
      oversample: 1,
    });
    expect(bufferHasNonFinite(meta.buffer)).toBe(false);
    expect(meta.buffer.length).toBeGreaterThan(100);
  });
});

describe('gpu-highfid telemetry', () => {
  it('recordGpu303Render populates runtime snapshot fields', () => {
    const t = new EngineTelemetry();
    t.recordGpu303Render({
      latencyMs: 42.5,
      readbackBytes: 176400,
      fallbackReason: 'navigator.gpu unavailable',
      usedGpu: false,
    });
    const snap = t.getRuntimeSnapshot();
    expect(snap.gpuRenderLatencyMs).toBe(42.5);
    expect(snap.gpuReadbackBytes).toBe(176400);
    expect(snap.gpuFallbackReason).toBe('navigator.gpu unavailable');
    expect(snap.gpuUsedGpu).toBe(false);
  });
});
