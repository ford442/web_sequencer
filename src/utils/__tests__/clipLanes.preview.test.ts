/**
 * The song preview (the AI modal's offline render) plays clip-local lanes
 * (#1494): a song carrying an arrangement is previewed off its timeline, and
 * the clip's sweep reaches the synth renderer on the clip's steps only.
 */
import { describe, expect, it, vi } from 'vitest';
import type { PatternAutomation } from '../../audio/offline/offlineLaneAutomation';
import type { Arrangement, PartSequence, SavedSongData } from '../../types';
import { createArrangement, placeClip } from '../../arrangement/model';

const synthCalls: Array<{ sequence: PartSequence; automation?: PatternAutomation }> = [];

vi.mock('../patternRenderer', () => ({
    bass2ToSynthParams: (p: unknown) => p,
    renderSynthPattern: (_params: unknown, opts: { sequence: PartSequence; automation?: PatternAutomation }) => {
        synthCalls.push({ sequence: opts.sequence, automation: opts.automation });
        return Promise.resolve({} as AudioBuffer);
    },
    renderDrumPattern: () => Promise.resolve({} as AudioBuffer),
}));
vi.mock('../../audio/offline/compileOfflineGraph', () => ({
    bounceBuffersThroughOfflineGraph: (opts: { sampleRate: number }) =>
        Promise.resolve({
            buffer: { length: 1, numberOfChannels: 2, sampleRate: opts.sampleRate },
            report: { patchName: 'test', slots: [], engineVoices: [] },
        }),
}));

const { renderSongPreview } = await import('../aiSongPreview');

const notes = (): PartSequence => ({ steps: Array.from({ length: 16 }, () => ({ note: 'C3', velocity: 1 })) });
const empty = (): PartSequence => ({ steps: Array.from({ length: 16 }, () => null) });

function song(arrangement: Arrangement): SavedSongData {
    const synth = { waveform: 'sawtooth', filterCutoff: 1000, filterResonance: 1 };
    return {
        version: 5,
        pattern: { partA: empty(), partB: empty(), bass2: empty(), kick: empty(), snare: empty(), closedHat: empty(), openHat: empty(), sampler: [] },
        tempo: 120,
        params: { synthA: synth, synthB: synth, kick: {}, snare: {}, closedHat: {}, openHat: {} },
        trackStorage: {
            partA: [notes()], partB: [empty()], bass2: [empty()], kick: [empty()],
            snare: [empty()], closedHat: [empty()], openHat: [empty()], sampler: [[]],
        },
        activeTrackSlots: {},
        songStructure: [],
        arrangement,
        stepCount: 16,
    } as unknown as SavedSongData;
}

describe('song preview — clip lanes', () => {
    it('renders the clip sweep on its 16 steps and nothing on the next clip', async () => {
        let arr = placeClip(createArrangement(32), {
            id: 'a', track: 'partA', patternSlot: 0, startStep: 0, lengthSteps: 16, loop: true,
            lanes: [{
                id: 'l', target: 'synthA', parameter: 'filterCutoff', name: 'Cutoff',
                points: [{ step: 0, value: 0 }, { step: 15, value: 0.75 }],
                interpolation: 'linear', source: 'manual', scope: 'song', enabled: true,
            }],
        });
        arr = placeClip(arr, { id: 'b', track: 'partA', patternSlot: 0, startStep: 16, lengthSteps: 16, loop: true });

        const result = await renderSongPreview(song(arr), { bars: 2 });
        expect(result.automation.applied).toEqual(['synthA.filterCutoff']);

        const synthA = synthCalls[0];
        // The preview walked the timeline: both clips play partA's notes.
        expect(synthA.sequence.steps.filter(Boolean)).toHaveLength(32);
        const cutoff = synthA.automation!.filterCutoff!;
        expect(cutoff[0]).toBe(20); // 0 → floored at 20 Hz, like playSynth
        expect(cutoff[5]).toBeCloseTo(0.25 * 20000);
        expect(cutoff[15]).toBeCloseTo(0.75 * 20000);
        expect(cutoff.slice(16)).toEqual(Array(16).fill(null));
    });
});
