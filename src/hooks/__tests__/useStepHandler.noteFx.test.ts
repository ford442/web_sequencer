/**
 * Live note FX (#1345 Phase 2): a track with an active chain plays the
 * chain's events at their sub-step times instead of the step's note.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useStepHandler } from '../useStepHandler';
import type { Note, Pattern, PartSequence } from '../../types';
import type { TrackKey } from '../../constants/appDefaults';
import { createArrangement } from '@/arrangement/model';
import { noteFxStore } from '@/stores/noteFxStore';
import { trackMuteSoloStore } from '@/stores/trackMuteSoloStore';
import { clearLiveNoteFxCache } from '@/sequencer/noteFx/runtime';
import { defaultNoteFxChain } from '@/sequencer/noteFx/types';
import { automationStore } from '@/stores/automationStore';

const STEP = 60 / 120 / 4;
const ref = <T,>(current: T) => ({ current });
const empty = (): PartSequence => ({ steps: Array.from({ length: 32 }, () => null as Note | null) });

function pattern(): Pattern {
    const armed = (note: Note): PartSequence => {
        const seq = empty();
        seq.steps[0] = note;
        return seq;
    };
    return {
        partA: armed({ note: 'C4', velocity: 0.8, length: 1 }),
        partB: armed({ note: 'C3', velocity: 1, length: 1 }),
        bass2: armed({ note: 'C2', velocity: 1, length: 2, chord: ['G2'] }),
        kick: empty(),
        snare: empty(),
        closedHat: empty(),
        openHat: empty(),
        sampler: Array.from({ length: 8 }, (_, i) => (i < 2 ? armed({ note: 'C4', velocity: 1, length: 1 }) : empty())),
    } as unknown as Pattern;
}

function engine() {
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

function options(e: ReturnType<typeof engine>, p: Pattern) {
    return {
        audioEngine: e as never,
        tempo: 120,
        onParamChange: undefined,
        currentStepRef: ref(-1),
        sequencerRef: ref(null),
        patternRef: ref(p),
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
            attack: 0.01, decay: 0.2, stretchProfile: 'vocal', stretchMode: 'Time', lockToSequencer: false,
        } as never),
        activeSamplerBankRef: ref(0),
        sliceHighlightRef: ref(null),
        isSongModeActiveRef: ref(false),
        arrangementRef: ref(createArrangement(32)),
        songMeasureRef: ref(0),
        isFirstStepRef: ref(true),
        trackStorageRef: ref({} as Record<TrackKey, (PartSequence | PartSequence[] | null)[]>),
        setCurrentSongMeasure: vi.fn(),
    } as unknown as Parameters<typeof useStepHandler>[0];
}

const calls = (e: ReturnType<typeof engine>, track: string) => e.playSynth.mock.calls.filter((c) => c[6] === track);

describe('useStepHandler note FX', () => {
    afterEach(() => {
        automationStore.reset();
        noteFxStore.reset();
        trackMuteSoloStore.reset();
        clearLiveNoteFxCache();
    });

    it('a ratchet plays its repeats at their sub-step times with decaying velocity', () => {
        const c = defaultNoteFxChain();
        c.ratchet = { enabled: true, count: 4, decay: 0.5, gate: 1 };
        noteFxStore.setChain('partA', c);
        const e = engine();
        const { result } = renderHook(() => useStepHandler(options(e, pattern())));
        result.current.onStep(0, 1.0, 0);

        const partA = calls(e, 'partA');
        expect(partA.map((call) => call[2])).toEqual([1, 1 + STEP / 4, 1 + STEP / 2, 1 + (3 * STEP) / 4]);
        expect(partA.map((call) => call[3])).toEqual([0.25, 0.25, 0.25, 0.25]);
        expect(partA.map((call) => (call[8] as { velocity: number }).velocity)).toEqual([0.8, 0.4, 0.2, 0.1]);
        // Other tracks still play their steps.
        expect(calls(e, 'partB')).toHaveLength(1);
    });

    it('an arp walks the held chord across steps; later steps play their own events', () => {
        const c = defaultNoteFxChain();
        c.arp = { enabled: true, mode: 'up', rate: 1, octaves: 1, gate: 0.5 };
        noteFxStore.setChain('bass2', c);
        const e = engine();
        const { result } = renderHook(() => useStepHandler(options(e, pattern())));
        result.current.onStep(0, 1.0, 0);
        result.current.onStep(1, 1.0 + STEP, 1);
        const bass2 = calls(e, 'bass2');
        expect(bass2.map((call) => call[1])).toEqual(['C2', 'G2']);
        expect(bass2.map((call) => call[2])).toEqual([1.0, 1.0 + STEP]);
        expect(bass2.map((call) => call[3])).toEqual([0.5, 0.5]);
    });

    it('applies one sampler chain to every bank, salted per bank', () => {
        const c = defaultNoteFxChain();
        c.chord = { enabled: true, intervals: [7] };
        noteFxStore.setChain('sampler', c);
        const e = engine();
        const { result } = renderHook(() => useStepHandler(options(e, pattern())));
        result.current.onStep(0, 1.0, 0);
        expect(e.playSampler).toHaveBeenCalledTimes(2);
        expect(e.playSampler.mock.calls.map((call) => call[1])).toEqual([['C4', 'G4'], ['C4', 'G4']]);
    });

    it('automation lanes drive chain parameters per source step', () => {
        const c = defaultNoteFxChain();
        c.ratchet = { enabled: true, count: 2, decay: 1, gate: 1 };
        noteFxStore.setChain('partA', c);
        automationStore.addLane({
            id: 'fx-lane', target: 'synthA', parameter: 'noteFx.ratchet.count', name: 'Ratchet count',
            points: [{ step: 0, value: 1 }], interpolation: 'step', source: 'manual', scope: 'pattern', enabled: true,
        });
        const e = engine();
        const { result } = renderHook(() => useStepHandler(options(e, pattern())));
        result.current.onStep(0, 1.0, 0);
        // The lane says 8 repeats at step 0, not the chain's 2.
        expect(calls(e, 'partA')).toHaveLength(8);
    });

    it('a muted track plays no FX events and an edit is heard on the next pass', () => {
        const c = defaultNoteFxChain();
        c.ratchet = { enabled: true, count: 2, decay: 1, gate: 1 };
        noteFxStore.setChain('partA', c);
        trackMuteSoloStore.toggleMute('partA');
        const e = engine();
        const { result } = renderHook(() => useStepHandler(options(e, pattern())));
        result.current.onStep(0, 1.0, 0);
        expect(calls(e, 'partA')).toHaveLength(0);

        trackMuteSoloStore.reset();
        noteFxStore.updateModule('partA', 'ratchet', { count: 3 });
        result.current.onStep(0, 9.0, 32);
        expect(calls(e, 'partA')).toHaveLength(3);
    });
});
