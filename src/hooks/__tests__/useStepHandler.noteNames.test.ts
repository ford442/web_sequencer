import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStepHandler } from '../useStepHandler';
import type { Note, Pattern, PartSequence } from '../../types';
import type { TrackKey } from '../../constants/appDefaults';
import { createArrangement } from '@/arrangement/model';

/**
 * The step handler parses note names in two places of its own: the chord
 * inversion and the sampler's slide source. A flat has to keep its pitch there,
 * and a name that is not a note must never be read as MIDI 0 — it drops out of
 * the voicing / leaves no slide source behind.
 */

const NUM_STEPS = 32;

const emptySeq = (): PartSequence => ({
  steps: Array.from({ length: NUM_STEPS }, () => null as Note | null),
});

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
    arrangementRef: ref(createArrangement(32)),
    songMeasureRef: ref(0),
    isFirstStepRef: ref(true),
    trackStorageRef: ref(trackStorage),
    setCurrentSongMeasure: vi.fn(),
  } as unknown as Parameters<typeof useStepHandler>[0];
}


/** A pattern with `partA` carrying `step` on step 0 and an inversion automation value. */
function patternWithPartA(step: Note, inversion = 0): Pattern {
  const empty = (): PartSequence => emptySeq();
  const partA = emptySeq();
  partA.steps[0] = step;
  partA.automation = { chordInversion: [inversion] } as never;
  return {
    partA, partB: empty(), bass2: empty(), kick: empty(), snare: empty(), closedHat: empty(), openHat: empty(),
    sampler: Array.from({ length: 8 }, () => empty()),
  } as unknown as Pattern;
}

/** The note list partA's step 0 reaches the engine with. */
function dispatchedChord(step: Note, inversion: number): string[] | string {
  const engine = makeEngine();
  const seen: Array<string | string[]> = [];
  engine.playSynth.mockImplementation((...args: unknown[]) => {
    const notes = args[1] as string | string[];
    seen.push(Array.isArray(notes) ? [...notes] : notes); // the handler reuses its scratch array
  });
  const { result } = renderHook(() => useStepHandler(makeOptions(engine, patternWithPartA(step, inversion))));
  result.current.onStep(0, 1.0);
  expect(seen).toHaveLength(1);
  return seen[0];
}

describe('useStepHandler chord inversion with note names', () => {
  it('inverts a chord spelled with flats at the pitch the flats sound', () => {
    // Eb3 G3 Bb3 = 51 55 58; one inversion lifts the lowest an octave: 55 58 63.
    const notes = dispatchedChord({ note: 'Eb3', chord: ['G3', 'Bb3'], velocity: 1, length: 1 }, 0.5);
    expect(notes).toEqual(['G3', 'A#3', 'D#4']);
  });

  it('inverts the same chord the same way whichever way it is spelled', () => {
    const flats = dispatchedChord({ note: 'Eb3', chord: ['G3', 'Bb3'], velocity: 1, length: 1 }, 1);
    const sharps = dispatchedChord({ note: 'D#3', chord: ['G3', 'A#3'], velocity: 1, length: 1 }, 1);
    expect(flats).toEqual(sharps);
  });

  it('leaves a name that is not a note out of the voicing instead of sorting it in as MIDI 0', () => {
    // C3 E3 + "Hb4": the bad name never sounds, so the inversion is of C3 E3 → E3 C4.
    const notes = dispatchedChord({ note: 'C3', chord: ['Hb4', 'E3'], velocity: 1, length: 1 }, 1);
    expect(notes).toEqual(['E3', 'C4']);
  });

  it('does not touch the chord when the inversion is off', () => {
    const notes = dispatchedChord({ note: 'Eb3', chord: ['G3', 'Bb3'], velocity: 1, length: 1 }, 0);
    expect(notes).toEqual(['Eb3', 'G3', 'Bb3']);
  });
});

describe('useStepHandler sampler slide source', () => {
  function samplerStepRun(note: string, previous: number | undefined) {
    const engine = makeEngine();
    const pattern = patternWithPartA({ note: 'C3', velocity: 1, length: 1 });
    pattern.partA.steps[0] = null;
    (pattern.sampler as unknown as PartSequence[])[0].steps[0] = { note, velocity: 1, length: 1 };
    const options = makeOptions(engine, pattern) as unknown as { lastSamplerMidiRef: { current: Record<number, number> } };
    if (previous !== undefined) options.lastSamplerMidiRef.current[0] = previous;
    const { result } = renderHook(() => useStepHandler(options as unknown as Parameters<typeof useStepHandler>[0]));
    result.current.onStep(0, 1.0);
    expect(engine.playSampler).toHaveBeenCalledTimes(1);
    return options.lastSamplerMidiRef.current[0];
  }

  it('remembers a flat at its pitch', () => {
    expect(samplerStepRun('Eb3', undefined)).toBe(51);
  });

  it('forgets the previous note when the name is not a note, rather than sliding from MIDI 0', () => {
    expect(samplerStepRun('Hb4', 60)).toBeUndefined();
  });
});
