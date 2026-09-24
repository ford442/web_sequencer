/**
 * Phases L2 + L3 of the realtime high-fid 303 (docs/audio-engine/303-realtime-highfid.md).
 *
 *  - L2 live A/B: stock Open303 and the live diode ladder from one note
 *    stream on two buses, an equal-power blend that is automatable and saved,
 *    and a CPU gate that still only ever trips the high-fid side.
 *  - L3 editable coefficients: four extra highfid303 param ids, a canonical
 *    preset that reproduces the pre-L3 DSP, song round-trip, and a freeze that
 *    uses the song's coefficients only when the song stored some.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CANONICAL_HIGHFID_COEFFICIENTS,
  HIGHFID_COEFFICIENT_PARAM_IDS,
  HIGHFID_COEFFICIENT_TABLE_BYTES,
  HighFidCoefficientTable,
  isCanonicalHighFidCoefficients,
  normalizeHighFidCoefficients,
  type HighFidCoefficients,
} from '../audio-worklets/liveHighFidCoefficients';
import { LIVE_HIGHFID_MODEL_ID } from '../audio-worklets/liveHighFid303';
import { Open303EngineSelection } from '../audio-worklets/open303/engineSelection';
import type { Open303EngineSession } from '../audio-worklets/open303/engineSession';
import {
  LiveHighFidAbPair,
  LiveHighFidCoefficientLink,
  abFreezeSide,
  clampAbMix,
  equalPowerAbGains,
} from '../engines/LiveHighFidAbPair';
import { Open303Oscillator } from '../engines/Open303Oscillator';
import {
  normalizeTB303VoiceExtra,
  resolveTB303FreezeJob,
  type TB303VoiceExtra,
} from '../engines/tb303VoiceExtra';
import { render303FreezeOffline, render303OfflineWithMeta } from '../audio/OfflineRenderer';
import { renderOfflineHighFid303Pattern } from '../audio/offline/OfflineHighFid303Engine';
import { DEFAULT_SYNTH_PARAMS_A, DEFAULT_BASS2_PARAMS } from '../constants';
import type { SynthParams, Bass2Params } from '../types';
import { engineTelemetry } from '../utils/engineTelemetry';
import { engineDegradationStore } from '../stores/engineDegradationStore';

const QUANTUM_US = (128 / 48000) * 1_000_000;

const EDITED: HighFidCoefficients = {
  transistorMismatch: 0.6,
  decayCurve: 0.4,
  accentCoupling: 0.9,
  filterTracking: 0.5,
};

const PATTERN = {
  tempo: 130,
  steps: [
    { note: 33, accent: true, velocity: 120 },
    { note: 33 },
    { note: 45, slide: true },
    { note: 40, accent: true, velocity: 120 },
    { note: 52, accent: true, velocity: 120, slide: true },
  ],
};

interface PostedMessage {
  type: string;
  data?: Record<string, unknown>;
}

/** Messages a mocked `port.postMessage` received, in order. */
function messagesOf(fn: unknown): PostedMessage[] {
  return (fn as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as PostedMessage);
}

function bytes(buffer: Float32Array): number[] {
  return Array.from(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
}

// ---------------------------------------------------------------------------
// L3 — coefficient model
// ---------------------------------------------------------------------------

describe('high-fid coefficients (L3)', () => {
  it('uses param ids after the Open303Param mirror (0–13)', () => {
    expect(Object.values(HIGHFID_COEFFICIENT_PARAM_IDS)).toEqual([14, 15, 16, 17]);
  });

  it('canonical preset keeps the pre-L3 accent coupling and switches the rest off', () => {
    expect(CANONICAL_HIGHFID_COEFFICIENTS).toEqual({
      transistorMismatch: 0,
      decayCurve: 0,
      accentCoupling: 0.45,
      filterTracking: 0,
    });
    expect(Object.isFrozen(CANONICAL_HIGHFID_COEFFICIENTS)).toBe(true);
  });

  it('normalizes: clamps, fills missing slots canonically, rejects non-objects', () => {
    expect(normalizeHighFidCoefficients(undefined)).toBeUndefined();
    expect(normalizeHighFidCoefficients('nope')).toBeUndefined();
    expect(normalizeHighFidCoefficients({ transistorMismatch: 2, decayCurve: -1, filterTracking: Number.NaN }))
      .toEqual({ transistorMismatch: 1, decayCurve: 0, accentCoupling: 0.45, filterTracking: 0 });
    expect(isCanonicalHighFidCoefficients(undefined)).toBe(true);
    expect(isCanonicalHighFidCoefficients({ ...CANONICAL_HIGHFID_COEFFICIENTS })).toBe(true);
    expect(isCanonicalHighFidCoefficients(EDITED)).toBe(false);
  });

  it('shared table publishes a set once and reads nothing until the next write', () => {
    const writer = new HighFidCoefficientTable(new SharedArrayBuffer(HIGHFID_COEFFICIENT_TABLE_BYTES));
    const reader = new HighFidCoefficientTable(writer.buffer);
    expect(reader.readIfChanged()).toBeNull();
    writer.write(EDITED);
    const read = reader.readIfChanged();
    expect(read!.transistorMismatch).toBeCloseTo(0.6, 6);
    expect(read!.accentCoupling).toBeCloseTo(0.9, 6);
    expect(reader.readIfChanged()).toBeNull();
  });

  it('is only created where SharedArrayBuffer can reach the worklet', () => {
    vi.stubGlobal('crossOriginIsolated', false);
    expect(HighFidCoefficientTable.create()).toBeNull();
    vi.stubGlobal('crossOriginIsolated', true);
    expect(HighFidCoefficientTable.create()).toBeInstanceOf(HighFidCoefficientTable);
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------
// L2 — blend maths + freeze side
// ---------------------------------------------------------------------------

describe('live A/B blend (L2)', () => {
  it('is equal-power and exact at the flip endpoints', () => {
    expect(equalPowerAbGains(0)).toEqual({ stock: 1, highFid: 0 });
    expect(equalPowerAbGains(1)).toEqual({ stock: 0, highFid: 1 });
    for (const mix of [0.1, 0.25, 0.5, 0.8]) {
      const { stock, highFid } = equalPowerAbGains(mix);
      expect(stock * stock + highFid * highFid).toBeCloseTo(1, 12);
    }
    expect(equalPowerAbGains(0.5).stock).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('clamps garbage to the default (fully high-fid, i.e. what was already audible)', () => {
    expect(clampAbMix(Number.NaN)).toBe(1);
    expect(clampAbMix('0.2')).toBe(1);
    expect(clampAbMix(-3)).toBe(0);
    expect(clampAbMix(7)).toBe(1);
  });

  it('freezes one side: high-fid from 0.5 up, stock below', () => {
    expect(abFreezeSide(0.49)).toBe('stock');
    expect(abFreezeSide(0.5)).toBe('highfid');
    expect(abFreezeSide(1)).toBe('highfid');
  });
});

// ---------------------------------------------------------------------------
// Worklet side — Open303EngineSelection
// ---------------------------------------------------------------------------

function makeWorklet() {
  const exports = {
    highfid303_create: vi.fn(() => 5),
    highfid303_init: vi.fn(() => 1),
    highfid303_destroy: vi.fn(),
    highfid303_process: vi.fn(),
    highfid303_note_on: vi.fn(),
    highfid303_note_off: vi.fn(),
    highfid303_all_notes_off: vi.fn(),
    highfid303_set_param: vi.fn(),
    highfid303_set_oversample: vi.fn(),
    open303_set_model: vi.fn(),
    open303_all_notes_off: vi.fn(),
  };
  const session = {
    modelRegistry: new Map([
      ['stock-open303', { index: 0, engine: 'open303' as const }],
      ['experimental-01', { index: 2, engine: 'open303' as const }],
    ]),
    getExports: () => exports,
    isNativeApi: true,
    hasJc303MultiApi: false,
    isInvalidHandle: (h: number | bigint | null | undefined) => !h,
    nativeOutputPtr: 1024,
    nativeBufFrames: 128,
    sampleRateHz: 48000,
    instanceHandle: 7,
    toWasmHandle: (h: number | bigint) => h,
  } as unknown as Open303EngineSession;
  const port = { postMessage: vi.fn() } as unknown as MessagePort & { postMessage: ReturnType<typeof vi.fn> };
  const clearAllNotes = vi.fn();
  const selection = new Open303EngineSelection(session, port, clearAllNotes);
  const posted = (type: string) => messagesOf(port.postMessage).filter((m) => m.type === type);
  return { exports, selection, port, clearAllNotes, posted };
}

describe('Open303EngineSelection — live A/B', () => {
  it('stays inactive unless the part is on live-highfid', () => {
    const { selection, exports } = makeWorklet();
    selection.setLiveAb(true);
    expect(selection.isAbArmed).toBe(true);
    expect(selection.abActive).toBe(false);
    // Arming a stock part allocates nothing and leaves its profile alone.
    expect(exports.highfid303_create).not.toHaveBeenCalled();
    expect(exports.open303_set_model).not.toHaveBeenCalled();
  });

  it('puts side A on the stock profile when both sides go live', () => {
    const { selection, exports } = makeWorklet();
    selection.setModel('experimental-01', 'open303');
    exports.open303_set_model.mockClear();
    selection.setModel(LIVE_HIGHFID_MODEL_ID, 'highfid');
    expect(exports.open303_set_model).not.toHaveBeenCalled(); // L1 path untouched
    selection.setLiveAb(true);
    expect(selection.abActive).toBe(true);
    expect(exports.open303_set_model).toHaveBeenCalledWith(7, 0);
  });

  it('reports per-side CPU while engaged', () => {
    const { selection, posted } = makeWorklet();
    selection.setModel(LIVE_HIGHFID_MODEL_ID, 'highfid');
    selection.setLiveAb(true);
    for (let i = 0; i < 94; i++) selection.recordAbTiming(QUANTUM_US * 0.1, QUANTUM_US * 0.3, QUANTUM_US);
    const [report] = posted('live-ab-cpu');
    expect(report.data?.stockPercent).toBeCloseTo(10, 5);
    expect(report.data?.highFidPercent).toBeCloseTo(30, 5);
  });

  it('gate trips only side B: stock notes and profile are untouched', () => {
    const { selection, exports, clearAllNotes, posted } = makeWorklet();
    selection.setModel(LIVE_HIGHFID_MODEL_ID, 'highfid');
    selection.setLiveAb(true);
    exports.open303_set_model.mockClear();
    clearAllNotes.mockClear(); // the stock → highfid engine switch above releases notes

    for (let i = 0; i < 80 && selection.abActive; i++) {
      selection.recordAbTiming(QUANTUM_US * 0.1, QUANTUM_US * 0.9, QUANTUM_US);
    }

    expect(selection.abActive).toBe(false);
    expect(selection.isAbArmed).toBe(true);
    expect(selection.activeEngine).toBe('open303');
    expect(exports.highfid303_all_notes_off).toHaveBeenCalled();
    expect(exports.highfid303_destroy).toHaveBeenCalled();
    expect(clearAllNotes).not.toHaveBeenCalled();
    expect(exports.open303_all_notes_off).not.toHaveBeenCalled();
    expect(exports.open303_set_model).not.toHaveBeenCalled();
    expect(posted('live-highfid-degraded')[0].data?.ab).toBe(true);
  });

  it('without A/B the gate still behaves exactly like L1', () => {
    const { selection, clearAllNotes, exports } = makeWorklet();
    selection.setModel(LIVE_HIGHFID_MODEL_ID, 'highfid');
    for (let i = 0; i < 80 && selection.activeEngine === 'highfid'; i++) {
      selection.recordHighFidTiming(QUANTUM_US * 0.9, QUANTUM_US);
    }
    expect(selection.activeEngine).toBe('open303');
    expect(clearAllNotes).toHaveBeenCalled();
    expect(exports.open303_set_model).toHaveBeenCalledWith(7, 0);
  });
});

describe('Open303EngineSelection — coefficients', () => {
  const coefficientCalls = (exports: ReturnType<typeof makeWorklet>['exports']) =>
    exports.highfid303_set_param.mock.calls.filter(([, id]) => id >= 14);

  it('pushes the canonical preset into a fresh live voice', () => {
    const { selection, exports } = makeWorklet();
    selection.setModel(LIVE_HIGHFID_MODEL_ID, 'highfid');
    expect(coefficientCalls(exports)).toEqual([
      [5, 14, 0], [5, 15, 0], [5, 16, 0.45], [5, 17, 0],
    ]);
  });

  it('morphs the running voice without recreating it (postMessage path)', () => {
    const { selection, exports } = makeWorklet();
    selection.setModel(LIVE_HIGHFID_MODEL_ID, 'highfid');
    exports.highfid303_set_param.mockClear();
    selection.setHighFidCoefficients(EDITED);
    expect(coefficientCalls(exports)).toEqual([
      [5, 14, 0.6], [5, 15, 0.4], [5, 16, 0.9], [5, 17, 0.5],
    ]);
    expect(exports.highfid303_create).toHaveBeenCalledTimes(1);
    selection.setHighFidCoefficients(null);
    expect(selection.highFidCoefficients).toEqual(CANONICAL_HIGHFID_COEFFICIENTS);
  });

  it('polls the shared table once per block and applies only new writes', () => {
    const { selection, exports } = makeWorklet();
    const ui = new HighFidCoefficientTable(new SharedArrayBuffer(HIGHFID_COEFFICIENT_TABLE_BYTES));
    selection.attachCoefficientTable(ui.buffer);
    selection.setModel(LIVE_HIGHFID_MODEL_ID, 'highfid');
    exports.highfid303_set_param.mockClear();

    selection.pollCoefficientTable();
    expect(exports.highfid303_set_param).not.toHaveBeenCalled();

    ui.write(EDITED);
    selection.pollCoefficientTable();
    expect(coefficientCalls(exports)).toHaveLength(4);
    expect(selection.highFidCoefficients.decayCurve).toBeCloseTo(0.4, 6);

    exports.highfid303_set_param.mockClear();
    selection.pollCoefficientTable();
    expect(exports.highfid303_set_param).not.toHaveBeenCalled();
  });

  it('ignores a table that is not a SharedArrayBuffer', () => {
    const { selection } = makeWorklet();
    expect(() => selection.attachCoefficientTable(new ArrayBuffer(64))).not.toThrow();
    expect(() => selection.attachCoefficientTable({})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Main thread — LiveHighFidAbPair / Open303Oscillator
// ---------------------------------------------------------------------------

type FakeGain = ReturnType<typeof makeGain>;

function makeGain() {
  return { connect: vi.fn(), disconnect: vi.fn(), gain: { setValueAtTime: vi.fn() } };
}

/** An AudioContext stand-in that remembers the gains it created. */
function makeContext(currentTime: number) {
  const created: FakeGain[] = [];
  const createGain = vi.fn(() => {
    const gain = makeGain();
    created.push(gain);
    return gain;
  });
  return { currentTime, createGain, created };
}

describe('LiveHighFidAbPair', () => {
  it('routes output 0 → A and output 1 → B, then back to the L1 graph', () => {
    const fakeContext = makeContext(3);
    const port = { postMessage: vi.fn() };
    const worklet = { connect: vi.fn(), disconnect: vi.fn(), port } as unknown as AudioWorkletNode;
    const destination = {} as AudioNode;
    const pair = new LiveHighFidAbPair(fakeContext as unknown as BaseAudioContext, worklet, destination);

    pair.engage(0.5);
    const [gainA, gainB] = fakeContext.created;
    expect(worklet.connect).toHaveBeenCalledWith(gainA, 0);
    expect(worklet.connect).toHaveBeenCalledWith(gainB, 1);
    expect(gainA.connect).toHaveBeenCalledWith(destination);
    expect(gainA.gain.setValueAtTime).toHaveBeenCalledWith(expect.closeTo(Math.SQRT1_2, 9), 3);
    expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'set-live-ab', data: { armed: true } });

    pair.setMix(0, 4.5);
    expect(gainA.gain.setValueAtTime).toHaveBeenLastCalledWith(1, 4.5);
    expect(gainB.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 4.5);

    pair.release();
    expect(worklet.connect).toHaveBeenLastCalledWith(destination);
    expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'set-live-ab', data: { armed: false } });
    expect(pair.isEngaged).toBe(false);
  });
});

describe('LiveHighFidCoefficientLink', () => {
  it('attaches a shared table once and then writes without messages', () => {
    const port = { postMessage: vi.fn() } as unknown as MessagePort;
    const table = new HighFidCoefficientTable(new SharedArrayBuffer(HIGHFID_COEFFICIENT_TABLE_BYTES));
    const link = new LiveHighFidCoefficientLink(port, table);
    expect(port.postMessage).toHaveBeenCalledTimes(1);
    expect(messagesOf(port.postMessage)[0].type).toBe('attach-highfid-coeff-table');
    link.send(EDITED);
    link.send(CANONICAL_HIGHFID_COEFFICIENTS);
    expect(port.postMessage).toHaveBeenCalledTimes(1);
  });

  it('falls back to messages without a table', () => {
    const port = { postMessage: vi.fn() } as unknown as MessagePort;
    const link = new LiveHighFidCoefficientLink(port, null);
    link.send(EDITED);
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'set-highfid-coeffs', data: { coefficients: EDITED } });
  });
});

describe('Open303Oscillator — live A/B + coefficients', () => {
  let oscillator: Open303Oscillator;
  let postMessage: ReturnType<typeof vi.fn>;
  let listeners: Array<(e: MessageEvent) => void>;
  let worklet: { port: MessagePort; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
  let context: ReturnType<typeof makeContext>;
  let partGain: object;

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
    worklet = { port, connect: vi.fn(), disconnect: vi.fn() };
    context = makeContext(1);
    partGain = { tag: 'part-gain' };
    Object.assign(oscillator as unknown as Record<string, unknown>, {
      workletNode: worklet,
      audioContext: context,
      gainNode: partGain,
      isReady: true,
    });
    (oscillator as unknown as { attachStatusListener(node: unknown): void }).attachStatusListener(worklet);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const emit = (message: unknown) => {
    for (const fn of listeners) fn({ data: message } as MessageEvent);
  };
  const liveAbMessages = () => messagesOf(postMessage).filter((m) => m.type === 'set-live-ab');

  it('arming a stock part is free: no gains, no rewiring, no worklet message', () => {
    oscillator.setLiveAb({ armed: true });
    expect(context.createGain).not.toHaveBeenCalled();
    expect(worklet.disconnect).not.toHaveBeenCalled();
    expect(liveAbMessages()).toEqual([]);
    expect(oscillator.isLiveAbEngaged()).toBe(false);
  });

  it('engages on live-highfid, keeps the high-fid side audible, and records telemetry', () => {
    oscillator.setLiveAb({ armed: true });
    oscillator.setModel303(LIVE_HIGHFID_MODEL_ID);
    expect(oscillator.isLiveAbEngaged()).toBe(true);
    expect(context.createGain).toHaveBeenCalledTimes(2);
    const [gainA, gainB] = context.created;
    expect(gainA.gain.setValueAtTime).toHaveBeenCalledWith(0, 1);
    expect(gainB.gain.setValueAtTime).toHaveBeenCalledWith(1, 1);
    expect(liveAbMessages()).toEqual([{ type: 'set-live-ab', data: { armed: true } }]);

    // An automation point lands at its audio time, not at currentTime.
    oscillator.setLiveAbMix(0.25, 2);
    expect(gainA.gain.setValueAtTime).toHaveBeenLastCalledWith(expect.closeTo(Math.cos(Math.PI / 8), 9), 2);
    expect(gainB.gain.setValueAtTime).toHaveBeenLastCalledWith(expect.closeTo(Math.sin(Math.PI / 8), 9), 2);
    // A later model re-apply (same voice) must not re-stamp the blend.
    const callsBefore = gainA.gain.setValueAtTime.mock.calls.length;
    oscillator.setModel303(LIVE_HIGHFID_MODEL_ID);
    expect(gainA.gain.setValueAtTime.mock.calls.length).toBe(callsBefore);
    const runtime = engineTelemetry.getRuntimeSnapshot();
    expect(runtime.liveAbEngaged).toBe(true);
    expect(runtime.liveAbMix).toBe(0.25);
  });

  it('collapses to stock on a CPU-gate step-down but keeps the request', () => {
    oscillator.setModel303(LIVE_HIGHFID_MODEL_ID);
    oscillator.setLiveAb({ armed: true, mix: 1 });
    emit({ type: 'live-highfid-degraded', data: { reason: 'over budget', cpuPercent: 91, ab: true } });

    expect(oscillator.getModel303()).toBe('stock-open303');
    expect(oscillator.isLiveAbEngaged()).toBe(false);
    expect(worklet.connect).toHaveBeenLastCalledWith(partGain);
    expect(liveAbMessages().at(-1)).toEqual({ type: 'set-live-ab', data: { armed: false } });
    expect(oscillator.getLiveAb()).toEqual({ armed: true, mix: 1 });
  });

  it('records the per-side CPU the worklet reports', () => {
    emit({ type: 'live-ab-cpu', data: { stockPercent: 4, highFidPercent: 27 } });
    const runtime = engineTelemetry.getRuntimeSnapshot();
    expect(runtime.liveAbStockCpuPercent).toBe(4);
    expect(runtime.liveAbHighFidCpuPercent).toBe(27);
  });

  it('sends nothing for a part that never stored coefficients', () => {
    oscillator.setHighFidCoefficients(undefined);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('messages coefficients without cross-origin isolation, then can reset to canonical', () => {
    vi.stubGlobal('crossOriginIsolated', false);
    oscillator.setHighFidCoefficients(EDITED);
    expect(postMessage).toHaveBeenLastCalledWith({ type: 'set-highfid-coeffs', data: { coefficients: EDITED } });
    oscillator.setHighFidCoefficients(undefined);
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'set-highfid-coeffs',
      data: { coefficients: { ...CANONICAL_HIGHFID_COEFFICIENTS } },
    });
    expect(oscillator.getHighFidCoefficients()).toBeUndefined();
  });

  it('uses the shared table when cross-origin isolated', () => {
    vi.stubGlobal('crossOriginIsolated', true);
    oscillator.setHighFidCoefficients(EDITED);
    oscillator.setHighFidCoefficients({ ...EDITED, decayCurve: 0.1 });
    const messages = messagesOf(postMessage);
    expect(messages.map((m) => m.type)).toEqual(['attach-highfid-coeff-table']);
    expect(messages[0].data?.buffer).toBeInstanceOf(SharedArrayBuffer);
  });
});

// ---------------------------------------------------------------------------
// Persistence + freeze
// ---------------------------------------------------------------------------

describe('model303Extra persistence', () => {
  it('round-trips A/B and coefficients through song JSON', () => {
    const extra: TB303VoiceExtra = { ab: { armed: true, mix: 0.3 }, highFidCoefficients: EDITED };
    const synthA: SynthParams = { ...DEFAULT_SYNTH_PARAMS_A, model303: LIVE_HIGHFID_MODEL_ID, model303Extra: extra };
    const bass2: Bass2Params = { ...DEFAULT_BASS2_PARAMS, model303: LIVE_HIGHFID_MODEL_ID, model303Extra: extra };
    const loaded = JSON.parse(JSON.stringify({ synthA, bass2 })) as { synthA: SynthParams; bass2: Bass2Params };
    expect(normalizeTB303VoiceExtra(loaded.synthA.model303Extra)).toEqual(extra);
    expect(normalizeTB303VoiceExtra(loaded.bass2.model303Extra)).toEqual(extra);
  });

  it('old songs carry nothing and malformed blobs are sanitized', () => {
    expect(normalizeTB303VoiceExtra(undefined)).toBeUndefined();
    expect(normalizeTB303VoiceExtra({})).toBeUndefined();
    expect(normalizeTB303VoiceExtra({ ab: { armed: 'yes', mix: 9 } })).toEqual({ ab: { armed: false, mix: 1 } });
  });
});

describe('freeze job (L2 side + L3 coefficients)', () => {
  it('live-highfid without stored coefficients freezes highfid-cpu with the canonical preset', () => {
    const job = resolveTB303FreezeJob({ model303: LIVE_HIGHFID_MODEL_ID });
    expect(job).toEqual({
      modelId: 'highfid-cpu',
      side: 'highfid',
      highFidCoefficients: { ...CANONICAL_HIGHFID_COEFFICIENTS },
      coefficientSource: 'canonical',
    });
  });

  it('uses the song coefficients when the song stored some', () => {
    const job = resolveTB303FreezeJob({
      model303: LIVE_HIGHFID_MODEL_ID,
      model303Extra: { highFidCoefficients: EDITED },
    });
    expect(job.coefficientSource).toBe('song');
    expect(job.highFidCoefficients).toEqual(EDITED);
  });

  it('A/B freezes one side, never a blend', () => {
    const stockSide = resolveTB303FreezeJob({
      model303: LIVE_HIGHFID_MODEL_ID,
      model303Extra: { ab: { armed: true, mix: 0.2 }, highFidCoefficients: EDITED },
    });
    expect(stockSide).toEqual({ modelId: 'stock-open303', side: 'stock' });
    const highSide = resolveTB303FreezeJob({
      model303: LIVE_HIGHFID_MODEL_ID,
      model303Extra: { ab: { armed: true, mix: 0.5 } },
    });
    expect(highSide.side).toBe('highfid');
    // Disarmed A/B freezes the selected voice whatever the stored blend.
    expect(resolveTB303FreezeJob({
      model303: LIVE_HIGHFID_MODEL_ID,
      model303Extra: { ab: { armed: false, mix: 0 } },
    }).side).toBe('highfid');
  });

  it('other voices freeze as themselves and ignore coefficients', () => {
    expect(resolveTB303FreezeJob({ model303: 'jc303', model303Extra: { highFidCoefficients: EDITED } }))
      .toEqual({ modelId: 'jc303', side: 'model' });
    expect(resolveTB303FreezeJob({ model303: 'gpu-highfid' }).modelId).toBe('gpu-highfid');
  });

  it('renders: canonical freeze is bit-identical to a plain highfid-cpu render', async () => {
    const frozen = await render303FreezeOffline({ model303: LIVE_HIGHFID_MODEL_ID }, PATTERN, {
      sync: true,
      sampleRate: 48000,
    });
    const plain = await render303OfflineWithMeta('highfid-cpu', PATTERN, { sync: true, sampleRate: 48000 });
    expect(frozen.job.coefficientSource).toBe('canonical');
    expect(bytes(frozen.buffer)).toEqual(bytes(plain.buffer));
  });

  it('renders: stored coefficients change the frozen audio and match the engine directly', async () => {
    const frozen = await render303FreezeOffline(
      { model303: LIVE_HIGHFID_MODEL_ID, model303Extra: { highFidCoefficients: EDITED } },
      PATTERN,
      { sync: true, sampleRate: 48000 },
    );
    const canonical = renderOfflineHighFid303Pattern(PATTERN, { sampleRate: 48000 });
    const direct = renderOfflineHighFid303Pattern({ ...PATTERN, highFidCoefficients: EDITED }, { sampleRate: 48000 });
    expect(frozen.job.coefficientSource).toBe('song');
    expect(bytes(frozen.buffer)).toEqual(bytes(direct));
    expect(bytes(frozen.buffer)).not.toEqual(bytes(canonical));
    for (const s of frozen.buffer) expect(Number.isFinite(s)).toBe(true);
  });

  it('each coefficient moves the diode ladder, and all at max stays finite and bounded', () => {
    const canonical = bytes(renderOfflineHighFid303Pattern(PATTERN, { sampleRate: 48000 }));
    for (const key of Object.keys(HIGHFID_COEFFICIENT_PARAM_IDS) as Array<keyof HighFidCoefficients>) {
      const edited = { ...CANONICAL_HIGHFID_COEFFICIENTS, [key]: key === 'accentCoupling' ? 1 : 0.8 };
      const out = renderOfflineHighFid303Pattern({ ...PATTERN, highFidCoefficients: edited }, { sampleRate: 48000 });
      expect(bytes(out), key).not.toEqual(canonical);
    }
    const extreme = renderOfflineHighFid303Pattern(
      { ...PATTERN, highFidCoefficients: { transistorMismatch: 1, decayCurve: 1, accentCoupling: 1, filterTracking: 1 } },
      { sampleRate: 48000, oversample: 2 },
    );
    for (const s of extreme) {
      expect(Number.isFinite(s)).toBe(true);
      expect(Math.abs(s)).toBeLessThanOrEqual(1.5);
    }
  });
});

describe('live A/B telemetry across parts', () => {
  it('an idle part re-synced after the engaged one does not wipe the HUD state', () => {
    const makeOsc = () => {
      const osc = new Open303Oscillator();
      const port = { postMessage: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() };
      Object.assign(osc as unknown as Record<string, unknown>, {
        workletNode: { port, connect: vi.fn(), disconnect: vi.fn() },
        audioContext: makeContext(0),
        gainNode: {},
        isReady: true,
      });
      return osc;
    };
    const lead = makeOsc();
    const bass = makeOsc();
    lead.setModel303(LIVE_HIGHFID_MODEL_ID);
    lead.setLiveAb({ armed: true, mix: 0.4 });
    bass.setLiveAb({ armed: false });
    bass.setHighFidCoefficients(undefined);
    let runtime = engineTelemetry.getRuntimeSnapshot();
    expect(runtime.liveAbEngaged).toBe(true);
    expect(runtime.liveAbMix).toBe(0.4);

    lead.setLiveAb({ armed: false });
    runtime = engineTelemetry.getRuntimeSnapshot();
    expect(runtime.liveAbEngaged).toBe(false);
  });
});
