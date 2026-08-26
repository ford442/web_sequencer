/**
 * Phase-L1 — live (realtime) high-fidelity 303 voice.
 *
 * Covers the three things the live path has to get right:
 *   - the CPU/glitch gate degrades to stock instead of underrunning, and only
 *     after warm-up, only once;
 *   - the WASM voice wrapper stays inert when hyphon_native.wasm was built
 *     without the optional highfid303_* exports;
 *   - selection plumbing — realtime routing, freeze routing, and the
 *     main-thread reaction to a worklet-side step-down.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LIVE_HIGHFID_MODEL_ID,
  LiveHighFid303Voice,
  LiveHighFidGuard,
  clampLiveOversample,
  supportsLiveHighFid,
  type LiveHighFidExports,
} from '../audio-worklets/liveHighFid303';
import {
  getTB303Model,
  getAvailableTB303Models,
  isLiveHighFidModel,
  isOfflineOnlyTB303Model,
  legacyEngine303ForModel,
  normalizeTB303Model,
  resolveHighFidModelSelection,
  resolveRealtimeTB303Model,
  tb303ModelFamily,
} from '../engines/TB303Models';
import {
  isHighFidCpuModel,
  renderOfflineHighFid303Pattern,
} from '../audio/offline/OfflineHighFid303Engine';
import { Open303Oscillator } from '../engines/Open303Oscillator';
import { engineTelemetry } from '../utils/engineTelemetry';
import { engineDegradationStore } from '../stores/engineDegradationStore';

const QUANTUM_US = (128 / 48000) * 1_000_000; // ~2667 µs

// ---------------------------------------------------------------------------
// Registry / selection
// ---------------------------------------------------------------------------

describe('live-highfid catalog entry', () => {
  it('is an available, realtime-safe voice in the highfid family', () => {
    const model = getTB303Model(LIVE_HIGHFID_MODEL_ID);
    expect(model).toBeDefined();
    expect(model!.available).toBe(true);
    expect(model!.family).toBe('highfid');
    expect(model!.offlineOnly).toBeFalsy();
    expect(isLiveHighFidModel(LIVE_HIGHFID_MODEL_ID)).toBe(true);
    expect(isOfflineOnlyTB303Model(LIVE_HIGHFID_MODEL_ID)).toBe(false);
  });

  it('shows up in the realtime selector list, unlike the offline high-fid voices', () => {
    const realtime = getAvailableTB303Models().map((m) => m.id);
    expect(realtime).toContain(LIVE_HIGHFID_MODEL_ID);
    expect(realtime).not.toContain('highfid-cpu');
    expect(realtime).not.toContain('gpu-highfid');
  });

  it('survives normalize + realtime resolution without falling back to stock', () => {
    expect(normalizeTB303Model(LIVE_HIGHFID_MODEL_ID)).toBe(LIVE_HIGHFID_MODEL_ID);
    expect(resolveRealtimeTB303Model(LIVE_HIGHFID_MODEL_ID)).toBe(LIVE_HIGHFID_MODEL_ID);
    expect(tb303ModelFamily(LIVE_HIGHFID_MODEL_ID)).toBe('highfid');
  });

  it('mirrors to engine303="open303" so older song readers still load it', () => {
    expect(legacyEngine303ForModel(LIVE_HIGHFID_MODEL_ID)).toBe('open303');
  });

  it('freezes through the same diode ladder (highfid-cpu) as it plays', () => {
    const selection = resolveHighFidModelSelection(LIVE_HIGHFID_MODEL_ID, undefined, {
      gpuAvailable: false,
      report: false,
    });
    expect(selection.realtime).toBe(LIVE_HIGHFID_MODEL_ID);
    expect(selection.offlineEngine).toBe('highfid-cpu');
    expect(selection.fallbackReason).toBeNull();
    expect(isHighFidCpuModel(LIVE_HIGHFID_MODEL_ID)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CPU / glitch gate
// ---------------------------------------------------------------------------

describe('LiveHighFidGuard', () => {
  const feed = (guard: LiveHighFidGuard, percentOfQuantum: number, blocks: number) => {
    let last = guard.record(0, QUANTUM_US);
    for (let i = 0; i < blocks; i++) {
      last = guard.record((percentOfQuantum / 100) * QUANTUM_US, QUANTUM_US);
      if (last.degrade) break;
    }
    return last;
  };

  it('stays quiet while the voice fits comfortably in the budget', () => {
    const guard = new LiveHighFidGuard();
    const verdict = feed(guard, 20, 500);
    expect(verdict.degrade).toBe(false);
    expect(guard.cpuPercent).toBeGreaterThan(15);
    expect(guard.cpuPercent).toBeLessThan(25);
    expect(guard.underruns).toBe(0);
  });

  it('ignores a warm-up burst that settles back under budget', () => {
    const guard = new LiveHighFidGuard({ warmupBlocks: 32, sustainedBlocks: 24 });
    for (let i = 0; i < 30; i++) {
      expect(guard.record(0.9 * QUANTUM_US, QUANTUM_US).degrade).toBe(false);
    }
    const verdict = feed(guard, 15, 200);
    expect(verdict.degrade).toBe(false);
  });

  it('degrades on sustained CPU above the budget', () => {
    const guard = new LiveHighFidGuard({ warmupBlocks: 4, sustainedBlocks: 24, cpuBudgetPercent: 60 });
    const verdict = feed(guard, 85, 400);
    expect(verdict.degrade).toBe(true);
    expect(verdict.reason).toMatch(/quantum budget/);
    expect(verdict.cpuPercent).toBeGreaterThan(60);
  });

  it('degrades on repeated hard underruns even below the sustained-CPU run', () => {
    const guard = new LiveHighFidGuard({ warmupBlocks: 0, underrunLimit: 3, underrunWindowBlocks: 200 });
    let verdict = guard.record(0, QUANTUM_US);
    for (let i = 0; i < 3; i++) {
      verdict = guard.record(1.4 * QUANTUM_US, QUANTUM_US);
    }
    expect(verdict.degrade).toBe(true);
    expect(verdict.reason).toMatch(/underrun/);
    expect(guard.underruns).toBeGreaterThanOrEqual(3);
  });

  it('trips at most once — a tripped guard stops asking for more fallbacks', () => {
    const guard = new LiveHighFidGuard({ warmupBlocks: 0, sustainedBlocks: 4 });
    const first = feed(guard, 200, 100);
    expect(first.degrade).toBe(true);
    const after = feed(guard, 200, 100);
    expect(after.degrade).toBe(false);
  });

  it('reset() re-arms the guard after a clean restart', () => {
    const guard = new LiveHighFidGuard({ warmupBlocks: 0, sustainedBlocks: 4 });
    expect(feed(guard, 200, 100).degrade).toBe(true);
    guard.reset();
    expect(guard.underruns).toBe(0);
    expect(feed(guard, 200, 100).degrade).toBe(true);
  });

  it('ignores blocks with a nonsensical quantum (never divides by zero)', () => {
    const guard = new LiveHighFidGuard({ warmupBlocks: 0 });
    expect(guard.record(1000, 0).degrade).toBe(false);
    expect(guard.record(Number.NaN, QUANTUM_US).degrade).toBe(false);
    expect(guard.cpuPercent).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// WASM voice wrapper
// ---------------------------------------------------------------------------

function fakeExports(overrides: Partial<LiveHighFidExports> = {}): LiveHighFidExports {
  return {
    highfid303_create: vi.fn(() => 7),
    highfid303_destroy: vi.fn(),
    highfid303_init: vi.fn(() => 1),
    highfid303_note_on: vi.fn(),
    highfid303_note_off: vi.fn(),
    highfid303_all_notes_off: vi.fn(),
    highfid303_set_param: vi.fn(),
    highfid303_set_oversample: vi.fn(),
    highfid303_process: vi.fn(),
    ...overrides,
  };
}

describe('LiveHighFid303Voice', () => {
  const identity = (h: number | bigint) => h;

  it('reports unsupported when the build pruned the optional exports', () => {
    expect(supportsLiveHighFid(null)).toBe(false);
    expect(supportsLiveHighFid({})).toBe(false);
    expect(supportsLiveHighFid(fakeExports({ highfid303_process: undefined }))).toBe(false);
    expect(supportsLiveHighFid(fakeExports())).toBe(true);
  });

  it('creates, inits and renders through the C API', () => {
    const exports = fakeExports();
    const voice = new LiveHighFid303Voice(exports, identity);

    expect(voice.init(48000, 128, 1)).toBe(true);
    expect(voice.isReady).toBe(true);
    expect(exports.highfid303_init).toHaveBeenCalledWith(7, 48000, 128);
    expect(exports.highfid303_set_oversample).toHaveBeenCalledWith(7, 1);

    voice.noteOn(45, 120);
    voice.setParam(2, 0.4);
    voice.process(4096, 128);
    voice.noteOff(45);
    voice.allNotesOff();

    expect(exports.highfid303_note_on).toHaveBeenCalledWith(7, 45, 120);
    expect(exports.highfid303_set_param).toHaveBeenCalledWith(7, 2, 0.4);
    expect(exports.highfid303_process).toHaveBeenCalledWith(7, 4096, 128);
    expect(exports.highfid303_note_off).toHaveBeenCalledWith(7, 45);
    expect(exports.highfid303_all_notes_off).toHaveBeenCalledWith(7);

    voice.destroy();
    expect(exports.highfid303_destroy).toHaveBeenCalledWith(7);
    expect(voice.isReady).toBe(false);
  });

  it('stays inert (and never throws) when init fails', () => {
    const exports = fakeExports({ highfid303_init: vi.fn(() => 0) });
    const voice = new LiveHighFid303Voice(exports, identity);
    expect(voice.init(48000, 128)).toBe(false);
    expect(voice.isReady).toBe(false);
    voice.noteOn(45, 120);
    voice.process(4096, 128);
    expect(exports.highfid303_note_on).not.toHaveBeenCalled();
    expect(exports.highfid303_process).not.toHaveBeenCalled();
    expect(exports.highfid303_destroy).toHaveBeenCalledWith(7);
  });

  it('rejects a null handle from the WASM allocator', () => {
    const exports = fakeExports({ highfid303_create: vi.fn(() => 0) });
    const voice = new LiveHighFid303Voice(exports, identity);
    expect(voice.init(48000, 128)).toBe(false);
    expect(exports.highfid303_init).not.toHaveBeenCalled();
  });

  it('clamps the oversample factor to the factors the wrapper accepts', () => {
    expect(clampLiveOversample(1)).toBe(1);
    expect(clampLiveOversample(2)).toBe(2);
    expect(clampLiveOversample(4)).toBe(1);
    expect(clampLiveOversample(undefined)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Main-thread plumbing
// ---------------------------------------------------------------------------

describe('Open303Oscillator live high-fid routing', () => {
  let oscillator: Open303Oscillator;
  let postMessage: ReturnType<typeof vi.fn>;
  let listeners: Array<(e: MessageEvent) => void>;

  beforeEach(() => {
    engineDegradationStore.clear('live-highfid');
    oscillator = new Open303Oscillator();
    postMessage = vi.fn();
    listeners = [];
    const port = {
      postMessage,
      addEventListener: (_type: string, fn: (e: MessageEvent) => void) => listeners.push(fn),
      removeEventListener: vi.fn(),
    } as unknown as MessagePort;
    (oscillator as any).workletNode = { port } as unknown as AudioWorkletNode;
    (oscillator as any).isReady = true;
    (oscillator as any).attachStatusListener((oscillator as any).workletNode);
  });

  const emit = (message: unknown) => {
    for (const fn of listeners) fn({ data: message } as MessageEvent);
  };

  it('routes the live voice to the worklet with the highfid family hint', () => {
    oscillator.setModel303(LIVE_HIGHFID_MODEL_ID);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'set-303-model',
      data: { model: LIVE_HIGHFID_MODEL_ID, engine: 'highfid', oversample: 1 },
    });
    expect(oscillator.getModel303()).toBe(LIVE_HIGHFID_MODEL_ID);
  });

  it('carries a raised oversample factor to the worklet', () => {
    oscillator.setModel303(LIVE_HIGHFID_MODEL_ID);
    oscillator.setLiveHighFidOversample(2);
    expect(postMessage).toHaveBeenCalledWith({
      type: 'set-303-model',
      data: { model: LIVE_HIGHFID_MODEL_ID, engine: 'highfid', oversample: 2 },
    });
  });

  it('falls back to stock and reports the reason when the worklet degrades', () => {
    oscillator.setModel303(LIVE_HIGHFID_MODEL_ID);
    emit({
      type: 'live-highfid-degraded',
      data: { reason: '9 audio underruns in 200 blocks', cpuPercent: 92, underruns: 9 },
    });

    expect(oscillator.getModel303()).toBe('stock-open303');
    const runtime = engineTelemetry.getRuntimeSnapshot();
    expect(runtime.liveHighFidActive).toBe(false);
    expect(runtime.liveHighFidFallbackReason).toBe('9 audio underruns in 200 blocks');
    const issue = engineDegradationStore.getIssue('live-highfid');
    expect(issue?.activeBackend).toBe('stock-open303');
    expect(issue?.requestedBackend).toBe(LIVE_HIGHFID_MODEL_ID);
  });

  it('falls back when the WASM build has no live high-fid exports', () => {
    oscillator.setModel303(LIVE_HIGHFID_MODEL_ID);
    emit({
      type: 'live-highfid-unavailable',
      data: { reason: 'highfid303_* exports missing from this WASM build' },
    });
    expect(oscillator.getModel303()).toBe('stock-open303');
    expect(engineTelemetry.getRuntimeSnapshot().liveHighFidActive).toBe(false);
  });

  it('leaves stock voices completely untouched by the live high-fid path', () => {
    oscillator.setModel303('stock-open303');
    expect(postMessage).toHaveBeenCalledWith({
      type: 'set-303-model',
      data: { model: 'stock-open303', engine: 'open303', oversample: 1 },
    });
    emit({ type: 'worklet-perf', name: 'open303', cpuPercent: 5 });
    expect(oscillator.getModel303()).toBe('stock-open303');
  });
});

// ---------------------------------------------------------------------------
// Diode ladder at live settings
// ---------------------------------------------------------------------------

/**
 * The live voice runs the C wrapper, which is unavailable without a built
 * hyphon_native.wasm. The TS mirror in OfflineHighFid303Engine implements the
 * same topology, so rendering it at the live settings (oversample 1) is a
 * toolchain-free check that those settings produce audio rather than silence.
 */
describe('diode ladder at live settings (oversample 1)', () => {
  const pattern = {
    tempo: 130,
    steps: [
      { note: 33, accent: true },
      { note: 33 },
      { note: 45, slide: true },
      { note: 40, accent: true },
    ],
  };

  it('produces finite, non-silent audio', () => {
    const buffer = renderOfflineHighFid303Pattern(pattern, {
      oversample: 1,
      sampleRate: 48000,
    });

    expect(buffer.length).toBeGreaterThan(0);
    let peak = 0;
    let sumSquares = 0;
    for (const sample of buffer) {
      expect(Number.isFinite(sample)).toBe(true);
      peak = Math.max(peak, Math.abs(sample));
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / buffer.length);
    expect(peak).toBeGreaterThan(0.01);
    expect(peak).toBeLessThanOrEqual(1.5);
    expect(rms).toBeGreaterThan(0.001);
  });

  it('is deterministic — same pattern, same samples', () => {
    const a = renderOfflineHighFid303Pattern(pattern, { oversample: 1, sampleRate: 48000 });
    const b = renderOfflineHighFid303Pattern(pattern, { oversample: 1, sampleRate: 48000 });
    expect(Array.from(a.subarray(0, 512))).toEqual(Array.from(b.subarray(0, 512)));
  });
});
