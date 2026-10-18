/**
 * Acceptance (#1345 Phase 2): the step handler (live) and the pattern
 * renderer (offline: freeze, stems) play the same note FX events — same
 * times, pitches, lengths and velocities — for the same pattern and chain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Note, Pattern, PartSequence } from '@/types';
import type { TrackKey } from '@/constants/appDefaults';
import { createArrangement } from '@/arrangement/model';
import { noteFxStore } from '@/stores/noteFxStore';
import { transportMixStore } from '@/stores/transportMixStore';
import { clearLiveNoteFxCache } from '@/sequencer/noteFx/runtime';
import { defaultNoteFxChain, type NoteFxChain } from '@/sequencer/noteFx/types';

vi.mock('@/utils/renderAudio', () => ({
    renderSynthToBuffer: vi.fn(async (_params: unknown, note: string, seconds: number) => ({ note, seconds })),
    renderDrumToBuffer: vi.fn(),
}));

import { useStepHandler } from '@/hooks/useStepHandler';
import { renderSynthPattern } from '@/utils/patternRenderer';

const TEMPO = 120;
const STEP = 60 / TEMPO / 4;
const LOOP = 16;
const ref = <T,>(current: T) => ({ current });

type Played = { time: number; note: string; lengthSteps: number; velocity: number };

function pattern(steps: (Note | null)[]): Pattern {
    const empty = (): PartSequence => ({ steps: Array.from({ length: LOOP }, () => null) });
    return {
        partA: { steps }, partB: empty(), bass2: empty(), kick: empty(), snare: empty(),
        closedHat: empty(), openHat: empty(), sampler: Array.from({ length: 8 }, empty),
    } as unknown as Pattern;
}

function livePlay(steps: (Note | null)[]): Played[] {
    const played: Played[] = [];
    const engine = {
        context: { currentTime: 0, sampleRate: 48000 },
        playSynth: vi.fn((_p: unknown, notes: string | string[], time: number, length: number, _st: number, _slide: unknown, track: string, _scale: unknown, noteParams?: { velocity?: number }) => {
            if (track !== 'partA') return;
            for (const note of Array.isArray(notes) ? notes : [notes]) {
                played.push({ time, note, lengthSteps: length, velocity: noteParams?.velocity ?? 1 });
            }
        }),
        playDrum: vi.fn(), playSampler: vi.fn(), stopTrackNotes: vi.fn(), open303Engine: null, updateSamplerVoiceParams: vi.fn(),
    };
    const { result } = renderHook(() => useStepHandler({
        audioEngine: engine as never, tempo: TEMPO, onParamChange: undefined,
        currentStepRef: ref(-1), sequencerRef: ref(null), patternRef: ref(pattern(steps)),
        lastFreqRef: ref({} as Record<string, number>), lastSamplerMidiRef: ref({}), lastSamplerFormantRef: ref({}),
        synthARef: ref({ waveform: 'sawtooth' } as never), synthBRef: ref({ waveform: 'sawtooth' } as never),
        bass2Ref: ref({ waveform: 'sawtooth', cutoff: 0.5, resonance: 0.5, decay: 0.3, volume: 0.8 } as never),
        kickRef: ref({}), snareRef: ref({}), closedHatRef: ref({}), openHatRef: ref({}), currentScaleRef: ref(null),
        samplerRef: ref(Array.from({ length: 8 }, () => ({})) as never),
        samplerVoiceParamsRef: ref({ rootNote: 60, lockToSequencer: false } as never),
        activeSamplerBankRef: ref(0), sliceHighlightRef: ref(null), isSongModeActiveRef: ref(false),
        arrangementRef: ref(createArrangement(LOOP)), songMeasureRef: ref(0), isFirstStepRef: ref(true),
        trackStorageRef: ref({} as Record<TrackKey, (PartSequence | PartSequence[] | null)[]>),
        setCurrentSongMeasure: vi.fn(),
    } as unknown as Parameters<typeof useStepHandler>[0]));
    // Two loop passes: the second is seeded as pass 1, like a timeline render.
    for (let abs = 0; abs < LOOP * 2; abs++) result.current.onStep(abs % LOOP, 10 + abs * STEP, abs);
    return played.map((p) => ({ ...p, time: p.time - 10 }));
}

async function offlinePlay(steps: (Note | null)[], chain: NoteFxChain): Promise<Played[]> {
    const played: Played[] = [];
    const original = globalThis.OfflineAudioContext;
    globalThis.OfflineAudioContext = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.destination = {};
        this.createGain = () => {
            const gain = { gain: { value: 1, setValueAtTime: (v: number) => { gain.gain.value = v; } }, connect: vi.fn() };
            return gain;
        };
        this.createBufferSource = () => {
            const src: { buffer: { note: string; seconds: number } | null; connect: (g: { gain: { value: number } }) => void; start: (t: number) => void; gainNode?: { gain: { value: number } } } = {
                buffer: null,
                connect: (g) => { src.gainNode = g; },
                start: (t: number) => {
                    played.push({ time: t, note: src.buffer!.note, lengthSteps: src.buffer!.seconds / STEP, velocity: src.gainNode!.gain.value });
                },
            };
            return src;
        };
        this.startRendering = async () => ({});
    }) as unknown as typeof OfflineAudioContext;
    try {
        await renderSynthPattern({ waveform: 'sawtooth' } as never, {
            sequence: { steps: [...steps, ...steps] },
            tempo: TEMPO,
            sampleRate: 48000,
            noteFx: { chain, loopLength: LOOP },
        });
    } finally {
        globalThis.OfflineAudioContext = original;
    }
    return played;
}

const sort = (xs: Played[]) => [...xs].sort((a, b) => a.time - b.time || a.note.localeCompare(b.note));

describe('note FX: live step handler == offline pattern render', () => {
    beforeEach(() => {
        transportMixStore.reset();
        transportMixStore.setStepCount(LOOP);
        clearLiveNoteFxCache();
    });
    afterEach(() => {
        noteFxStore.reset();
        transportMixStore.reset();
    });

    const CASES: Array<[string, (c: NoteFxChain) => void]> = [
        ['arp up 2 octaves at 1/32', (c) => { c.arp = { enabled: true, mode: 'up', rate: 0.5, octaves: 2, gate: 0.7 }; }],
        ['chord + ratchet with decay', (c) => { c.chord = { enabled: true, intervals: [3, 7] }; c.ratchet = { enabled: true, count: 3, decay: 0.6, gate: 0.8 }; }],
        ['euclid gate + humanize', (c) => { c.euclid = { enabled: true, pulses: 5, steps: 8, rotation: 1 }; c.humanize = { enabled: true, timing: 0.2, velocity: 0.3 }; }],
        ['random arp', (c) => { c.arp = { enabled: true, mode: 'random', rate: 0.25, octaves: 3, gate: 1 }; }],
    ];

    for (const [name, configure] of CASES) {
        it(name, async () => {
            const steps: (Note | null)[] = Array.from({ length: LOOP }, () => null);
            steps[0] = { note: 'C4', velocity: 0.9, length: 2, chord: ['E4'] };
            steps[3] = { note: 'G3', velocity: 0.7, length: 1, microtiming: 0.25 };
            steps[6] = { note: 'A3', velocity: 1, length: 1, probability: 0.5 };
            for (let s = 8; s < LOOP; s++) steps[s] = { note: 'D4', velocity: 0.8, length: 1 };
            const chain = defaultNoteFxChain(1234);
            configure(chain);
            noteFxStore.setChain('partA', chain);

            const live = sort(livePlay(steps));
            const offline = sort(await offlinePlay(steps, chain));
            expect(live.length).toBeGreaterThan(0);
            expect(live.length).toBe(offline.length);
            live.forEach((p, i) => {
                expect(p.time).toBeCloseTo(offline[i].time, 9);
                expect(p.note).toBe(offline[i].note);
                expect(p.lengthSteps).toBeCloseTo(offline[i].lengthSteps, 9);
                expect(p.velocity).toBeCloseTo(offline[i].velocity, 9);
            });
        });
    }
});
