/**
 * engine303-roundtrip.test.ts
 *
 * Verifies that the engine303 field is correctly preserved when a song is
 * serialised to and deserialised from the SavedSongData JSON format.
 *
 * This exercises the data-layer round-trip (JSON.stringify → JSON.parse)
 * that all storage paths (localStorage, cloud, AI importer) share.
 */

import { describe, it, expect } from 'vitest';
import type { SavedSongData, SynthParams, Bass2Params } from '../types';
import { DEFAULT_SYNTH_PARAMS_A, DEFAULT_SYNTH_PARAMS_B, DEFAULT_BASS2_PARAMS } from '../constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSongData(overrides: {
    synthAEngine?: SynthParams['engine303'];
    synthBEngine?: SynthParams['engine303'];
    bass2Engine?: Bass2Params['engine303'];
}): SavedSongData {
    return {
        version: 1,
        pattern: {
            partA: { steps: Array(32).fill(null) },
            partB: { steps: Array(32).fill(null) },
            bass2: { steps: Array(32).fill(null) },
            kick: Array(32).fill(0),
            snare: Array(32).fill(0),
            closedHat: Array(32).fill(0),
            openHat: Array(32).fill(0),
            sampler: Array(32).fill(0),
        } as any,
        params: {
            synthA: { ...DEFAULT_SYNTH_PARAMS_A, engine303: overrides.synthAEngine },
            synthB: { ...DEFAULT_SYNTH_PARAMS_B, engine303: overrides.synthBEngine },
            // bass2 is not in the official SavedSongData params type, but is stored by useSongStorage
            ...(overrides.bass2Engine !== undefined && {
                bass2: { ...DEFAULT_BASS2_PARAMS, engine303: overrides.bass2Engine } as any,
            }),
            kick: { pitch: 60, decay: 0.4, tone: 0.9, volume: 1 },
            snare: { decay: 0.2, tone: 150, noise: 5000, volume: 0.8 },
            closedHat: { pitch: 9000, decay: 0.05, volume: 0.4 },
            openHat: { pitch: 7000, decay: 0.4, volume: 0.4 },
            sampler: [] as any,
        },
        trackStorage: {},
        activeTrackSlots: {},
        songStructure: [],
        tempo: 120,
    };
}

function roundTrip<T>(data: T): T {
    return JSON.parse(JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('engine303 JSON round-trip (SavedSongData)', () => {
    it('synthA.engine303="jc303" survives JSON serialisation', () => {
        const song = makeSongData({ synthAEngine: 'jc303' });
        const restored = roundTrip(song);
        expect(restored.params.synthA.engine303).toBe('jc303');
    });

    it('synthA.engine303="open303" survives JSON serialisation', () => {
        const song = makeSongData({ synthAEngine: 'open303' });
        const restored = roundTrip(song);
        expect(restored.params.synthA.engine303).toBe('open303');
    });

    it('synthB.engine303="jc303" survives JSON serialisation', () => {
        const song = makeSongData({ synthBEngine: 'jc303' });
        const restored = roundTrip(song);
        expect(restored.params.synthB.engine303).toBe('jc303');
    });

    it('synthA.engine303=undefined is preserved as undefined through round-trip', () => {
        const song = makeSongData({ synthAEngine: undefined });
        const restored = roundTrip(song);
        // JSON drops undefined fields; the restored value will be undefined
        expect(restored.params.synthA.engine303).toBeUndefined();
    });

    it('bass2.engine303="jc303" survives JSON serialisation', () => {
        const song = makeSongData({ bass2Engine: 'jc303' });
        const restored = roundTrip(song);
        expect((restored.params as any).bass2?.engine303).toBe('jc303');
    });

    it('bass2.engine303="open303" survives JSON serialisation', () => {
        const song = makeSongData({ bass2Engine: 'open303' });
        const restored = roundTrip(song);
        expect((restored.params as any).bass2?.engine303).toBe('open303');
    });

    it('all three voices with jc303 survive a round-trip', () => {
        const song = makeSongData({
            synthAEngine: 'jc303',
            synthBEngine: 'jc303',
            bass2Engine: 'jc303',
        });
        const restored = roundTrip(song);
        expect(restored.params.synthA.engine303).toBe('jc303');
        expect(restored.params.synthB.engine303).toBe('jc303');
        expect((restored.params as any).bass2?.engine303).toBe('jc303');
    });

    it('engine303 field does not bleed between voices during round-trip', () => {
        const song = makeSongData({
            synthAEngine: 'jc303',
            synthBEngine: 'open303',
            bass2Engine: 'jc303',
        });
        const restored = roundTrip(song);
        expect(restored.params.synthA.engine303).toBe('jc303');
        expect(restored.params.synthB.engine303).toBe('open303');
        expect((restored.params as any).bass2?.engine303).toBe('jc303');
    });
});

describe('engine303 in SavedSongData version field', () => {
    it('a song with engine303="jc303" and version=1 is deserialised correctly', () => {
        const song = makeSongData({ synthAEngine: 'jc303' });
        expect(song.version).toBe(1);
        const restored = roundTrip(song);
        expect(restored.version).toBe(1);
        expect(restored.params.synthA.engine303).toBe('jc303');
    });
});
