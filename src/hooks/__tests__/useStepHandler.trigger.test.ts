import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStepHandler } from '../useStepHandler';
import type { Note, Pattern, PartSequence } from '../../types';
import type { TrackKey } from '../../constants/appDefaults';

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
