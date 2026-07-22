/**
 * Tests for the "303 Voices" model registry (src/engines/TB303Models.ts)
 * and the model-selection plumbing through Open303Oscillator/Open303Manager.
 *
 * Covers:
 *  - Registry integrity (unique stable ids, stock voices present + available)
 *  - normalizeTB303Model: legacy engine303 fallback, unknown ids, unavailable
 *    models falling back to their family's stock voice
 *  - Open303Oscillator.setModel303() posts the set-303-model worklet message
 *    with the engine-family fallback hint and re-pushes params
 *  - Open303Manager model delegation + syncModel303Settings
 *  - model303 survives a SavedSongData-style JSON round-trip
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    TB303_MODELS,
    getTB303Model,
    getAvailableTB303Models,
    normalizeTB303Model,
    reportTB303ModelFallback,
    tb303ModelFamily,
    stockModelForFamily,
} from '../engines/TB303Models';
import { Open303Oscillator } from '../engines/Open303Oscillator';
import { Open303Manager } from '../engines/Open303Manager';
import { DEFAULT_BASS2_PARAMS } from '../constants';
import { DEFAULT_TB303_VOICE_FIELDS } from '../engines/TB303Models';
import type { SynthParams, TB303ModelId } from '../types';

// ---------------------------------------------------------------------------
// Registry integrity
// ---------------------------------------------------------------------------

describe('TB303_MODELS registry', () => {
    it('has unique ids', () => {
        const ids = TB303_MODELS.map((m) => m.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('contains both stock voices, available, on the right families', () => {
        const stock = getTB303Model('stock-open303');
        const jc = getTB303Model('jc303');
        expect(stock).toMatchObject({ family: 'open303', available: true });
        expect(jc).toMatchObject({ family: 'jc303', available: true });
    });

    it('lists stock-open303 first (safe default ordering for the UI)', () => {
        expect(TB303_MODELS[0].id).toBe('stock-open303');
    });

    it('ships the first-wave experimental voices', () => {
        expect(getTB303Model('experimental-01')?.available).toBe(true);
        expect(getTB303Model('1ink303-v1')?.available).toBe(true);
    });

    it('ships the ReBirth character voices as open303-family profiles', () => {
        for (const id of ['rebirth-338-1.5', 'rebirth-2.0']) {
            const m = getTB303Model(id);
            expect(m, id).toBeDefined();
            expect(m!.available, id).toBe(true);
            expect(m!.family, id).toBe('open303');
            // "inspired-by" disclaimer surfaced to the user, not a clone claim.
            expect(m!.description.toLowerCase(), id).toContain('not a clone');
        }
    });

    it('ships the P2 character voices as open303-family profiles', () => {
        for (const id of ['mb33-mkii', 'raveolution']) {
            const m = getTB303Model(id);
            expect(m, id).toBeDefined();
            expect(m!.available, id).toBe(true);
            expect(m!.family, id).toBe('open303');
            // "inspired-by" disclaimer surfaced to the user, not a clone claim.
            expect(m!.description.toLowerCase(), id).toContain('not a clone');
        }
    });

    it('getAvailableTB303Models returns only available entries', () => {
        const available = getAvailableTB303Models();
        expect(available.length).toBeGreaterThanOrEqual(4);
        expect(available.every((m) => m.available)).toBe(true);
    });

    it('every model has a label and a description (used for UI tooltips)', () => {
        for (const m of TB303_MODELS) {
            expect(m.label.length, m.id).toBeGreaterThan(0);
            expect(m.description.length, m.id).toBeGreaterThan(0);
        }
    });
});

// ---------------------------------------------------------------------------
// normalizeTB303Model
// ---------------------------------------------------------------------------

describe('normalizeTB303Model()', () => {
    it('defaults to stock-open303 with no inputs', () => {
        expect(normalizeTB303Model()).toBe('stock-open303');
        expect(normalizeTB303Model(undefined, undefined)).toBe('stock-open303');
    });

    it('keeps a known, available model', () => {
        expect(normalizeTB303Model('experimental-01')).toBe('experimental-01');
        expect(normalizeTB303Model('jc303')).toBe('jc303');
    });

    it('maps legacy engine303 values when model303 is absent (old songs)', () => {
        expect(normalizeTB303Model(undefined, 'jc303')).toBe('jc303');
        expect(normalizeTB303Model(undefined, 'open303')).toBe('stock-open303');
    });

    it('model303 wins over a conflicting legacy engine303', () => {
        expect(normalizeTB303Model('experimental-01', 'jc303')).toBe('experimental-01');
    });

    it('keeps the now-available ReBirth voices', () => {
        expect(normalizeTB303Model('rebirth-338-1.5')).toBe('rebirth-338-1.5');
        expect(normalizeTB303Model('rebirth-2.0')).toBe('rebirth-2.0');
    });

    it('keeps the P2 character voices', () => {
        expect(normalizeTB303Model('mb33-mkii')).toBe('mb33-mkii');
        expect(normalizeTB303Model('raveolution')).toBe('raveolution');
    });

    it('falls back for unknown ids from future song versions', () => {
        expect(normalizeTB303Model('some-future-voice')).toBe('stock-open303');
        expect(normalizeTB303Model('some-future-voice', 'jc303')).toBe('jc303');
    });

    it('reportFallback logs and resolves when an unknown id is requested', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const resolved = normalizeTB303Model('wasm-discovered-voice', undefined, {
            reportFallback: true,
            subsystem: 'test-model303',
        });
        expect(resolved).toBe('stock-open303');
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('wasm-discovered-voice'));
        warn.mockRestore();
    });
});

describe('family helpers', () => {
    it('tb303ModelFamily resolves families and defaults to open303', () => {
        expect(tb303ModelFamily('jc303')).toBe('jc303');
        expect(tb303ModelFamily('experimental-01')).toBe('open303');
        expect(tb303ModelFamily('nope')).toBe('open303');
        expect(tb303ModelFamily(undefined)).toBe('open303');
    });

    it('stockModelForFamily returns the stock voice per family', () => {
        expect(stockModelForFamily('open303')).toBe('stock-open303');
        expect(stockModelForFamily('jc303')).toBe('jc303');
    });
});

// ---------------------------------------------------------------------------
// Open303Oscillator.setModel303
// ---------------------------------------------------------------------------

describe('Open303Oscillator.setModel303()', () => {
    let oscillator: Open303Oscillator;
    let mockPostMessage: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        oscillator = new Open303Oscillator();
        mockPostMessage = vi.fn();
        const fakePort = { postMessage: mockPostMessage } as unknown as MessagePort;
        const fakeNode = { port: fakePort } as unknown as AudioWorkletNode;
        (oscillator as any).workletNode = fakeNode;
        (oscillator as any).isReady = true;
    });

    it('posts set-303-model with the engine-family fallback hint and re-pushes params', () => {
        oscillator.setModel303('experimental-01');

        expect(mockPostMessage).toHaveBeenCalledWith({
            type: 'set-303-model',
            data: { model: 'experimental-01', engine: 'open303' },
        });
        expect(mockPostMessage.mock.calls.some(
            (call) => call[0]?.type === 'param' && call[0]?.data?.func === 'jc303_setCutoff',
        )).toBe(true);
    });

    it('selecting the jc303 voice carries engine="jc303"', () => {
        oscillator.setModel303('jc303');
        expect(mockPostMessage).toHaveBeenCalledWith({
            type: 'set-303-model',
            data: { model: 'jc303', engine: 'jc303' },
        });
    });

    it('normalizes unknown model ids to stock-open303', () => {
        oscillator.setModel303('definitely-not-a-voice');
        expect(mockPostMessage).toHaveBeenCalledWith({
            type: 'set-303-model',
            data: { model: 'stock-open303', engine: 'open303' },
        });
        expect(oscillator.getModel303()).toBe('stock-open303');
    });

    it('legacy setEngine303 keeps the model state in sync', () => {
        oscillator.setEngine303('jc303');
        expect(oscillator.getModel303()).toBe('jc303');
        oscillator.setEngine303('open303');
        expect(oscillator.getModel303()).toBe('stock-open303');
    });

    it('does nothing when workletNode is null (model still persisted for later)', () => {
        (oscillator as any).workletNode = null;
        oscillator.setModel303('1ink303-v1');
        expect(mockPostMessage).not.toHaveBeenCalled();
        expect(oscillator.getModel303()).toBe('1ink303-v1');
    });
});

// ---------------------------------------------------------------------------
// Open303Manager model delegation
// ---------------------------------------------------------------------------

describe('Open303Manager model selection', () => {
    let manager: Open303Manager;
    let bass1SetModel: ReturnType<typeof vi.fn>;
    let bass2SetModel: ReturnType<typeof vi.fn>;
    let leadSetModel: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        manager = new Open303Manager();
        bass1SetModel = vi.fn();
        bass2SetModel = vi.fn();
        leadSetModel = vi.fn();

        (manager as any).bass1 = { setModel303: bass1SetModel } as unknown as Open303Oscillator;
        (manager as any).bass2 = { setModel303: bass2SetModel } as unknown as Open303Oscillator;
        (manager as any).lead303 = { setModel303: leadSetModel } as unknown as Open303Oscillator;
    });

    it('setBass1Model / setBass2Model / setLead303Model delegate independently', () => {
        manager.setBass1Model('experimental-01');
        manager.setBass2Model('jc303');
        manager.setLead303Model('1ink303-v1');

        expect(bass1SetModel).toHaveBeenCalledWith('experimental-01');
        expect(bass2SetModel).toHaveBeenCalledWith('jc303');
        expect(leadSetModel).toHaveBeenCalledWith('1ink303-v1');
    });

    it('model setters are no-ops when the oscillator is null', () => {
        (manager as any).bass1 = null;
        (manager as any).bass2 = null;
        (manager as any).lead303 = null;
        expect(() => {
            manager.setBass1Model('jc303');
            manager.setBass2Model('jc303');
            manager.setLead303Model('jc303');
        }).not.toThrow();
    });

    it('syncModel303Settings applies every provided voice', () => {
        manager.syncModel303Settings({
            lead: 'jc303',
            bass1: 'stock-open303',
            bass2: 'experimental-01',
        });
        expect(leadSetModel).toHaveBeenCalledWith('jc303');
        expect(bass1SetModel).toHaveBeenCalledWith('stock-open303');
        expect(bass2SetModel).toHaveBeenCalledWith('experimental-01');
    });

    it('syncModel303Settings skips omitted voices', () => {
        manager.syncModel303Settings({ bass2: 'jc303' });
        expect(bass2SetModel).toHaveBeenCalledWith('jc303');
        expect(leadSetModel).not.toHaveBeenCalled();
        expect(bass1SetModel).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

describe('model303 persistence', () => {
    it('DEFAULT_BASS2_PARAMS carries the stock voice and the legacy mirror', () => {
        expect(DEFAULT_BASS2_PARAMS.model303).toBe('stock-open303');
        expect(DEFAULT_BASS2_PARAMS.engine303).toBe('open303');
        expect(DEFAULT_TB303_VOICE_FIELDS).toEqual({
            model303: 'stock-open303',
            engine303: 'open303',
        });
        expect(DEFAULT_BASS2_PARAMS.engine303).toBe('open303');
    });

    it('model303 survives a JSON round-trip on SynthParams', () => {
        const params: SynthParams = {
            waveform: '303-saw',
            pitch: 0,
            filterCutoff: 3000,
            filterResonance: 8,
            attack: 0.01,
            decay: 0.3,
            sustain: 0,
            release: 0.1,
            length: 0.25,
            volume: 0.8,
            delayTime: 0,
            delayFeedback: 0,
            delayMix: 0,
            engine303: 'open303',
            model303: 'experimental-01',
        };
        const restored = JSON.parse(JSON.stringify(params)) as SynthParams;
        expect(restored.model303).toBe('experimental-01');
        // A legacy build reading the same song still gets a valid stock engine.
        expect(restored.engine303).toBe('open303');
    });

    it('legacy songs (engine303 only) resolve to the correct voices on load', () => {
        const legacyA = { engine303: 'jc303' as const };
        const legacyB = {};
        expect(normalizeTB303Model(undefined, legacyA.engine303)).toBe('jc303');
        expect(normalizeTB303Model(undefined, (legacyB as { engine303?: string }).engine303)).toBe('stock-open303');
    });

    it('every available model id round-trips as a TB303ModelId', () => {
        for (const m of getAvailableTB303Models()) {
            const restored = JSON.parse(JSON.stringify({ model303: m.id })) as { model303: TB303ModelId };
            expect(normalizeTB303Model(restored.model303)).toBe(m.id);
        }
    });
});
