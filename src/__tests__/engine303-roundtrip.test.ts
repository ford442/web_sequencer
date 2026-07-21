/**
 * engine303-roundtrip.test.ts
 *
 * Verifies that the engine303 and model303 fields are correctly preserved when
 * a song is serialised to and deserialised from the SavedSongData JSON format.
 *
 * This exercises the data-layer round-trip (JSON.stringify → JSON.parse)
 * that all storage paths (localStorage, cloud, AI importer) share.
 */

import { describe, it, expect } from 'vitest';
import type { SavedSongData, SynthParams, Bass2Params } from '../types';
import { DEFAULT_SYNTH_PARAMS_A, DEFAULT_SYNTH_PARAMS_B, DEFAULT_BASS2_PARAMS } from '../constants';
import { getAvailableTB303Models, normalizeTB303Model } from '../engines/TB303Models';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSongData(overrides: {
    synthAEngine?: SynthParams['engine303'];
    synthBEngine?: SynthParams['engine303'];
    bass2Engine?: Bass2Params['engine303'];
    synthAModel?: SynthParams['model303'];
    synthBModel?: SynthParams['model303'];
    bass2Model?: Bass2Params['model303'];
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
            synthA: {
                ...DEFAULT_SYNTH_PARAMS_A,
                engine303: overrides.synthAEngine,
                ...(overrides.synthAModel !== undefined && { model303: overrides.synthAModel }),
            },
            synthB: {
                ...DEFAULT_SYNTH_PARAMS_B,
                engine303: overrides.synthBEngine,
                ...(overrides.synthBModel !== undefined && { model303: overrides.synthBModel }),
            },
            // bass2 is not in the official SavedSongData params type, but is stored by useSongStorage
            ...(overrides.bass2Engine !== undefined || overrides.bass2Model !== undefined
                ? {
                    bass2: {
                        ...DEFAULT_BASS2_PARAMS,
                        ...(overrides.bass2Engine !== undefined && { engine303: overrides.bass2Engine }),
                        ...(overrides.bass2Model !== undefined && { model303: overrides.bass2Model }),
                    } as any,
                }
                : {}),
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

// ---------------------------------------------------------------------------
// model303 JSON round-trip (SavedSongData)
// ---------------------------------------------------------------------------

describe('model303 JSON round-trip (SavedSongData)', () => {
    it('synthA.model303="experimental-01" survives JSON serialisation', () => {
        const song = makeSongData({ synthAModel: 'experimental-01', synthAEngine: 'open303' });
        const restored = roundTrip(song);
        expect(restored.params.synthA.model303).toBe('experimental-01');
    });

    it('synthB.model303="jc303" survives JSON serialisation', () => {
        const song = makeSongData({ synthBModel: 'jc303', synthBEngine: 'jc303' });
        const restored = roundTrip(song);
        expect(restored.params.synthB.model303).toBe('jc303');
    });

    it('bass2.model303="1ink303-v1" survives JSON serialisation', () => {
        const song = makeSongData({ bass2Model: '1ink303-v1', bass2Engine: 'open303' });
        const restored = roundTrip(song);
        expect((restored.params as any).bass2?.model303).toBe('1ink303-v1');
    });

    it('all three parts with distinct model303 ids survive a round-trip', () => {
        const song = makeSongData({
            synthAModel: 'jc303',
            synthBModel: 'stock-open303',
            bass2Model: 'experimental-01',
            synthAEngine: 'jc303',
            synthBEngine: 'open303',
            bass2Engine: 'open303',
        });
        const restored = roundTrip(song);
        expect(restored.params.synthA.model303).toBe('jc303');
        expect(restored.params.synthB.model303).toBe('stock-open303');
        expect((restored.params as any).bass2?.model303).toBe('experimental-01');
    });

    it('model303 does not bleed between voices during round-trip', () => {
        const song = makeSongData({
            synthAModel: 'rebirth-338-1.5',
            synthBModel: 'mb33-mkii',
            bass2Model: 'raveolution',
        });
        const restored = roundTrip(song);
        expect(restored.params.synthA.model303).toBe('rebirth-338-1.5');
        expect(restored.params.synthB.model303).toBe('mb33-mkii');
        expect((restored.params as any).bass2?.model303).toBe('raveolution');
    });

    it('every available model id round-trips and normalizes to itself on load', () => {
        for (const m of getAvailableTB303Models()) {
            const song = makeSongData({ synthAModel: m.id });
            const restored = roundTrip(song);
            expect(restored.params.synthA.model303).toBe(m.id);
            expect(normalizeTB303Model(restored.params.synthA.model303, restored.params.synthA.engine303))
                .toBe(m.id);
        }
    });

    it('legacy engine303="open303" without model303 normalizes to stock-open303 on load', () => {
        const song = makeSongData({ synthAEngine: 'open303' });
        const restored = roundTrip(song);
        expect(restored.params.synthA.model303).toBeUndefined();
        expect(normalizeTB303Model(restored.params.synthA.model303, restored.params.synthA.engine303))
            .toBe('stock-open303');
    });
});
