import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { Arrangement, AudioClip, PatternClip, SavedSongData } from '@/types';
import {
    addClip,
    createArrangement,
    isAudioClip,
    normalizeArrangement,
    placeClip,
    projectArrangement,
    removeClip,
    splitClip,
    updateClip,
} from '../model';
import {
    EMPTY_AUDIO_TRACK_STATE,
    addAudioTrack,
    audioTrackStateOf,
    normalizeAudioTracks,
    normalizeMediaTable,
    referencedMedia,
    registerMedia,
    updateAudioTrack,
    withTracksForClips,
} from '../audioTracks';
import { normalizeLoadedSong } from '@/hooks/useSongStorage/migrate';
import { readSongFromDoc, songToDoc, writeSongToDoc } from '@/collab/codec';
import { createProjectDoc } from '@/collab/doc';

const MEDIA = 'c'.repeat(64);

function audio(partial: Partial<AudioClip> & Pick<AudioClip, 'id' | 'startStep' | 'lengthSteps'>): AudioClip {
    return { kind: 'audio', track: 'audio-1', mediaId: MEDIA, offsetFrames: 0, gainDb: 0, warp: 'off', ...partial };
}

function pattern(partial: Partial<PatternClip> & Pick<PatternClip, 'id' | 'startStep' | 'lengthSteps'>): PatternClip {
    return { track: 'kick', patternSlot: 0, loop: true, ...partial };
}

const find = (arr: Arrangement, id: string) => arr.clips.find((c) => c.id === id) as AudioClip;

describe('audio clips on the arrangement (v6)', () => {
    it('a clip placed over an audio clip trims it and splits it, continuing the source', () => {
        let arr = placeClip(createArrangement(64), audio({ id: 'a', startStep: 0, lengthSteps: 32, offsetFrames: 100, fadeInFrames: 10, fadeOutFrames: 20 }));
        arr = placeClip(arr, audio({ id: 'b', startStep: 8, lengthSteps: 8 }));
        const left = find(arr, 'a');
        const right = arr.clips.find((c) => c.id !== 'a' && c.id !== 'b') as AudioClip;
        expect(left).toMatchObject({ startStep: 0, lengthSteps: 8, offsetFrames: 100, fadeInFrames: 10 });
        expect(left.fadeOutFrames).toBeUndefined();
        // The right half is anchored where the left half was: 16 steps in, same slip.
        expect(right).toMatchObject({ kind: 'audio', startStep: 16, lengthSteps: 16, offsetSteps: 16, offsetFrames: 100, fadeOutFrames: 20 });
        expect(right.fadeInFrames).toBeUndefined();
    });

    it('pattern clips and audio clips never cut each other', () => {
        let arr = placeClip(createArrangement(32), pattern({ id: 'p', startStep: 0, lengthSteps: 32 }));
        arr = placeClip(arr, audio({ id: 'a', startStep: 0, lengthSteps: 32 }));
        expect(arr.clips.map((c) => [c.id, c.lengthSteps])).toEqual([['p', 32], ['a', 32]]);
        // Pattern lanes come first, then audio lanes.
        arr = placeClip(arr, pattern({ id: 'q', track: 'sampler', startStep: 4, lengthSteps: 4 }));
        expect(arr.clips.map((c) => c.id)).toEqual(['p', 'q', 'a']);
    });

    it('splits at a step; the halves meet exactly', () => {
        const arr = placeClip(createArrangement(32), audio({ id: 'a', startStep: 4, lengthSteps: 16, offsetSteps: 2 }));
        const { arrangement, rightId } = splitClip(arr, 'a', 10);
        expect(find(arrangement, 'a')).toMatchObject({ startStep: 4, lengthSteps: 6, offsetSteps: 2 });
        expect(find(arrangement, rightId!)).toMatchObject({ startStep: 10, lengthSteps: 10, offsetSteps: 8 });
        expect(splitClip(arr, 'a', 4).rightId).toBeNull();
        expect(splitClip(arr, 'a', 20).rightId).toBeNull();
    });

    it('updates an audio clip but never moves it onto a pattern track', () => {
        const { arrangement, id } = addClip(createArrangement(32), {
            kind: 'audio', track: 'audio-2', mediaId: MEDIA, startStep: 0, lengthSteps: 8, offsetFrames: 0, gainDb: 0, warp: 'off',
        });
        expect(updateClip(arrangement, id, { gainDb: -6 }).clips[0]).toMatchObject({ gainDb: -6 });
        expect(updateClip(arrangement, id, { track: 'kick' } as never)).toBe(arrangement);
        expect(removeClip(arrangement, id).clips).toEqual([]);
    });

    it('leaves audio clips out of the Song Mode projection', () => {
        const arr = placeClip(createArrangement(32), audio({ id: 'a', startStep: 0, lengthSteps: 32 }));
        expect(projectArrangement(arr, 16).every((m) => Object.values(m).every((v) => v === null))).toBe(true);
    });

    describe('normalizeArrangement', () => {
        it('keeps a v5 arrangement as it is (no kind is added)', () => {
            const v5 = {
                lengthSteps: 64,
                clips: [
                    // In lane order (partA before kick), as a v5 save writes them.
                    { id: 'clip-2', track: 'partA', patternSlot: 0, startStep: 8, lengthSteps: 8, loop: false, offsetSteps: 3 },
                    { id: 'clip-1', track: 'kick', patternSlot: 1, startStep: 0, lengthSteps: 32, loop: true },
                ],
            };
            const out = normalizeArrangement(v5)!;
            expect(out).toEqual(v5);
            expect(out.clips.every((c) => !('kind' in c))).toBe(true);
        });

        it('validates audio clips and drops what it cannot play', () => {
            const arr = normalizeArrangement({
                lengthSteps: 32,
                clips: [
                    { kind: 'audio', id: 'ok', track: 'audio-3', mediaId: MEDIA, startStep: 4, lengthSteps: 8, gainDb: 99 },
                    { kind: 'audio', id: 'bad-media', track: 'audio-1', mediaId: 'nope', startStep: 0, lengthSteps: 8 },
                    { kind: 'audio', id: 'bad-track', track: 'kick', mediaId: MEDIA, startStep: 0, lengthSteps: 8 },
                    { kind: 'audio', id: 'no-such-track', track: 'audio-9', mediaId: MEDIA, startStep: 0, lengthSteps: 8 },
                    { kind: 'midi', id: 'future', track: 'kick', patternSlot: 0, startStep: 0, lengthSteps: 8 },
                ],
            })!;
            expect(arr.clips).toEqual([{
                kind: 'audio', id: 'ok', track: 'audio-3', mediaId: MEDIA, startStep: 4, lengthSteps: 8,
                offsetFrames: 0, gainDb: 24, warp: 'off',
            }]);
        });
    });
});

describe('audio tracks and the media table', () => {
    it('adds tracks in key order, at most eight', () => {
        let state = addAudioTrack(EMPTY_AUDIO_TRACK_STATE, 'audio-3').state;
        state = addAudioTrack(state).state;
        expect(state.tracks.map((t) => [t.id, t.name])).toEqual([['audio-1', 'Audio 1'], ['audio-3', 'Audio 3']]);
        for (let i = 0; i < 10; i++) state = addAudioTrack(state).state;
        expect(state.tracks).toHaveLength(8);
        expect(addAudioTrack(state).id).toBeNull();
    });

    it('clamps strip edits', () => {
        const state = updateAudioTrack(addAudioTrack(EMPTY_AUDIO_TRACK_STATE).state, 'audio-1', { gainDb: 40, pan: -3 });
        expect(state.tracks[0]).toMatchObject({ gainDb: 6, pan: -1 });
    });

    it('registers media once', () => {
        const ref = { name: 'a.wav', sampleRate: 48000, channels: 2, frames: 10 };
        const once = registerMedia(EMPTY_AUDIO_TRACK_STATE, MEDIA, ref);
        expect(registerMedia(once, MEDIA, { ...ref })).toBe(once);
    });

    it('normalizes persisted tracks and media', () => {
        expect(normalizeAudioTracks([
            { id: 'audio-2', name: 'B', gainDb: 1, pan: 0 },
            { id: 'audio-1', name: '', gainDb: 'loud', pan: 2 },
            { id: 'audio-2', name: 'dup', gainDb: 0, pan: 0 },
            { id: 'kick', name: 'no' },
        ])).toEqual([
            { id: 'audio-1', name: 'Audio 1', gainDb: 0, pan: 1 },
            { id: 'audio-2', name: 'B', gainDb: 1, pan: 0 },
        ]);
        expect(normalizeMediaTable({
            [MEDIA]: { name: 'x', sampleRate: 44100, channels: 1, frames: 5 },
            bad: { name: 'x', sampleRate: 44100, channels: 1, frames: 5 },
            ['d'.repeat(64)]: { name: 'x', sampleRate: 0, channels: 1, frames: 5 },
        })).toEqual({ [MEDIA]: { name: 'x', sampleRate: 44100, channels: 1, frames: 5 } });
    });

    it('gives every audio clip a track, and lists the media clips use', () => {
        const arr = placeClip(createArrangement(32), audio({ id: 'a', track: 'audio-5', startStep: 0, lengthSteps: 4 }));
        expect(withTracksForClips(EMPTY_AUDIO_TRACK_STATE, arr).tracks.map((t) => t.id)).toEqual(['audio-5']);
        expect(referencedMedia(arr)).toEqual([MEDIA]);
        expect(audioTrackStateOf({}, createArrangement(4))).toBe(EMPTY_AUDIO_TRACK_STATE);
    });
});

describe('the v5 → v6 migration', () => {
    const current = {} as Partial<SavedSongData>;
    const base = { pattern: {}, params: {}, trackStorage: {}, activeTrackSlots: {}, songStructure: [], tempo: 120 } as unknown as SavedSongData;

    it('adds no audio tracks to a v5 song', () => {
        const out = normalizeLoadedSong({ ...base, version: 5, arrangement: { lengthSteps: 32, clips: [] } }, current);
        expect(out.audioTracks).toBeUndefined();
        expect(out.media).toBeUndefined();
    });

    it('loads a v6 song’s tracks and media, and the track an orphan clip needs', () => {
        const out = normalizeLoadedSong({
            ...base,
            version: 6,
            arrangement: { lengthSteps: 32, clips: [audio({ id: 'a', track: 'audio-2', startStep: 0, lengthSteps: 8 })] },
            audioTracks: [{ id: 'audio-1', name: 'Vox', gainDb: -2, pan: 0 }],
            media: { [MEDIA]: { name: 'vox.wav', sampleRate: 48000, channels: 1, frames: 48000 } },
        }, current);
        expect(out.audioTracks?.map((t) => t.id)).toEqual(['audio-1', 'audio-2']);
        expect(out.media?.[MEDIA]?.name).toBe('vox.wav');
        expect(out.arrangement?.clips.filter(isAudioClip)).toHaveLength(1);
    });
});

describe('audio tracks in the project doc', () => {
    it('two peers each adding an audio track and a clip both land', () => {
        const song = {
            version: 6,
            arrangement: { lengthSteps: 32, clips: [] },
            audioTracks: [],
            media: {},
        } as unknown as SavedSongData;
        const a = songToDoc(song);
        const b = createProjectDoc();
        Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
        const withTrack = (id: 'audio-1' | 'audio-2', clipId: string, media: string): SavedSongData => ({
            ...song,
            arrangement: { lengthSteps: 32, clips: [audio({ id: clipId, track: id, mediaId: media, startStep: 0, lengthSteps: 8 })] },
            audioTracks: [{ id, name: id, gainDb: 0, pan: 0 }],
            media: { [media]: { name: `${id}.wav`, sampleRate: 48000, channels: 2, frames: 100 } },
        });
        writeSongToDoc(a, withTrack('audio-1', 'clip-1', MEDIA));
        writeSongToDoc(b, withTrack('audio-2', 'clip-2', 'e'.repeat(64)));
        Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
        Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
        const merged = readSongFromDoc(a);
        // Converged content; concurrent map keys may iterate in either order.
        expect(readSongFromDoc(b)).toEqual(merged);
        expect(merged.audioTracks?.map((t) => t.id).sort()).toEqual(['audio-1', 'audio-2']);
        expect(merged.arrangement?.clips.map((c) => c.id).sort()).toEqual(['clip-1', 'clip-2']);
        expect(Object.keys(merged.media ?? {})).toHaveLength(2);
    });
});
