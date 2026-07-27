import { describe, it, expect, beforeEach } from 'vitest';
import {
  OfflineOpen303Engine,
  bufferHasNonFinite,
  clampOversample,
  mixVoiceBuffersJs,
  renderOffline303Pattern,
} from '@/audio/offline/OfflineOpen303Engine';
import {
  makeCanonical64StepPattern,
  render303Offline,
  render303OfflineMulti,
  render303OfflineWithMeta,
  terminateOffline303Pool,
} from '@/audio/OfflineRenderer';
import { EngineTelemetry } from '@/utils/engineTelemetry';

describe('clampOversample', () => {
  it('accepts 1, 2, 4 and defaults other values to 1', () => {
    expect(clampOversample(1)).toBe(1);
    expect(clampOversample(2)).toBe(2);
    expect(clampOversample(4)).toBe(4);
    expect(clampOversample(3)).toBe(1);
    expect(clampOversample(undefined)).toBe(1);
  });
});

describe('OfflineOpen303Engine', () => {
  it('renders deterministically at 1× oversample', () => {
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
    const a = renderOffline303Pattern('stock-open303', pattern, { oversample: 1 });
    const b = renderOffline303Pattern('stock-open303', pattern, { oversample: 1 });
    expect(a.length).toBe(b.length);
    expect(a.length).toBeGreaterThan(1000);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBe(b[i]);
    }
    expect(bufferHasNonFinite(a)).toBe(false);
  });

  it('4× oversample produces finite audio of the same frame count', () => {
    const pattern = {
      steps: [
        { note: 36, velocity: 90 },
        { note: 43, accent: true, velocity: 120 },
      ],
      stepDurationSec: 0.1,
    };
    const x1 = renderOffline303Pattern('stock-open303', pattern, { oversample: 1 });
    const x4 = renderOffline303Pattern('stock-open303', pattern, { oversample: 4 });
    expect(x4.length).toBe(x1.length);
    expect(bufferHasNonFinite(x4)).toBe(false);
    // Oversampling changes the waveform (anti-alias) — not bit-identical
    let diff = 0;
    for (let i = 0; i < x1.length; i++) diff += Math.abs(x1[i] - x4[i]);
    expect(diff).toBeGreaterThan(0);
  });

  it('keeps independent filter state across concurrent voice instances', () => {
    const engA = new OfflineOpen303Engine(44100, 'stock-open303');
    const engB = new OfflineOpen303Engine(44100, '1ink303-v1');
    engA.setOversample(2);
    engB.setOversample(2);
    engA.noteOn(36, 90);
    engB.noteOn(48, 120);
    const a = new Float32Array(256);
    const b = new Float32Array(256);
    engA.process(a);
    engB.process(b);
    expect(bufferHasNonFinite(a)).toBe(false);
    expect(bufferHasNonFinite(b)).toBe(false);
    // Different models / pitches → different buffers
    let same = true;
    for (let i = 0; i < 256; i++) {
      if (a[i] !== b[i]) {
        same = false;
        break;
      }
    }
    expect(same).toBe(false);
  });
});

describe('mixVoiceBuffersJs', () => {
  it('sums mono voices with gains', () => {
    const v1 = new Float32Array([0.1, 0.2]);
    const v2 = new Float32Array([0.3, 0.4]);
    const mixed = mixVoiceBuffersJs([v1, v2], [1, 0.5]);
    expect(mixed[0]).toBeCloseTo(0.1 + 0.15, 5);
    expect(mixed[1]).toBeCloseTo(0.2 + 0.2, 5);
  });
});

describe('render303Offline API', () => {
  beforeEach(() => {
    terminateOffline303Pool();
  });

  it('renders a 64-step pattern at 4× oversample within a reasonable budget', async () => {
    const pattern = makeCanonical64StepPattern(130);
    const meta = await render303OfflineWithMeta('stock-open303', pattern, {
      oversample: 4,
      threadCount: 4,
      sync: true,
    });
    expect(meta.buffer.length).toBeGreaterThan(10_000);
    expect(bufferHasNonFinite(meta.buffer)).toBe(false);
    expect(meta.oversample).toBe(4);
    expect(meta.threadCount).toBe(4);
    // Soft target — CI runners vary; keep a generous ceiling so flakes stay rare.
    expect(meta.latencyMs).toBeLessThan(5_000);
  });

  it('multi-voice lead+bass1+bass2 has no NaNs', async () => {
    const pattern = makeCanonical64StepPattern(120);
    // Shorter for speed: first 8 steps
    const short = { ...pattern, steps: pattern.steps.slice(0, 8) };
    const buf = await render303OfflineMulti(
      [
        { modelId: 'stock-open303', pattern: short, gain: 0.8 },
        { modelId: '1ink303-v1', pattern: short, gain: 0.6 },
        { modelId: 'experimental-01', pattern: short, gain: 0.5 },
      ],
      { oversample: 2, sync: true },
    );
    expect(buf.length).toBeGreaterThan(1000);
    expect(bufferHasNonFinite(buf)).toBe(false);
  });

  it('records offline render telemetry', async () => {
    const t = new EngineTelemetry();
    t.recordOfflineRender({ threadCount: 4, oversample: 4, latencyMs: 123.4 });
    const snap = t.getRuntimeSnapshot();
    expect(snap.offlineRenderThreadCount).toBe(4);
    expect(snap.offlineRenderOversample).toBe(4);
    expect(snap.offlineRenderLatencyMs).toBe(123.4);
    expect(t.snapshot().offline303.resolution?.backend).toBe('os×4');
  });

  it('render303Offline returns a Float32Array', async () => {
    const pattern = {
      steps: [{ note: 36, velocity: 90 }],
      stepDurationSec: 0.05,
    };
    const buf = await render303Offline('stock-open303', pattern, { sync: true, oversample: 1 });
    expect(buf).toBeInstanceOf(Float32Array);
    expect(buf.length).toBeGreaterThan(100);
  });
});
