import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStepHandler } from '../useStepHandler';
import type { Arrangement, Note, Pattern, PartSequence } from '../../types';
import type { TrackKey } from '../../constants/appDefaults';
import { transportMixStore } from '../../stores/transportMixStore';
import { resolveSongMeter } from '../../utils/songMeter';
import { createArrangement, placeClip, songStructureToArrangement } from '@/arrangement/model';
import { arrangementPlayhead } from '@/arrangement/playhead';
import { createEmptyMeasure } from '@/utils/songModeEditing';
import { SessionLaunchEngine } from '@/session/SessionLaunchEngine';
import { createDefaultSessionDocument } from '@/session/defaults';
import { secondsPerStep } from '@/session/quantize';
import { automationStore } from '../../stores/automationStore';
import { resolveLaneTimeline, resolveOpen303ParamSteps } from '@/audio/automation/laneResolver';
import type { UnifiedAutomationLane } from '../../types';

/** The linear player (#1342): Song Mode playback reads arrangement clips. */

const ref = <T,>(current: T) => ({ current });

/** A 16-step kick pattern with hits at `hits`. */
function kickSeq(hits: number[]): PartSequence {
  const steps = Array.from({ length: 16 }, () => null as Note | null);
  for (const h of hits) steps[h] = { note: 'C2', velocity: 1, length: 1 };
  return { steps };
}

const emptySeq = (): PartSequence => ({ steps: [] });

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

function makeStorage(kickSlots: PartSequence[]) {
  const storage = {} as Record<TrackKey, (PartSequence | PartSequence[] | null)[]>;
  for (const key of ['partA', 'partB', 'bass2', 'snare', 'closedHat', 'openHat'] as const) storage[key] = [emptySeq()];
  storage.kick = kickSlots;
  storage.sampler = [Array.from({ length: 8 }, emptySeq)];
  return storage;
}

function makeOptions(engine: ReturnType<typeof makeEngine>, arrangement: Arrangement, kickSlots: PartSequence[]) {
  const pattern = {
    partA: emptySeq(), partB: emptySeq(), bass2: emptySeq(), kick: emptySeq(),
    snare: emptySeq(), closedHat: emptySeq(), openHat: emptySeq(),
    sampler: Array.from({ length: 8 }, emptySeq),
  } as unknown as Pattern;
  const isSongModeActiveRef = ref(true);
  return {
    audioEngine: engine as never,
    tempo: 120,
    currentStepRef: ref(-1),
    sequencerRef: ref(null),
    patternRef: ref(pattern),
    lastFreqRef: ref({} as Record<string, number>),
    lastSamplerMidiRef: ref({} as Record<number, number>),
    lastSamplerFormantRef: ref({} as Record<number, number>),
    synthARef: ref({ waveform: 'sawtooth' } as never),
    synthBRef: ref({ waveform: 'sawtooth' } as never),
    bass2Ref: ref({ waveform: 'sawtooth' } as never),
    kickRef: ref({}),
    snareRef: ref({}),
    closedHatRef: ref({}),
    openHatRef: ref({}),
    currentScaleRef: ref(null),
    samplerRef: ref(Array.from({ length: 8 }, () => ({})) as never),
    samplerVoiceParamsRef: ref({ rootNote: 60, lockToSequencer: false } as never),
    activeSamplerBankRef: ref(0),
    sliceHighlightRef: ref(null),
    isSongModeActiveRef,
    arrangementRef: ref(arrangement),
    songMeasureRef: ref(0),
    isFirstStepRef: ref(true),
    trackStorageRef: ref(makeStorage(kickSlots)),
    setCurrentSongMeasure: vi.fn(),
    setIsSongModeActive: vi.fn((active: boolean) => { isSongModeActiveRef.current = active; }),
  };
}

/** Feed `count` clock ticks (wrapping at `stepCount`); return the abs steps a kick fired on. */
function drive(
  onStep: (step: number, time: number, abs: number) => void,
  engine: ReturnType<typeof makeEngine>,
  stepCount: number,
  count: number,
  onTick?: (abs: number) => void,
): number[] {
  const kicks: number[] = [];
  for (let abs = 0; abs < count; abs++) {
    onTick?.(abs);
    const before = engine.playDrum.mock.calls.length;
    // Each step is "now" here — the playhead paints at once (no lookahead).
    const time = 1 + abs * secondsPerStep(120);
    engine.context.currentTime = time;
    onStep(abs % stepCount, time, abs);
    if (engine.playDrum.mock.calls.slice(before).some((c) => c[0] === 'kick')) kicks.push(abs);
  }
  return kicks;
}

describe('useStepHandler — arrangement (linear player)', () => {
  afterEach(() => {
    transportMixStore.reset();
    arrangementPlayhead.publish(-1);
  });

  it('plays a migrated v4 song exactly like Song Mode did (measure by measure, looping)', () => {
    transportMixStore.applyMeter(resolveSongMeter({ stepCount: 16 }));
    const engine = makeEngine();
    const structure = [
      { ...createEmptyMeasure(), kick: 0 },
      { ...createEmptyMeasure(), kick: 1 },
      createEmptyMeasure(),
    ];
    const options = makeOptions(engine, songStructureToArrangement(structure, 16), [kickSeq([0]), kickSeq([8])]);
    const { result } = renderHook(() => useStepHandler(options as never));
    const kicks = drive(result.current.onStep, engine, 16, 96);
    // Measure 0 slot 0 → 0; measure 1 slot 1 → 16+8; measure 2 empty; then the song loops.
    expect(kicks).toEqual([0, 24, 48, 72]);
    expect(options.songMeasureRef.current).toBe(2);
  });

  it('stops a trimmed clip at its trim and leaves the gap silent', () => {
    transportMixStore.applyMeter(resolveSongMeter({ stepCount: 16 }));
    const engine = makeEngine();
    const arr = placeClip(createArrangement(16), { id: 'k', track: 'kick', patternSlot: 0, startStep: 0, lengthSteps: 8, loop: true });
    const options = makeOptions(engine, arr, [kickSeq([0, 4, 8, 12])]);
    const { result } = renderHook(() => useStepHandler(options as never));
    expect(drive(result.current.onStep, engine, 16, 32)).toEqual([0, 4, 16, 20]);
  });

  it('starts an off-grid clip on its own step and loops at the arrangement length, not the clock', () => {
    transportMixStore.applyMeter(resolveSongMeter({ stepCount: 16 }));
    const engine = makeEngine();
    // 24-step song: clip from step 6, pattern restarts at local 0.
    const arr = placeClip(createArrangement(24), { id: 'k', track: 'kick', patternSlot: 0, startStep: 6, lengthSteps: 18, loop: true });
    const options = makeOptions(engine, arr, [kickSeq([0])]);
    const { result } = renderHook(() => useStepHandler(options as never));
    const kicks = drive(result.current.onStep, engine, 16, 48);
    // 6 and 6+16=22 in the first pass; the song wraps at 24, so 24+6, 24+22.
    expect(kicks).toEqual([6, 22, 30, 46]);
  });

  it('publishes the song position for the timeline playhead', () => {
    transportMixStore.applyMeter(resolveSongMeter({ stepCount: 16 }));
    const engine = makeEngine();
    const options = makeOptions(engine, createArrangement(32), [kickSeq([])]);
    const { result } = renderHook(() => useStepHandler(options as never));
    const seen: number[] = [];
    const off = arrangementPlayhead.subscribe((s) => seen.push(s));
    drive(result.current.onStep, engine, 16, 34);
    off();
    expect(seen.slice(0, 3)).toEqual([0, 1, 2]);
    expect(seen.slice(-3)).toEqual([31, 0, 1]);
  });

  it('a live session launch still preempts the arrangement at the quantized boundary', () => {
    transportMixStore.applyMeter(resolveSongMeter({ stepCount: 16 }));
    const engine = makeEngine();
    const arr = songStructureToArrangement([{ ...createEmptyMeasure(), kick: 0 }], 16);
    const options = makeOptions(engine, arr, [kickSeq([0]), kickSeq([2])]);
    const doc = createDefaultSessionDocument();
    doc.columns.kick.clips[1].empty = false;
    const session = new SessionLaunchEngine(doc);
    session.setQuantization('bar');
    const withSession = { ...options, sessionEngineRef: ref(session) };
    const { result } = renderHook(() => useStepHandler(withSession as never));

    const kicks = drive(result.current.onStep, engine, 16, 32, (abs) => {
      if (abs === 5) {
        session.enqueue(
          { kind: 'clip', source: 'manual', requestAudioTime: 1 + 5 * secondsPerStep(120), requestStep: 5, track: 'kick', clipId: doc.columns.kick.clips[1].id },
          {
            step: 4, audioTime: 1 + 4 * secondsPerStep(120), tempo: 120, patternSteps: 16,
            stepsPerBeat: 4, stepsPerBar: 16, isPlaying: true, songModeActive: true,
          },
        );
      }
    });
    // Arrangement kick on 0; the launch lands on the next bar (16) and plays slot 1 (hit on 2).
    expect(kicks).toEqual([0, 18]);
    expect(withSession.setIsSongModeActive).toHaveBeenCalledWith(false);
    expect(session.playingSlot('kick')).toBe(1);
  });

  it('plays a clip-local filter sweep live, matches the offline resolver, and the next clip does not inherit it (#1494)', () => {
    transportMixStore.applyMeter(resolveSongMeter({ stepCount: 16 }));
    const engine = makeEngine();
    const lane = (id: string, points: Array<[number, number]>): UnifiedAutomationLane => ({
      id, target: 'synthA', parameter: 'filterCutoff', name: 'Cutoff',
      points: points.map(([step, value]) => ({ step, value })),
      interpolation: 'linear', source: 'manual', scope: 'song', enabled: true,
    });
    const songLane = lane('song', [[0, 0.2]]);
    automationStore.addLane(songLane);
    try {
      let arr = placeClip(createArrangement(32), {
        id: 'a', track: 'partA', patternSlot: 0, startStep: 0, lengthSteps: 16, loop: true,
        lanes: [lane('clip', [[0, 0], [15, 0.75]])],
      });
      arr = placeClip(arr, { id: 'b', track: 'partA', patternSlot: 0, startStep: 16, lengthSteps: 16, loop: true });
      const options = makeOptions(engine, arr, [kickSeq([])]);
      // A note on every step of partA's pattern.
      options.trackStorageRef.current.partA = [{ steps: Array.from({ length: 16 }, () => ({ note: 'C3', velocity: 1, length: 1 })) }];
      const { result } = renderHook(() => useStepHandler(options as never));
      const cutoffs: Array<number | undefined> = [];
      for (let abs = 0; abs < 32; abs++) {
        const before = engine.playSynth.mock.calls.length;
        const time = 1 + abs * secondsPerStep(120);
        engine.context.currentTime = time;
        result.current.onStep(abs % 16, time, abs);
        const call = engine.playSynth.mock.calls.slice(before).find((c) => c[6] === 'partA');
        cutoffs.push(call?.[8]?.filterCutoff);
      }
      expect(cutoffs[0]).toBe(0);
      expect(cutoffs[5]).toBeCloseTo(0.25);
      expect(cutoffs[15]).toBeCloseTo(0.75);
      expect(cutoffs.slice(16)).toEqual(Array(16).fill(0.2));

      const offline = resolveOpen303ParamSteps(
        resolveLaneTimeline([songLane], { totalSteps: 32, stepCount: 16, songMode: true, arrangement: arr }),
        'synthA',
      ).map((p) => p?.cutoff);
      expect(offline).toEqual(cutoffs);
    } finally {
      automationStore.removeLane(songLane.id);
    }
  });
});
