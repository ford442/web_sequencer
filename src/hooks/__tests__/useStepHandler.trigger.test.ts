import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStepHandler } from '../useStepHandler';
import type { Note, Pattern, PartSequence } from '../../types';
import type { TrackKey } from '../../constants/appDefaults';
import { transportMixStore } from '../../stores/transportMixStore';
import { resolveSongMeter } from '../../utils/songMeter';

/**
 * Trigger dispatch for the sequencer's eight tracks.
 *
 * Diagnosis note: this suite passes even when the app is badly broken — with the
 * Open303/Prophecy worklets failing to instantiate, `useStepHandler` still calls
 * `playSynth`/`playDrum` for every armed step and the voices merely degrade to a
 * JS fallback. It is here to keep dispatch honest while the engine layer is
 * changed, NOT as the regression guard for that bug (see
 * Open303Oscillator.readiness.test.ts).
 */

const NUM_STEPS = 32;

const emptySeq = (): PartSequence => ({
  steps: Array.from({ length: NUM_STEPS }, () => null as Note | null),
});

/** A pattern with exactly one note on step 0 of every track. */
function patternArmedOnStepZero(): Pattern {
  const armed = (): PartSequence => {
    const seq = emptySeq();
    seq.steps[0] = { note: 'C3', velocity: 1, length: 1 };
    return seq;
  };
  return {
    partA: armed(),
    partB: armed(),
    bass2: armed(),
    kick: armed(),
    snare: armed(),
    closedHat: armed(),
    openHat: armed(),
    sampler: Array.from({ length: 8 }, (_, i) => (i === 0 ? armed() : emptySeq())),
  } as unknown as Pattern;
}

const ref = <T,>(current: T) => ({ current });

function makeEngine() {
  return {
    context: { currentTime: 0, sampleRate: 48000 },
    playSynth: vi.fn(),
    playDrum: vi.fn(),
    playSampler: vi.fn(),
    stopTrackNotes: vi.fn(),
    open303Engine: null,
    updateSamplerVoiceParams: vi.fn(),
  };
}

function makeOptions(engine: ReturnType<typeof makeEngine>, pattern: Pattern) {
  const trackStorage = {} as Record<TrackKey, (PartSequence | PartSequence[] | null)[]>;
  return {
    audioEngine: engine as never,
    tempo: 120,
    onParamChange: undefined,
    currentStepRef: ref(-1),
    sequencerRef: ref(null),
    patternRef: ref(pattern),
    lastFreqRef: ref({} as Record<string, number>),
    lastSamplerMidiRef: ref({} as Record<number, number>),
    lastSamplerFormantRef: ref({} as Record<number, number>),
    synthARef: ref({ waveform: 'sawtooth' } as never),
    synthBRef: ref({ waveform: 'sawtooth' } as never),
    bass2Ref: ref({ waveform: 'sawtooth', cutoff: 0.5, resonance: 0.5, decay: 0.3, volume: 0.8 } as never),
    kickRef: ref({}),
    snareRef: ref({}),
    closedHatRef: ref({}),
    openHatRef: ref({}),
    currentScaleRef: ref(null),
    samplerRef: ref(Array.from({ length: 8 }, () => ({})) as never),
    samplerVoiceParamsRef: ref({
      drive: 0, rootNote: 60, coarseTune: 0, fineTune: 0, formantShift: 0,
      attack: 0.01, decay: 0.2, stretchProfile: 'vocal', stretchMode: 'Time',
      lockToSequencer: false,
    } as never),
    activeSamplerBankRef: ref(0),
    sliceHighlightRef: ref(null),
    isSongModeActiveRef: ref(false),
    songStructureRef: ref([]),
    songMeasureRef: ref(0),
    isFirstStepRef: ref(true),
    trackStorageRef: ref(trackStorage),
    setCurrentSongMeasure: vi.fn(),
  } as unknown as Parameters<typeof useStepHandler>[0];
}

describe('useStepHandler trigger dispatch', () => {
  it('fires exactly one trigger per armed track on the armed step', () => {
    const engine = makeEngine();
    const { result } = renderHook(() =>
      useStepHandler(makeOptions(engine, patternArmedOnStepZero())),
    );

    result.current.onStep(0, 1.0);

    const synthTracks = engine.playSynth.mock.calls.map((c) => c[6]);
    expect(synthTracks).toEqual(expect.arrayContaining(['partA', 'partB', 'bass2']));
    expect(synthTracks).toHaveLength(3);

    const drums = engine.playDrum.mock.calls.map((c) => c[0]);
    // openHat armed on this step suppresses closedHat by design.
    expect(drums).toEqual(expect.arrayContaining(['kick', 'snare', 'openHat']));

    expect(engine.playSampler).toHaveBeenCalledTimes(1);
  });

  it('fires nothing on a step where no track is armed', () => {
    const engine = makeEngine();
    const { result } = renderHook(() =>
      useStepHandler(makeOptions(engine, patternArmedOnStepZero())),
    );

    result.current.onStep(5, 1.0);

    expect(engine.playSynth).not.toHaveBeenCalled();
    expect(engine.playDrum).not.toHaveBeenCalled();
    expect(engine.playSampler).not.toHaveBeenCalled();
  });
});

describe('useStepHandler pattern length and per-track loops', () => {
  afterEach(() => transportMixStore.reset());

  /** bass2 and closedHat armed on step 0 only; everything else empty. */
  function bassAndHatPattern(): Pattern {
    const armed = (): PartSequence => {
      const seq = emptySeq();
      seq.steps[0] = { note: 'C2', velocity: 1, length: 1 };
      return seq;
    };
    return {
      partA: emptySeq(), partB: emptySeq(), bass2: armed(), kick: emptySeq(),
      snare: emptySeq(), closedHat: armed(), openHat: emptySeq(),
      sampler: Array.from({ length: 8 }, () => emptySeq()),
    } as unknown as Pattern;
  }

  /** Feed `count` clock ticks for a `stepCount`-step pattern; return abs steps that fired each track. */
  function drive(onStep: (step: number, time: number, abs: number) => void, engine: ReturnType<typeof makeEngine>, stepCount: number, count: number) {
    const hats: number[] = [];
    const bass: number[] = [];
    for (let abs = 0; abs < count; abs++) {
      const synthBefore = engine.playSynth.mock.calls.length;
      const drumBefore = engine.playDrum.mock.calls.length;
      onStep(abs % stepCount, 1 + abs * 0.125, abs);
      if (engine.playSynth.mock.calls.slice(synthBefore).some((c) => c[6] === 'bass2')) bass.push(abs);
      if (engine.playDrum.mock.calls.slice(drumBefore).some((c) => c[0] === 'closedHat')) hats.push(abs);
    }
    return { hats, bass };
  }

  it('wraps a 16-step pattern on the clock step', () => {
    transportMixStore.applyMeter(resolveSongMeter({ stepCount: 16 }));
    const engine = makeEngine();
    const { result } = renderHook(() => useStepHandler(makeOptions(engine, bassAndHatPattern())));
    const { bass, hats } = drive(result.current.onStep, engine, 16, 48);
    expect(bass).toEqual([0, 16, 32]);
    expect(hats).toEqual([0, 16, 32]);
  });

  it('loops a 12-step hat against a 16-step bass without drift', () => {
    transportMixStore.applyMeter(resolveSongMeter({ stepCount: 16, trackLengths: { closedHat: 12 } }));
    const engine = makeEngine();
    const { result } = renderHook(() => useStepHandler(makeOptions(engine, bassAndHatPattern())));
    const { bass, hats } = drive(result.current.onStep, engine, 16, 48);
    expect(bass).toEqual([0, 16, 32]);
    expect(hats).toEqual([0, 12, 24, 36]);
  });

  it('re-anchors track loops at each Song Mode measure', () => {
    transportMixStore.applyMeter(resolveSongMeter({ stepCount: 16, trackLengths: { closedHat: 12 } }));
    const engine = makeEngine();
    const pattern = bassAndHatPattern();
    const options = makeOptions(engine, pattern) as unknown as Record<string, { current: unknown }>;
    const storage = {} as Record<TrackKey, (PartSequence | PartSequence[] | null)[]>;
    for (const key of ['partA', 'partB', 'bass2', 'kick', 'snare', 'closedHat', 'openHat'] as const) storage[key] = [pattern[key]];
    storage.sampler = [pattern.sampler];
    const slot0 = { partA: 0, partB: 0, bass2: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: 0 };
    options.isSongModeActiveRef.current = true;
    options.songStructureRef.current = [slot0, slot0];
    options.trackStorageRef.current = storage;
    const { result } = renderHook(() => useStepHandler(options as unknown as Parameters<typeof useStepHandler>[0]));
    const { hats } = drive(result.current.onStep, engine, 16, 32);
    expect(hats).toEqual([0, 12, 16, 28]);
  });
});
