/**
 * An AI song must not claim more than it plays: every lane or field that
 * validates, imports and saves but that no engine hears is a warning naming its
 * path, and `strict` turns the first one into a VALIDATION_ERROR.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import full from '../../test-fixtures/ai-song/full.json';
import {
  AISongImporter,
  convertAISong,
  type AIAutomationLane,
  type AISongData,
} from '../importers/ai-song';
import { ROUTED_AUTOMATION, laneDispatchGap } from '../audio/automation/laneResolver';
import { VALID_PARAMETERS_BY_TARGET } from '../importers/ai-song/automation';
import { useSongStorage, type SongStorageDeps } from '../hooks/useSongStorage';
import { useScheduler } from '../hooks/useScheduler';
import { transportMixStore } from '../stores/transportMixStore';
import { resolveSongMeter } from '../utils/songMeter';
import { swingPercentToClock } from '../utils/musicTheory';
import { UPDATED_INITIAL_PATTERN } from '../constants/appDefaults';
import { createArrangement } from '../arrangement/model';
import { TransportClockController, transportClockController } from '../midi/clock/TransportClockController';
import { InternalClockAdapter } from '../midi/clock/InternalClockAdapter';

const base = full as unknown as AISongData;

const lane = (target: string, parameter: string, steps = 32): AIAutomationLane => ({
  target: target as AIAutomationLane['target'],
  parameter: parameter as AIAutomationLane['parameter'],
  steps: Array.from({ length: steps }, (_, i) => (i % 4 === 0 ? (i * 4) % 128 : null)),
  interpolation: 'linear',
});

/** One no-op lane per category in the issue. */
const NO_OP_LANES = {
  'a drum target': lane('kick', 'decay'),
  'the sampler target': lane('sampler', 'volume'),
  'a synth parameter with no dispatch case': lane('synthA', 'filterMode'),
  'synth pitch': lane('synthB', 'pitch'),
  'a delay parameter': lane('synthA', 'delayMix'),
  'master tempo': lane('master', 'tempo'),
  'master swing': lane('master', 'swing'),
  'master volume': lane('master', 'masterVolume'),
} as const;

function withLanes(...extra: AIAutomationLane[]): AISongData {
  return { ...base, automation: [...(base.automation ?? []), ...extra] };
}

describe('AI song importer — lanes nothing plays', () => {
  it('imports the reference song without a single warning', () => {
    const result = convertAISong(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.report.warnings).toEqual([]);
  });

  it.each(Object.entries(NO_OP_LANES))('warns once for %s and keeps the lane', (_, noOp) => {
    const laneIndex = base.automation!.length;
    const result = convertAISong(withLanes(noOp));
    if (!result.success) throw new Error(JSON.stringify(result.error));

    const key = `${noOp.target}.${noOp.parameter}`;
    expect(result.report.warnings).toEqual([
      expect.stringMatching(new RegExp(`^automation\\[${laneIndex}\\] ${key} is saved but never plays: `)),
    ]);
    expect(result.song.automationLanes).toContainEqual(
      expect.objectContaining({ target: noOp.target, parameter: noOp.parameter, source: 'ai' }),
    );
    expect(result.song.automationLanes).toHaveLength(base.automation!.length + 1);
  });

  it('warns per lane, in lane order, with the whole set at once', () => {
    const noOps = Object.values(NO_OP_LANES);
    const result = convertAISong(withLanes(...noOps));
    if (!result.success) throw new Error(JSON.stringify(result.error));
    expect(result.report.warnings).toHaveLength(noOps.length);
    noOps.forEach((noOp, i) => {
      expect(result.report.warnings[i]).toContain(`automation[${base.automation!.length + i}] ${noOp.target}.${noOp.parameter}`);
    });
  });

  it('does not warn for a lane with no value on any step (it is not stored)', () => {
    const empty = { ...lane('kick', 'decay'), steps: Array<number | null>(32).fill(null) };
    const result = convertAISong(withLanes(empty));
    if (!result.success) throw new Error(JSON.stringify(result.error));
    expect(result.report.warnings).toEqual([]);
    expect(result.song.automationLanes).toHaveLength(base.automation!.length);
  });

  it('stays quiet for every routed target/parameter the AI vocabulary has', () => {
    for (const [target, entry] of Object.entries(ROUTED_AUTOMATION)) {
      const valid = VALID_PARAMETERS_BY_TARGET[target as keyof typeof VALID_PARAMETERS_BY_TARGET] ?? [];
      for (const parameter of valid.filter((p) => entry!.parameters.includes(p))) {
        if (entry!.unattached) continue;
        const result = convertAISong(withLanes(lane(target, parameter)));
        expect(result.success && result.report.warnings, `${target}.${parameter}`).toEqual([]);
      }
    }
  });

  it('agrees with ROUTED_AUTOMATION for every pair the AI format accepts', () => {
    for (const [target, parameters] of Object.entries(VALID_PARAMETERS_BY_TARGET)) {
      for (const parameter of parameters) {
        const result = convertAISong(withLanes(lane(target, parameter)));
        // `automation.ts` and `types.ts` keep separate vocabularies (sampler.pitch is
        // only in the first); this test is about pairs the importer accepts.
        if (!result.success && result.error.type === 'VALIDATION_ERROR' && result.error.field.endsWith('.parameter')) continue;
        if (!result.success) throw new Error(`${target}.${parameter}: ${JSON.stringify(result.error)}`);
        const warned = result.report.warnings.some((w) => w.includes(`${target}.${parameter} is saved but never plays`));
        expect(warned, `${target}.${parameter}`).toBe(laneDispatchGap(target as never, parameter) !== null);
      }
    }
  });

  it('names pattern-local lanes by their pattern path (v1.1)', () => {
    const song = {
      meta: { ...base.meta, version: '1.1' },
      globals: { tempo: 120, stepCount: 16 },
      patterns: {
        main: {
          tracks: {
            kick: Array.from({ length: 16 }, (_, i) => i % 4 === 0),
            snare: Array.from({ length: 16 }, (_, i) => i % 8 === 4),
            synthA: { notes: [{ step: 0, note: 'C2' }] },
          },
          automation: [lane('synthA', 'filterCutoff', 16), lane('snare', 'tone', 16)],
        },
      },
      song: [{ kick: 'main', synthA: 'main', snare: 'main' }],
    } as unknown as AISongData;
    const result = convertAISong(song);
    if (!result.success) throw new Error(JSON.stringify(result.error));
    expect(result.report.warnings).toEqual([
      expect.stringMatching(/^patterns\.main\.automation\[1\] snare\.tone is saved but never plays/),
    ]);
  });
});

describe('AI song importer — fields nothing attaches', () => {
  const harmonizer = {
    enabled: true, voices: 3, harmonyType: 'fifth', formantShift: 0, detune: 0, spread: 50,
  };
  const phonemePainter = { enabled: true, text: 'la', mapping: [{ step: 0, phoneme: 'l' }] };

  function withExtras(enabled = true): AISongData {
    const song = structuredClone(base);
    song.tracks!.synthA!.harmonizer = { ...harmonizer, enabled } as never;
    song.tracks!.sampler![1].phonemePainter = { ...phonemePainter, enabled };
    return song;
  }

  it('warns for an enabled harmonizer and phoneme painter', () => {
    const result = convertAISong(withExtras());
    if (!result.success) throw new Error(JSON.stringify(result.error));
    expect(result.report.warnings).toEqual([
      'tracks.synthA.harmonizer is ignored: the importer does not attach harmonizer settings to the song.',
      'tracks.sampler[1].phonemePainter is ignored: the importer does not attach phoneme painter settings to the song.',
    ]);
  });

  it('does not warn for one that is switched off', () => {
    const result = convertAISong(withExtras(false));
    expect(result.success && result.report.warnings).toEqual([]);
  });
});

describe('AI song importer — strict mode', () => {
  it('imports the reference song', () => {
    expect(convertAISong(base, { strict: true }).success).toBe(true);
  });

  it('rejects a no-op lane with the lane path as the field', () => {
    const index = base.automation!.length;
    const result = convertAISong(withLanes(NO_OP_LANES['a drum target']), { strict: true });
    expect(result).toEqual({
      success: false,
      error: {
        type: 'VALIDATION_ERROR',
        field: `automation[${index}]`,
        message: `automation[${index}] kick.decay is saved but never plays: the scheduler routes no kick lanes.`,
      },
    });
  });

  it('rejects an ignored harmonizer with its path', () => {
    const song = structuredClone(base);
    song.tracks!.bass2!.harmonizer = { enabled: true, voices: 2, harmonyType: 'octave', formantShift: 0, detune: 0, spread: 0 };
    const result = convertAISong(song, { strict: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatchObject({ type: 'VALIDATION_ERROR', field: 'tracks.bass2.harmonizer' });
    }
  });

  it('rejects a dropped note with the note path', () => {
    const song = structuredClone(base);
    song.tracks!.synthA!.notes.push({ step: 40, note: 'C2' });
    const result = convertAISong(song, { strict: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toMatchObject({
        type: 'VALIDATION_ERROR',
        field: `tracks.synthA.notes[${song.tracks!.synthA!.notes.length - 1}].step`,
      });
    }
  });

  it('reports the first warning and counts the rest', () => {
    const result = convertAISong(withLanes(lane('kick', 'decay'), lane('master', 'tempo')), { strict: true });
    const first = base.automation!.length;
    expect(result.success).toBe(false);
    if (!result.success && result.error.type === 'VALIDATION_ERROR') {
      expect(result.error.field).toBe(`automation[${first}]`);
      expect(result.error.message).toContain(`(and 1 more warning: automation[${first + 1}])`);
    }
  });

  it('is off by default: the same song imports with its warnings', () => {
    const song = withLanes(lane('kick', 'decay'));
    expect(new AISongImporter().convert(song).success).toBe(true);
    expect(new AISongImporter().convert(song, { strict: false }).success).toBe(true);
  });

  it('does not leak a previous convert()\'s warnings into the next', () => {
    const importer = new AISongImporter();
    expect(importer.convert(withLanes(lane('kick', 'decay')), { strict: true }).success).toBe(false);
    expect(importer.convert(base, { strict: true }).success).toBe(true);
  });
});

describe('an imported swing reaches the transport clock', () => {
  afterEach(() => transportMixStore.reset());

  function makeDeps(): SongStorageDeps {
    const target: Record<string, unknown> = {
      patternRef: { current: UPDATED_INITIAL_PATTERN },
      tempoRef: { current: 120 },
      trackStorageRef: { current: {} },
      activeTrackSlotsRef: { current: {} },
      songStructureRef: { current: [] },
      arrangementRef: { current: createArrangement(32) },
      ambianceUrl: '',
      backgroundImage: '',
      sampleBuffers: [],
      ttsPhrases: [],
      songStorage: [],
      pattern: UPDATED_INITIAL_PATTERN,
      tempo: 120,
      trackStorage: {},
      audioEngine: null,
    };
    return new Proxy(target, {
      get(t, key: string) {
        if (!(key in t)) t[key] = key.endsWith('Ref') ? { current: {} } : vi.fn();
        return t[key];
      },
    }) as unknown as SongStorageDeps;
  }

  const swing66 = { ...base, globals: { ...base.globals, swing: 66 } } as AISongData;

  it('carries the authored percent onto the song meter', () => {
    const result = convertAISong(swing66);
    if (!result.success) throw new Error(JSON.stringify(result.error));
    expect(result.song.swing).toBe(66);
    expect(resolveSongMeter(result.song).swing).toBe(66);
  });

  it('defaults to straight (50) when the song has none', () => {
    const { swing: _, ...globals } = base.globals;
    const result = convertAISong({ ...base, globals } as AISongData);
    if (!result.success) throw new Error(JSON.stringify(result.error));
    expect(resolveSongMeter(result.song).swing).toBe(50);
    expect(swingPercentToClock(50)).toBe(0);
  });

  it('maps the MPC percent onto the clock scale: 50 straight → 0, 75 → 1', () => {
    expect(swingPercentToClock(50)).toBe(0);
    expect(swingPercentToClock(62.5)).toBeCloseTo(0.5);
    expect(swingPercentToClock(66)).toBeCloseTo(0.64);
    expect(swingPercentToClock(75)).toBe(1);
    expect(swingPercentToClock(100)).toBe(1);
  });

  it('loads into the store and reaches InternalClockAdapter.setSwing as 0.64', async () => {
    const result = convertAISong(swing66);
    if (!result.success) throw new Error(JSON.stringify(result.error));

    // Load the imported song the way the app does (useSongStorage → applyMeter).
    const { result: storage } = renderHook(() => useSongStorage(makeDeps()));
    await act(() => storage.current.loadCloudData(result.song, 'song'));
    expect(transportMixStore.getMeter().swing).toBe(66);

    // A running internal clock: the WebKit path needs no AudioWorklet.
    const ua = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    });
    const ctx = {
      state: 'running', currentTime: 0, resume: vi.fn(), audioWorklet: { addModule: vi.fn() }, destination: {},
    } as unknown as AudioContext;
    const setSwing = vi.spyOn(InternalClockAdapter.prototype, 'setSwing');
    const controller = new TransportClockController();
    controller.setContext(ctx);
    controller.start();
    const spy = vi.spyOn(transportClockController, 'setSwing').mockImplementation((v) => controller.setSwing(v));

    try {
      // useAppState passes swingPercentToClock(swing) to useScheduler.
      renderHook(() => useScheduler(120, 32, vi.fn(), false, ctx, swingPercentToClock(transportMixStore.getMeter().swing)));
      expect(spy).toHaveBeenLastCalledWith(swingPercentToClock(66));
      expect(setSwing).toHaveBeenLastCalledWith(expect.closeTo(0.64, 10));
    } finally {
      controller.dispose();
      spy.mockRestore();
      setSwing.mockRestore();
      Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ua });
    }
  });
});
