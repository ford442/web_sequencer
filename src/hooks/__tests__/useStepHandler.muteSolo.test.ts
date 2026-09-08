import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStepHandler } from '../useStepHandler';
import { trackMuteSoloStore } from '../../stores/trackMuteSoloStore';
import { TRACK_KEYS } from '../../constants';
import type { Note, Pattern, PartSequence } from '../../types';
import type { TrackKey } from '../../constants/appDefaults';

/**
 * Mute / solo gating at the trigger point.
 *
 * The gate deliberately lives in `useStepHandler`, not `useScheduler`: the
 * playhead must keep advancing through silenced tracks.
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
    sequencerRef: ref({ setHighlight: vi.fn() }),
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

/** Renders the hook and hands back both the handler and the options it saw. */
function setup() {
  const engine = makeEngine();
  const options = makeOptions(engine, patternArmedOnStepZero());
  const { result } = renderHook(() => useStepHandler(options));
  return { engine, options, onStep: (step: number, time: number) => result.current.onStep(step, time) };
}

const synthTracksPlayed = (engine: ReturnType<typeof makeEngine>) =>
  engine.playSynth.mock.calls.map((c) => c[6]);
const drumsPlayed = (engine: ReturnType<typeof makeEngine>) =>
  engine.playDrum.mock.calls.map((c) => c[0]);

describe('useStepHandler mute/solo gating', () => {
  beforeEach(() => {
    trackMuteSoloStore.reset();
  });

  it('does not trigger a muted synth track but still triggers the others', () => {
    const { engine, onStep } = setup();
    trackMuteSoloStore.toggleMute('partA');

    onStep(0, 1.0);

    expect(synthTracksPlayed(engine)).toEqual(expect.arrayContaining(['partB', 'bass2']));
    expect(synthTracksPlayed(engine)).not.toContain('partA');
  });

  it('does not trigger a muted drum track', () => {
    const { engine, onStep } = setup();
    trackMuteSoloStore.toggleMute('kick');

    onStep(0, 1.0);

    expect(drumsPlayed(engine)).not.toContain('kick');
    expect(drumsPlayed(engine)).toEqual(expect.arrayContaining(['snare', 'openHat']));
  });

  it('does not trigger the sampler when the sampler track is muted', () => {
    const { engine, onStep } = setup();
    trackMuteSoloStore.toggleMute('sampler');

    onStep(0, 1.0);

    expect(engine.playSampler).not.toHaveBeenCalled();
  });

  it('sounds only the soloed track', () => {
    const { engine, onStep } = setup();
    trackMuteSoloStore.toggleSolo('bass2');

    onStep(0, 1.0);

    expect(synthTracksPlayed(engine)).toEqual(['bass2']);
    expect(engine.playDrum).not.toHaveBeenCalled();
    expect(engine.playSampler).not.toHaveBeenCalled();
  });

  it('sounds a track that is both muted and soloed', () => {
    const { engine, onStep } = setup();
    trackMuteSoloStore.toggleMute('partA');
    trackMuteSoloStore.toggleSolo('partA');

    onStep(0, 1.0);

    expect(synthTracksPlayed(engine)).toEqual(['partA']);
  });

  it('sounds every soloed track when several are soloed', () => {
    const { engine, onStep } = setup();
    trackMuteSoloStore.toggleSolo('partB');
    trackMuteSoloStore.toggleSolo('kick');

    onStep(0, 1.0);

    expect(synthTracksPlayed(engine)).toEqual(['partB']);
    expect(drumsPlayed(engine)).toEqual(['kick']);
  });

  it('keeps the playhead advancing with every track muted', () => {
    const { engine, options, onStep } = setup();
    for (const key of TRACK_KEYS) trackMuteSoloStore.toggleMute(key);

    onStep(7, 1.0);

    // Playhead advanced: step ref and the sequencer highlight both moved.
    expect(options.currentStepRef.current).toBe(7);
    expect(options.sequencerRef.current!.setHighlight).toHaveBeenCalledWith(7);

    // ...and nothing sounded.
    expect(engine.playSynth).not.toHaveBeenCalled();
    expect(engine.playDrum).not.toHaveBeenCalled();
    expect(engine.playSampler).not.toHaveBeenCalled();

    onStep(8, 1.5);
    expect(options.currentStepRef.current).toBe(8);
    expect(options.sequencerRef.current!.setHighlight).toHaveBeenCalledWith(8);
  });

  it('stops the voices of a track exactly once when it becomes silenced', () => {
    const { engine, onStep } = setup();

    onStep(0, 1.0);
    expect(engine.stopTrackNotes).not.toHaveBeenCalled();

    trackMuteSoloStore.toggleMute('partA');
    onStep(1, 1.5);
    expect(engine.stopTrackNotes).toHaveBeenCalledWith('partA');
    expect(engine.stopTrackNotes).toHaveBeenCalledTimes(1);

    // A muted track never triggers, so there is nothing left to release.
    onStep(2, 2.0);
    expect(engine.stopTrackNotes).toHaveBeenCalledTimes(1);
  });

  it('stops every non-soloed track when a solo is engaged', () => {
    const { engine, onStep } = setup();

    onStep(0, 1.0);
    trackMuteSoloStore.toggleSolo('bass2');
    onStep(1, 1.5);

    const stopped = engine.stopTrackNotes.mock.calls.map((c) => c[0]);
    expect(stopped).toEqual(expect.arrayContaining(['partA', 'partB', 'kick', 'sampler']));
    expect(stopped).not.toContain('bass2');
  });
});
