import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import fc from 'fast-check';
import type { SavedSongData } from '@/types';
import { exportAISong } from '@/importers/ai-song/exportAISong';
import { applyUpdates, readSongFromDoc, songToDoc, writeSongToDoc } from '../codec';
import { SONG_FIELD_SUBSYSTEM, SUBSYSTEMS, createProjectDoc, subsystemMap } from '../doc';
import { jsonEqual, toJsonImage } from '../yjson';
import { loadSongFixtures } from './songFixtures';

const fixtures = await loadSongFixtures();

/** Rebuild a doc from its binary encoding, as a peer or a reload would. */
function viaUpdate(doc: Y.Doc): Y.Doc {
    const copy = createProjectDoc();
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(doc));
    return copy;
}

function updatesOf(doc: Y.Doc, fn: () => void): Uint8Array[] {
    const updates: Uint8Array[] = [];
    const onUpdate = (update: Uint8Array) => updates.push(update);
    doc.on('update', onUpdate);
    fn();
    doc.off('update', onUpdate);
    return updates;
}

describe('collab codec: every fixture round-trips byte for byte', () => {
    it('covers every file in test-fixtures/', () => {
        const names = fixtures.map((f) => f.name);
        for (const expected of [
            'ai-song/full.json',
            'ai-song/minimal.json',
            'ai-song/song-mode.json',
            'ai-song/expected/full.import.json',
            'ai-song/expected/minimal.import.json',
            'rbs/generated_v15_single_303.rbs',
            'rbs/generated_v20_pattern_mode.rbs',
            'rbs/generated_v20_song_arrangement.rbs',
            'rbs/generated_v20_song_multi_pattern.rbs',
            'rbs/generated_v20_trak_filter_automation.rbs',
            '10_isotherms.mid',
        ]) {
            expect(names).toContain(expected);
        }
    });

    describe.each(fixtures)('$name', ({ song }) => {
        const json = JSON.stringify(song);

        it('reads back the exact JSON it was written from', () => {
            expect(JSON.stringify(readSongFromDoc(songToDoc(song)))).toBe(json);
        });

        it('survives the binary encoding (a reload, or a peer joining)', () => {
            expect(JSON.stringify(readSongFromDoc(viaUpdate(songToDoc(song))))).toBe(json);
        });

        it('writing the song a doc already holds emits no update', () => {
            const doc = songToDoc(song);
            expect(updatesOf(doc, () => writeSongToDoc(doc, song))).toEqual([]);
        });

        it('reconciles any other fixture into this one', () => {
            for (const other of fixtures) {
                const doc = songToDoc(other.song);
                writeSongToDoc(doc, song);
                const read = toJsonImage(readSongFromDoc(viaUpdate(doc)));
                expect(jsonEqual(read, toJsonImage(song)), `${other.name} → this`).toBe(true);
            }
        });
    });

    it('a doc read back still exports the same AI song (the AI-song schema)', () => {
        for (const { name, song } of fixtures.filter((f) => f.name.startsWith('ai-song/'))) {
            const read = readSongFromDoc(viaUpdate(songToDoc(song)));
            const meta = { createdAt: '2026-01-01T00:00:00.000Z' };
            expect(exportAISong(read, { meta }), name).toEqual(exportAISong(song, { meta }));
        }
    });
});

describe('collab codec: document shape', () => {
    const song = fixtures.find((f) => f.name === 'kitchen sink')!.song;

    it('puts each top-level field in its subsystem map and unknown ones in extra', () => {
        const doc = songToDoc(song);
        for (const [field, subsystem] of Object.entries(SONG_FIELD_SUBSYSTEM)) {
            if (!(field in song)) continue;
            expect(subsystemMap(doc, subsystem).has(field), field).toBe(true);
        }
        expect(subsystemMap(doc, 'extra').has('futureField')).toBe(true);
        expect(SUBSYSTEMS).toEqual(expect.arrayContaining(['patterns', 'tracks', 'mixer', 'lyrics', 'extra']));
    });

    it('stores steps as slots, clips as a list and lyrics as Y.Text', () => {
        const doc = songToDoc(song);
        const pattern = subsystemMap(doc, 'patterns').get('pattern') as Y.Map<unknown>;
        const steps = (pattern.get('partA') as Y.Map<unknown>).get('steps');
        expect(steps).toBeInstanceOf(Y.Map);
        const clips = (subsystemMap(doc, 'arrangement').get('arrangement') as Y.Map<unknown>).get('clips');
        expect(clips).toBeInstanceOf(Y.Array);
        const phrases = subsystemMap(doc, 'lyrics').get('ttsPhrases') as Y.Map<unknown>;
        expect(phrases.get('1')).toBeInstanceOf(Y.Text);
        // Preserved import data is one opaque value.
        expect(subsystemMap(doc, 'mixer').get('timeSignature')).toEqual([7, 8]);
    });

    it('an empty doc reads as an empty song', () => {
        expect(readSongFromDoc(createProjectDoc())).toEqual({});
    });

    it('one step edit is one small update', () => {
        const doc = songToDoc(song);
        const edited = structuredClone(song);
        edited.pattern.kick.steps[3] = { note: 'C1', velocity: 1 };
        const updates = updatesOf(doc, () => writeSongToDoc(doc, edited));
        expect(updates).toHaveLength(1);
        expect(updates[0].byteLength).toBeLessThan(200);
        expect(readSongFromDoc(doc).pattern.kick.steps[3]).toEqual({ note: 'C1', velocity: 1 });
    });

    it('applyUpdates replays frames in order', () => {
        const doc = songToDoc(song);
        const frames = [Y.encodeStateAsUpdate(doc)];
        const edited = { ...song, tempo: 99 };
        frames.push(...updatesOf(doc, () => writeSongToDoc(doc, edited)));
        const replay = createProjectDoc();
        applyUpdates(replay, frames);
        expect(readSongFromDoc(replay).tempo).toBe(99);
    });
});

describe('collab codec: arbitrary songs (property)', () => {
    const json = fc.jsonValue({ maxDepth: 4 });
    const songArb = fc.dictionary(
        fc.constantFrom('pattern', 'params', 'tempo', 'ttsPhrases', 'arrangement', 'trackStorage', 'futureKey', '__proto__', '\u0001x'),
        json,
        { maxKeys: 6 },
    ) as fc.Arbitrary<unknown> as fc.Arbitrary<SavedSongData>;

    it('round-trips any JSON object byte for byte', () => {
        fc.assert(
            fc.property(songArb, (song) => {
                const image = JSON.stringify(toJsonImage(song));
                return JSON.stringify(readSongFromDoc(viaUpdate(songToDoc(song)))) === image;
            }),
            { numRuns: 300 },
        );
    });

    it('reconciling A into B reads back exactly B', () => {
        fc.assert(
            fc.property(songArb, songArb, (a, b) => {
                const doc = songToDoc(a);
                writeSongToDoc(doc, b);
                return jsonEqual(toJsonImage(readSongFromDoc(viaUpdate(doc))), toJsonImage(b));
            }),
            { numRuns: 300 },
        );
    });
});
