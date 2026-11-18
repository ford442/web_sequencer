/**
 * The app's real stores bound to the project doc (#1597 P2): an edit in each
 * bound domain — pattern, knobs, mixer, track storage, automation,
 * arrangement, audio tracks, session, note FX, patch bay — lands in the doc as
 * one labelled human step, and undo / redo put the store back.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { liveProject } from '../liveProject';
import { startLiveProject, stopLiveProject } from '../liveProjectRuntime';
import { applySongToBoundStores, readBoundStores } from '../appBindings';
import { patternStore } from '@/stores/patternStore';
import { instrumentStore } from '@/stores/instrumentStore';
import { samplerBanksStore } from '@/stores/samplerBanksStore';
import { transportMixStore } from '@/stores/transportMixStore';
import { arrangementStore, sessionDocumentStore } from '@/stores/songRecordStore';
import { audioTrackStore } from '@/stores/audioTrackStore';
import { addAudioTrack, updateAudioTrack } from '@/arrangement/audioTracks';
import { automationStore } from '@/stores/automationStore';
import { noteFxStore } from '@/stores/noteFxStore';
import { defaultNoteFxChain } from '@/sequencer/noteFx/types';
import { placeClip } from '@/arrangement/model';
import { getActivePatchController, restorePatchFromSong } from '@/audio/graph';
import type { SavedSongData, UnifiedAutomationLane } from '@/types';

function resetStores(): void {
    patternStore.reset();
    instrumentStore.reset();
    transportMixStore.reset();
    arrangementStore.reset();
    audioTrackStore.reset();
    sessionDocumentStore.reset();
    automationStore.reset();
    noteFxStore.reset();
}

beforeEach(() => {
    resetStores();
    restorePatchFromSong(undefined);
    startLiveProject();
});
afterEach(() => {
    stopLiveProject();
    resetStores();
});

const labels = () => liveProject.getSnapshot().entries.map((e) => e.label);

/** One edit as its own gesture; returns the value before it. */
function edit<T>(read: () => T, write: () => void): T {
    const before = read();
    liveProject.beginGesture();
    write();
    expect(read()).not.toEqual(before);
    return before;
}

const LANE: UnifiedAutomationLane = {
    id: 'lane-1', target: 'synthA', parameter: 'filterCutoff', name: 'cutoff',
    points: [{ step: 0, value: 0.2 }, { step: 16, value: 0.8 }],
    interpolation: 'linear', source: 'recorded', scope: 'song', enabled: true,
};

describe('app bindings: every bound domain is undoable', () => {
    const cases: Array<{ name: string; read: () => unknown; write: () => void; label: RegExp }> = [
        {
            name: 'pattern',
            read: () => patternStore.getSnapshot().snare.steps[1],
            write: () => patternStore.set((p) => {
                const steps = [...p.snare.steps];
                steps[1] = steps[1] ? null : { note: 'C4', velocity: 1, length: 1, slide: false };
                return { ...p, snare: { ...p.snare, steps } };
            }),
            label: /^(paint|clear) 1 step \(Snare\)$/,
        },
        {
            name: 'knobs',
            read: () => instrumentStore.getParams().bass2.cutoff,
            write: () => instrumentStore.set('bass2', (p) => ({ ...p, cutoff: 1234 })),
            label: /^Bass 2: Cutoff \d+ → 1234$/,
        },
        {
            name: 'mixer',
            read: () => transportMixStore.getSnapshot().tempo,
            write: () => transportMixStore.setTempo(141),
            label: /^Tempo 120 → 141$/,
        },
        {
            name: 'meter',
            read: () => transportMixStore.getMeter().stepCount,
            write: () => transportMixStore.setStepCount(16),
            label: /^Pattern length 32 → 16$/,
        },
        {
            name: 'track storage',
            read: () => samplerBanksStore.getSnapshot().activeTrackSlots.kick,
            write: () => samplerBanksStore.setActiveTrackSlots((s) => ({ ...s, kick: 3 })),
            label: /^switch pattern slot$/,
        },
        {
            name: 'automation',
            read: () => automationStore.getState().lanes.length,
            write: () => automationStore.addLane(LANE),
            label: /^edit automation$/,
        },
        {
            name: 'arrangement',
            read: () => arrangementStore.getSnapshot().clips.length,
            write: () => arrangementStore.set((a) => placeClip(a, {
                id: 'clip-1', track: 'kick', patternSlot: 0, startStep: 0, lengthSteps: 16, loop: true,
            })),
            label: /^add clip$/,
        },
        {
            name: 'audio tracks',
            read: () => audioTrackStore.getSnapshot().tracks.length,
            write: () => audioTrackStore.set((s) => addAudioTrack(s).state),
            label: /^add Audio 1$/,
        },
        {
            name: 'session',
            read: () => sessionDocumentStore.getSnapshot().quantization,
            write: () => sessionDocumentStore.set((d) => ({ ...d, quantization: d.quantization === 'bar' ? 'beat' : 'bar' })),
            label: /^edit session$/,
        },
        {
            name: 'note FX',
            read: () => noteFxStore.getSnapshot().bass2,
            write: () => noteFxStore.setChain('bass2', { ...defaultNoteFxChain(7), ratchet: { ...defaultNoteFxChain(7).ratchet, enabled: true } }),
            label: /^edit note FX$/,
        },
        {
            // A routing edit: cosmetic node moves on a stock patch are not part of the song.
            name: 'patch bay',
            read: () => JSON.stringify(getActivePatchController()?.getConfig().edges),
            write: () => {
                const controller = getActivePatchController()!;
                const [first] = controller.getConfig().edges;
                expect(controller.disconnect(first.from, first.to).ok).toBe(true);
            },
            label: /^edit patch$/,
        },
    ];

    for (const c of cases) {
        it(`${c.name}: one labelled step, undone and redone through the doc`, () => {
            const before = edit(c.read, c.write);
            const after = c.read();
            expect(labels()).toEqual([expect.stringMatching(c.label)]);
            expect(liveProject.undo()).toBe(true);
            expect(c.read()).toEqual(before);
            expect(liveProject.redo()).toBe(true);
            expect(c.read()).toEqual(after);
        });
    }
});

describe('app bindings: audio track strips', () => {
    it('a fader move is one step named after the track, and undo puts it back', () => {
        liveProject.edit('load', () => audioTrackStore.set((s) => addAudioTrack(s).state));
        liveProject.beginGesture();
        audioTrackStore.set((s) => updateAudioTrack(s, 'audio-1', { gainDb: -3 }));
        audioTrackStore.set((s) => updateAudioTrack(s, 'audio-1', { gainDb: -6 }));
        expect(labels()).toEqual(['Audio 1: Fader 0 dB → -6 dB']);
        expect(liveProject.readField('audioTracks')).toEqual([{ id: 'audio-1', name: 'Audio 1', gainDb: -6, pan: 0 }]);
        expect(liveProject.undo()).toBe(true);
        expect(audioTrackStore.getSnapshot().tracks[0].gainDb).toBe(0);
    });
});

describe('app bindings: the save format', () => {
    it('a chain on a track without note FX is not saved (as before the binding)', () => {
        noteFxStore.setChain('kick' as never, defaultNoteFxChain(3));
        expect(liveProject.readField('noteFx')).toBeUndefined();
    });
});

describe('app bindings: loads', () => {
    it('a load applies the song through the bindings and is not undoable', () => {
        liveProject.beginGesture();
        transportMixStore.setTempo(99);
        const song = { ...readBoundStores(), tempo: 133, automationLanes: [LANE] } as Partial<SavedSongData>;
        liveProject.edit('load', () => applySongToBoundStores(song));
        expect(transportMixStore.getSnapshot().tempo).toBe(133);
        expect(automationStore.getState().lanes).toHaveLength(1);
        expect(liveProject.readField('tempo')).toBe(133);
        expect(liveProject.canUndo()).toBe(false);
    });

    it('absent optional fields clear their stores', () => {
        automationStore.addLane(LANE);
        const song = { ...readBoundStores(), automationLanes: undefined, noteFx: undefined } as Partial<SavedSongData>;
        liveProject.edit('load', () => applySongToBoundStores(song));
        expect(automationStore.getState().lanes).toEqual([]);
        expect(liveProject.readField('automationLanes')).toBeUndefined();
    });
});
