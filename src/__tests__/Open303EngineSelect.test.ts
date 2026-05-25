/**
 * Tests for per-voice engine selection (open303 / jc303).
 *
 * Covers:
 *  - Open303Oscillator.setEngine303() posts the correct worklet message
 *  - Open303Manager.setBass1Engine() / setBass2Engine() delegate to oscillators
 *  - Default values: Bass2Params.engine303 = 'open303', SynthParams.engine303 = undefined
 *  - Engine303 type values are 'open303' and 'jc303'
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Open303Oscillator } from '../engines/Open303Oscillator';
import { Open303Manager } from '../engines/Open303Manager';
import { DEFAULT_BASS2_PARAMS } from '../constants';
import type { Engine303, Bass2Params, SynthParams } from '../types';

// ---------------------------------------------------------------------------
// Open303Oscillator.setEngine303
// ---------------------------------------------------------------------------

describe('Open303Oscillator.setEngine303()', () => {
    let oscillator: Open303Oscillator;
    let mockPostMessage: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        oscillator = new Open303Oscillator();
        mockPostMessage = vi.fn();

        // Inject a fake worklet node with a mock port
        const fakePort = { postMessage: mockPostMessage } as unknown as MessagePort;
        const fakeNode = { port: fakePort } as unknown as AudioWorkletNode;
        (oscillator as any).workletNode = fakeNode;
        (oscillator as any).isReady = true;
    });

    it('posts a set-engine message with engine="jc303"', () => {
        oscillator.setEngine303('jc303');

        expect(mockPostMessage).toHaveBeenCalledOnce();
        expect(mockPostMessage).toHaveBeenCalledWith({
            type: 'set-engine',
            data: { engine: 'jc303' },
        });
    });

    it('posts a set-engine message with engine="open303"', () => {
        oscillator.setEngine303('open303');

        expect(mockPostMessage).toHaveBeenCalledOnce();
        expect(mockPostMessage).toHaveBeenCalledWith({
            type: 'set-engine',
            data: { engine: 'open303' },
        });
    });

    it('does nothing when workletNode is null (not yet initialised)', () => {
        (oscillator as any).workletNode = null;
        oscillator.setEngine303('jc303');
        expect(mockPostMessage).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// Open303Manager engine delegation
// ---------------------------------------------------------------------------

describe('Open303Manager engine selection', () => {
    let manager: Open303Manager;
    let bass1SetEngine: ReturnType<typeof vi.fn>;
    let bass2SetEngine: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        manager = new Open303Manager();

        bass1SetEngine = vi.fn();
        bass2SetEngine = vi.fn();

        // Inject fake oscillators that track setEngine303 calls
        const fakeBass1 = { setEngine303: bass1SetEngine } as unknown as Open303Oscillator;
        const fakeBass2 = { setEngine303: bass2SetEngine } as unknown as Open303Oscillator;

        (manager as any).bass1 = fakeBass1;
        (manager as any).bass2 = fakeBass2;
    });

    it('setBass1Engine delegates to bass1.setEngine303()', () => {
        manager.setBass1Engine('jc303');
        expect(bass1SetEngine).toHaveBeenCalledOnce();
        expect(bass1SetEngine).toHaveBeenCalledWith('jc303');
        expect(bass2SetEngine).not.toHaveBeenCalled();
    });

    it('setBass2Engine delegates to bass2.setEngine303()', () => {
        manager.setBass2Engine('open303');
        expect(bass2SetEngine).toHaveBeenCalledOnce();
        expect(bass2SetEngine).toHaveBeenCalledWith('open303');
        expect(bass1SetEngine).not.toHaveBeenCalled();
    });

    it('setBass1Engine is a no-op when bass1 is null', () => {
        (manager as any).bass1 = null;
        expect(() => manager.setBass1Engine('jc303')).not.toThrow();
    });

    it('setBass2Engine is a no-op when bass2 is null', () => {
        (manager as any).bass2 = null;
        expect(() => manager.setBass2Engine('jc303')).not.toThrow();
    });

    it('supports switching back to open303 from jc303', () => {
        manager.setBass2Engine('jc303');
        manager.setBass2Engine('open303');
        expect(bass2SetEngine).toHaveBeenCalledTimes(2);
        expect(bass2SetEngine).toHaveBeenNthCalledWith(1, 'jc303');
        expect(bass2SetEngine).toHaveBeenNthCalledWith(2, 'open303');
    });
});

// ---------------------------------------------------------------------------
// Default parameter values
// ---------------------------------------------------------------------------

describe('DEFAULT_BASS2_PARAMS.engine303', () => {
    it('defaults to "open303" for backward compatibility', () => {
        expect(DEFAULT_BASS2_PARAMS.engine303).toBe('open303');
    });
});

// ---------------------------------------------------------------------------
// Type-level checks (Engine303 values, optional fields)
// ---------------------------------------------------------------------------

describe('Engine303 type', () => {
    it('accepts "open303" as a valid Engine303 value', () => {
        const e: Engine303 = 'open303';
        expect(e).toBe('open303');
    });

    it('accepts "jc303" as a valid Engine303 value', () => {
        const e: Engine303 = 'jc303';
        expect(e).toBe('jc303');
    });
});

describe('Bass2Params.engine303 (optional field)', () => {
    it('can be undefined (backward compat with saved presets)', () => {
        const params: Bass2Params = {
            waveform: '303-saw',
            cutoff: 3000,
            resonance: 12,
            filterMode: 0,
            decay: 0.4,
            accent: 0.7,
            envMod: 0.5,
            volume: 0.45,
            pitch: -12,
            // engine303 intentionally omitted
        };
        expect(params.engine303).toBeUndefined();
    });

    it('accepts "jc303" explicitly', () => {
        const params: Bass2Params = {
            waveform: '303-sqr',
            cutoff: 2000,
            resonance: 8,
            filterMode: 0,
            decay: 0.3,
            accent: 0.5,
            envMod: 0.4,
            volume: 0.4,
            pitch: 0,
            engine303: 'jc303',
        };
        expect(params.engine303).toBe('jc303');
    });
});

describe('SynthParams.engine303 (optional field)', () => {
    it('can be undefined for non-303 waveforms', () => {
        const params: SynthParams = {
            waveform: 'sawtooth',
            pitch: 0,
            filterCutoff: 2000,
            filterResonance: 1,
            attack: 0.01,
            decay: 0.2,
            sustain: 0.7,
            release: 0.3,
            length: 0.25,
            volume: 0.8,
            delayTime: 0,
            delayFeedback: 0,
            delayMix: 0,
        };
        expect(params.engine303).toBeUndefined();
    });

    it('accepts "jc303" for 303 waveforms', () => {
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
            engine303: 'jc303',
        };
        expect(params.engine303).toBe('jc303');
    });
});
