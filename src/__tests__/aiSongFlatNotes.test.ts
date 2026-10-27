/**
 * The AI reference song spells notes with flats (Ab1, Bb3, Bb4, Eb3, Eb4).
 * The old parser read every one of them as MIDI 0 (≈ 8.18 Hz). Import the
 * fixture, then play every note it stores through the JS fallback voice and
 * check that the oscillator lands on the frequency `tunedNoteToFrequency`
 * returns — never on an 8 Hz partial.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import full from '../../test-fixtures/ai-song/full.json';
import { convertAISong, type AISongData } from '../importers/ai-song';
import { noteToMidi } from '../utils/musicTheory';
import { tunedNoteToFrequency } from '../constants';
import { Voice } from '../engines/VoiceManager';
import { BackendRegistry, setOscillatorRegistry } from '../engines/backends/BackendRegistry';
import type { SynthParams } from '../types';

const FIXTURE_FLATS = ['Ab1', 'Bb3', 'Bb4', 'Eb3', 'Eb4'];
/** Anything below this is the MIDI-0 bug, not a note. */
const SUBSONIC_HZ = 20;

const PARAMS: SynthParams = {
    waveform: 'sawtooth', pitch: 0, filterCutoff: 2000, filterResonance: 1,
    attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.3, volume: 0.8, length: 1,
    delayTime: 0, delayFeedback: 0, delayMix: 0,
};

/** Every `note` and chord tone stored anywhere in the imported song. */
function storedNoteNames(value: unknown, out = new Set<string>()): Set<string> {
    if (Array.isArray(value)) {
        for (const item of value) storedNoteNames(item, out);
    } else if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if (typeof record.note === 'string') out.add(record.note);
        if (Array.isArray(record.chord)) for (const tone of record.chord) if (typeof tone === 'string') out.add(tone);
        for (const child of Object.values(record)) storedNoteNames(child, out);
    }
    return out;
}

/** Frequency the terminal JS oscillator is given for `note`. */
function fallbackOscillatorHz(note: string): number | null {
    const osc = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), type: 'sawtooth', frequency: { value: 0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() } };
    const param = () => ({ value: 0, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() });
    const createOscillator = vi.fn(() => osc);
    const context = {
        sampleRate: 48000,
        currentTime: 0,
        createOscillator,
        createBiquadFilter: vi.fn(() => ({ connect: vi.fn(), type: 'lowpass', frequency: param(), Q: param() })),
        createGain: vi.fn(() => ({ connect: vi.fn(), gain: param() })),
        createDelay: vi.fn(() => ({ connect: vi.fn(), delayTime: param() })),
        createStereoPanner: vi.fn(() => ({ connect: vi.fn(), pan: param() })),
    } as unknown as AudioContext;
    new Voice(context, { connect: vi.fn() } as unknown as AudioNode).startNote(PARAMS, note, 0);
    return createOscillator.mock.calls.length > 0 ? osc.frequency.value : null;
}

afterEach(() => {
    setOscillatorRegistry(null);
});

describe('AI song flats play at their pitch (#1466)', () => {
    const result = convertAISong(full as unknown as AISongData);
    if (!result.success) throw new Error(`fixture failed to import: ${JSON.stringify(result.error)}`);
    const names = [...storedNoteNames(result.song)];

    it('stores the flat spellings the issue names', () => {
        for (const flat of FIXTURE_FLATS) expect(names).toContain(flat);
    });

    it.each(names)('%s parses to a real MIDI note', (name) => {
        const midi = noteToMidi(name);
        expect(midi).not.toBeNull();
        expect(tunedNoteToFrequency(name)!).toBeGreaterThan(SUBSONIC_HZ);
    });

    it.each(names)('%s drives the JS fallback voice at tunedNoteToFrequency', (name) => {
        // An empty registry: the voice ends at the terminal OscillatorNode.
        setOscillatorRegistry(new BackendRegistry());
        const hz = fallbackOscillatorHz(name);
        expect(hz).not.toBeNull();
        expect(hz!).toBeGreaterThan(SUBSONIC_HZ);
        expect(hz!).toBeCloseTo(tunedNoteToFrequency(name)!, 6);
    });

    it('starts no voice for a name that does not parse', () => {
        setOscillatorRegistry(new BackendRegistry());
        expect(fallbackOscillatorHz('nope')).toBeNull();
    });
});
