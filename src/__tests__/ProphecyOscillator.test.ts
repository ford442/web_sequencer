/**
 * ProphecyOscillator.test.ts
 *
 * Unit tests for the Korg Prophecy formant synthesis engine TypeScript layer.
 *
 * Covers:
 *  - ProphecyOscillator.noteOn / noteOff / allNotesOff send the right
 *    control-plane records on the part's route (#1497 P2)
 *  - ProphecyOscillator.setParam sends a PARAM_SET record
 *  - Convenience setters (setWaveform, setVowel, …) send the right paramId
 *  - No-op behaviour when workletNode is null (not yet initialised)
 *  - cleanup() clears isReady and disconnects nodes
 *  - ProphecyParam enum values match the C++ enum in prophecy_wrapper.cpp
 *  - DEFAULT_PROPHECY_PARAMS has sensible range values
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProphecyOscillator } from '../engines/ProphecyOscillator';
import { ProphecyParam, DEFAULT_PROPHECY_PARAMS } from '../engines/ProphecyParams';
import type { ProphecyParams } from '../engines/ProphecyParams';
import { EventType } from '../shared/rt/eventLayout';
import { postedRecords, postedTypes } from '../test/helpers/controlPlaneRecords';

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a ProphecyOscillator that already has a mock workletNode injected,
 * its route open on the node's port as init leaves it on a page without
 * shared memory, so we can read what it sends without a real worklet.
 */
function makeReadyOscillator(): {
    osc:             ProphecyOscillator;
    mockPostMessage: ReturnType<typeof vi.fn>;
    mockClose:       ReturnType<typeof vi.fn>;
} {
    const mockPostMessage = vi.fn();
    const mockClose       = vi.fn();
    const fakePort        = { postMessage: mockPostMessage, close: mockClose } as unknown as MessagePort;
    const fakeDisconnect  = vi.fn();
    const fakeNode        = { port: fakePort, disconnect: fakeDisconnect } as unknown as AudioWorkletNode;

    const osc = new ProphecyOscillator();
    (osc as any).workletNode = fakeNode;
    (osc as any).isReady     = true;
    (osc as any).events.open(fakePort, { sampleRate: 48000, sharedMemory: false, voiceRing: true });

    return { osc, mockPostMessage, mockClose };
}

// ─────────────────────────────────────────────────────────────────────────────
// MIDI message tests
// ─────────────────────────────────────────────────────────────────────────────

describe('ProphecyOscillator MIDI messages', () => {
    let osc:             ProphecyOscillator;
    let mockPostMessage: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        ({ osc, mockPostMessage } = makeReadyOscillator());
    });

    const sent = () => postedRecords(mockPostMessage).map((e) => [e.frame, e.type, e.target, e.value]);

    it('noteOn sends a NOTE_ON record on the frame of its audioTime, and no note message', () => {
        osc.noteOn(60, 100, 2);
        expect(sent()).toEqual([[96000, EventType.NoteOn, 60, 100]]);
        expect(postedTypes(mockPostMessage)).toEqual([]);
    });

    it('noteOn uses default velocity of 100; no audioTime is frame 0, the next block', () => {
        osc.noteOn(69);
        expect(sent()).toEqual([[0, EventType.NoteOn, 69, 100]]);
    });

    it('noteOff sends a NOTE_OFF record', () => {
        osc.noteOff(60, 2.5);
        expect(sent()).toEqual([[120000, EventType.NoteOff, 60, 0]]);
    });

    it('allNotesOff sends CANCEL_NOTES, then ALL_NOTES_OFF on the next block', () => {
        osc.noteOn(60, 100, 3);
        osc.allNotesOff();
        expect(sent()).toEqual([
            [144000, EventType.NoteOn, 60, 100],
            [0, EventType.CancelNotes, 0, 0],
            [0, EventType.AllNotesOff, 0, 0],
        ]);
    });

    it('a tick\'s records go out as one batch', () => {
        osc.noteOn(60, 100, 1);
        osc.noteOff(60, 1.5);
        postedRecords(mockPostMessage);
        expect(mockPostMessage).toHaveBeenCalledOnce();
    });

    it('noteOn is a no-op when workletNode is null', () => {
        (osc as any).workletNode = null;
        osc.noteOn(60, 100);
        expect(sent()).toEqual([]);
        expect(mockPostMessage).not.toHaveBeenCalled();
    });

    it('noteOff is a no-op when workletNode is null', () => {
        (osc as any).workletNode = null;
        osc.noteOff(60);
        expect(sent()).toEqual([]);
    });

    it('noteOn is a no-op when isReady is false', () => {
        (osc as any).isReady = false;
        osc.noteOn(60, 80);
        expect(sent()).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// setParam / convenience setters
// ─────────────────────────────────────────────────────────────────────────────

describe('ProphecyOscillator.setParam()', () => {
    let osc:             ProphecyOscillator;
    let mockPostMessage: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        ({ osc, mockPostMessage } = makeReadyOscillator());
    });

    const params = () => postedRecords(mockPostMessage).map((e) => [e.type, e.target, e.value]);

    it('sends a PARAM_SET record with the paramId as its target', () => {
        osc.setParam(ProphecyParam.VOWEL, 0.5);
        expect(params()).toEqual([[EventType.Param, ProphecyParam.VOWEL, 0.5]]);
        expect(postedTypes(mockPostMessage)).toEqual([]);
    });

    it('setWaveform sends paramId=0', () => {
        osc.setWaveform(1);
        expect(params()).toEqual([[EventType.Param, 0, Math.fround(1)]]);
    });

    it('setVowel sends paramId=1', () => {
        osc.setVowel(2);
        expect(params()).toEqual([[EventType.Param, 1, Math.fround(2)]]);
    });

    it('setVolume sends paramId=2', () => {
        osc.setVolume(0.8);
        expect(params()).toEqual([[EventType.Param, 2, Math.fround(0.8)]]);
    });

    it('setAttack sends paramId=3', () => {
        osc.setAttack(0.2);
        expect(params()).toEqual([[EventType.Param, 3, Math.fround(0.2)]]);
    });

    it('setDecay sends paramId=4', () => {
        osc.setDecay(0.4);
        expect(params()).toEqual([[EventType.Param, 4, Math.fround(0.4)]]);
    });

    it('setSustain sends paramId=5', () => {
        osc.setSustain(0.6);
        expect(params()).toEqual([[EventType.Param, 5, Math.fround(0.6)]]);
    });

    it('setRelease sends paramId=6', () => {
        osc.setRelease(0.3);
        expect(params()).toEqual([[EventType.Param, 6, Math.fround(0.3)]]);
    });

    it('setPortamento sends paramId=7', () => {
        osc.setPortamento(0.5);
        expect(params()).toEqual([[EventType.Param, 7, Math.fround(0.5)]]);
    });

    it('setFormantShift sends paramId=8', () => {
        osc.setFormantShift(0.25);
        expect(params()).toEqual([[EventType.Param, 8, Math.fround(0.25)]]);
    });

    it('setResonance sends paramId=9', () => {
        osc.setResonance(0.7);
        expect(params()).toEqual([[EventType.Param, 9, Math.fround(0.7)]]);
    });

    it('setParam is a no-op when workletNode is null', () => {
        (osc as any).workletNode = null;
        osc.setParam(ProphecyParam.VOLUME, 0.5);
        expect(params()).toEqual([]);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Internal parameter snapshot
// ─────────────────────────────────────────────────────────────────────────────

describe('ProphecyOscillator internal param snapshot', () => {
    it('convenience setters update the internal params snapshot', () => {
        const { osc } = makeReadyOscillator();
        osc.setWaveform(2);
        expect((osc as any).params.waveform).toBe(2);

        osc.setVowel(3);
        expect((osc as any).params.vowel).toBe(3);

        osc.setVolume(0.9);
        expect((osc as any).params.volume).toBe(0.9);

        osc.setAttack(0.1);
        expect((osc as any).params.attack).toBe(0.1);

        osc.setRelease(0.8);
        expect((osc as any).params.release).toBe(0.8);

        osc.setFormantShift(0.5);
        expect((osc as any).params.formantShift).toBe(0.5);

        osc.setResonance(0.3);
        expect((osc as any).params.resonance).toBe(0.3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// cleanup()
// ─────────────────────────────────────────────────────────────────────────────

describe('ProphecyOscillator.cleanup()', () => {
    it('sets isReady to false', () => {
        const { osc } = makeReadyOscillator();
        osc.cleanup();
        expect(osc.isReady).toBe(false);
    });

    it('nulls workletNode after cleanup', () => {
        const { osc } = makeReadyOscillator();
        osc.cleanup();
        expect((osc as any).workletNode).toBeNull();
    });

    it('does not throw when workletNode is already null', () => {
        const osc = new ProphecyOscillator();
        expect(() => osc.cleanup()).not.toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// ProphecyParam enum values (must stay in sync with prophecy_wrapper.cpp)
// ─────────────────────────────────────────────────────────────────────────────

describe('ProphecyParam constants', () => {
    it('WAVEFORM = 0',       () => { expect(ProphecyParam.WAVEFORM).toBe(0); });
    it('VOWEL = 1',          () => { expect(ProphecyParam.VOWEL).toBe(1); });
    it('VOLUME = 2',         () => { expect(ProphecyParam.VOLUME).toBe(2); });
    it('ATTACK = 3',         () => { expect(ProphecyParam.ATTACK).toBe(3); });
    it('DECAY = 4',          () => { expect(ProphecyParam.DECAY).toBe(4); });
    it('SUSTAIN = 5',        () => { expect(ProphecyParam.SUSTAIN).toBe(5); });
    it('RELEASE = 6',        () => { expect(ProphecyParam.RELEASE).toBe(6); });
    it('PORTAMENTO = 7',     () => { expect(ProphecyParam.PORTAMENTO).toBe(7); });
    it('FORMANT_SHIFT = 8',  () => { expect(ProphecyParam.FORMANT_SHIFT).toBe(8); });
    it('RESONANCE = 9',      () => { expect(ProphecyParam.RESONANCE).toBe(9); });
});

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT_PROPHECY_PARAMS
// ─────────────────────────────────────────────────────────────────────────────

describe('DEFAULT_PROPHECY_PARAMS', () => {
    it('has all required fields', () => {
        const keys: (keyof ProphecyParams)[] = [
            'waveform', 'vowel', 'volume',
            'attack', 'decay', 'sustain', 'release',
            'portamento', 'formantShift', 'resonance',
        ];
        for (const k of keys) {
            expect(DEFAULT_PROPHECY_PARAMS).toHaveProperty(k);
        }
    });

    it('all values are in [0, 1] range (except waveform 0–3 and vowel 0–4)', () => {
        const { waveform, vowel, ...rest } = DEFAULT_PROPHECY_PARAMS;
        expect(waveform).toBeGreaterThanOrEqual(0);
        expect(waveform).toBeLessThanOrEqual(3);
        expect(vowel).toBeGreaterThanOrEqual(0);
        expect(vowel).toBeLessThanOrEqual(4);
        for (const [k, v] of Object.entries(rest)) {
            expect(v, `DEFAULT_PROPHECY_PARAMS.${k} should be in [0,1]`).toBeGreaterThanOrEqual(0);
            expect(v, `DEFAULT_PROPHECY_PARAMS.${k} should be in [0,1]`).toBeLessThanOrEqual(1);
        }
    });

    it('volume defaults to 0.75', () => {
        expect(DEFAULT_PROPHECY_PARAMS.volume).toBe(0.75);
    });

    it('portamento defaults to 0 (no glide)', () => {
        expect(DEFAULT_PROPHECY_PARAMS.portamento).toBe(0);
    });
});
