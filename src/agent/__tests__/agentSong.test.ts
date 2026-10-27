/**
 * The agent render hook's import step (#1386): strict mode, the 303 engine
 * switch, and what the report says. The hook itself runs in a browser
 * (tests/ai-song-render.spec.ts); everything here is the DOM-free part.
 */
import { describe, expect, it } from 'vitest';
import minimal from '../../../test-fixtures/ai-song/minimal.json';
import full from '../../../test-fixtures/ai-song/full.json';
import songMode from '../../../test-fixtures/ai-song/song-mode.json';
import { bytesToBase64, convertAgentSong, describeImportError, force303Engine } from '../agentSong';
import { isAgentQuery } from '../agentQuery';
import { convertAISong, type AISongData } from '../../importers/ai-song';

const kickLane = {
    target: 'kick',
    parameter: 'decay',
    steps: Array.from({ length: 16 }, (_, i) => i * 8),
    interpolation: 'linear',
};
const withKickLane = { ...minimal, automation: [kickLane] };

describe('convertAgentSong', () => {
    it('converts a clean song and reports its meter', () => {
        const { song, report } = convertAgentSong(JSON.stringify(full));
        expect(song).not.toBeNull();
        expect(report).toMatchObject({
            ok: true,
            strict: true,
            title: 'Full Ingest Reference',
            errors: [],
            warnings: [],
            tempo: 96,
            stepCount: 32,
            timeSignature: [3, 4],
            measureCount: 0,
            engine303: null,
        });
        expect(report.notesConverted).toBeGreaterThan(0);
    });

    it('fails a song with a kick lane in strict mode, naming the lane', () => {
        const { song, report } = convertAgentSong(withKickLane);
        expect(song).toBeNull();
        expect(report.ok).toBe(false);
        expect(report.warnings).toEqual([
            'automation[0] kick.decay is saved but never plays: the scheduler routes no kick lanes.',
        ]);
        expect(report.errors).toEqual([`strict: ${report.warnings[0]}`]);
    });

    it('loads the same song with strict off and keeps the warning', () => {
        const { song, report } = convertAgentSong(withKickLane, { strict: false });
        expect(song).not.toBeNull();
        expect(report.ok).toBe(true);
        expect(report.errors).toEqual([]);
        expect(report.warnings).toHaveLength(1);
    });

    it('fails strict on a dropped note too', () => {
        const song = structuredClone(minimal) as unknown as AISongData;
        song.tracks!.synthA!.notes.push({ step: 40, note: 'C2' });
        const { report } = convertAgentSong(song);
        expect(report.ok).toBe(false);
        expect(report.errors).toEqual(['strict: Note step 40 out of range in synthA']);
    });

    it('reports bad JSON and validation errors without throwing', () => {
        expect(convertAgentSong('{ nope').report.errors[0]).toMatch(/^Invalid JSON/);
        const { report } = convertAgentSong({ ...minimal, globals: { tempo: 900 } });
        expect(report.ok).toBe(false);
        expect(report.errors).toEqual([expect.stringMatching(/^globals\.tempo: /)]);
    });

    it('counts Song Mode rows of a v1.1 song', () => {
        const { report } = convertAgentSong(songMode);
        expect(report.ok).toBe(true);
        expect(report.measureCount).toBeGreaterThan(1);
    });

    it('puts the 303 voices on the requested engine', () => {
        const { song, report } = convertAgentSong(full, { engine303: 'jc303' });
        expect(report.engine303).toBe('jc303');
        expect(song!.params.synthA).toMatchObject({ engine303: 'jc303', model303: 'jc303' });
        expect(song!.params.synthB).toMatchObject({ engine303: 'jc303', model303: 'jc303' });
        expect(song!.params.bass2).toMatchObject({ engine303: 'jc303', model303: 'jc303' });
    });
});

describe('force303Engine', () => {
    const converted = () => {
        const result = convertAISong(full as unknown as AISongData);
        if (!result.success) throw new Error('fixture failed to import');
        return result.song;
    };

    it('leaves a non-303 voice alone', () => {
        const song = converted();
        song.params.synthB = { ...song.params.synthB, waveform: 'sawtooth' };
        const forced = force303Engine(song, 'open303');
        expect(forced.params.synthB).toBe(song.params.synthB);
        expect(forced.params.synthA).toMatchObject({ engine303: 'open303', model303: 'stock-open303' });
    });

    it('switches per-slot params, reading the track waveform when a slot has none', () => {
        const song = converted();
        song.trackParamStorage = {
            synthA: [{ filterCutoff: 900 }, null],
            synthB: [{ waveform: 'square' }],
            bass2: [],
        };
        const forced = force303Engine(song, 'jc303');
        expect(forced.trackParamStorage!.synthA[0]).toEqual({ filterCutoff: 900, engine303: 'jc303', model303: 'jc303' });
        expect(forced.trackParamStorage!.synthA[1]).toBeNull();
        expect(forced.trackParamStorage!.synthB[0]).toEqual({ waveform: 'square' });
        expect(song.trackParamStorage.synthA[0]).toEqual({ filterCutoff: 900 });
    });
});

describe('agent hook helpers', () => {
    it('registers only behind ?agent / ?e2e', () => {
        expect(isAgentQuery('?agent=1')).toBe(true);
        expect(isAgentQuery('?foo=1&e2e=1')).toBe(true);
        expect(isAgentQuery('')).toBe(false);
        expect(isAgentQuery('?devtools')).toBe(false);
    });

    it('base64-encodes large buffers in chunks', () => {
        const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 31) & 0xff);
        expect(Buffer.from(bytesToBase64(bytes), 'base64').equals(Buffer.from(bytes))).toBe(true);
    });

    it('describes every import error type', () => {
        expect(describeImportError({ type: 'UNSUPPORTED_VERSION', version: '2.0' })).toBe('meta.version: unsupported version "2.0"');
        expect(describeImportError({ type: 'INVALID_NOTE', note: 'H9', track: 'synthA' })).toBe('tracks.synthA: invalid note "H9"');
        expect(describeImportError({ type: 'CONVERSION_ERROR', track: 'kick', details: 'boom' })).toBe('kick: boom');
    });
});
