import { describe, it, expect } from 'vitest';
import { parseMidiMessage, type ParsedMidiMessage } from '../utils/midiMessageParse';

// parseMidiMessage is pure — no mocks needed.

function assertNoteOn(msg: ParsedMidiMessage | null) {
    expect(msg?.type).toBe('noteOn');
    if (msg?.type !== 'noteOn') throw new Error('expected noteOn');
    return msg;
}

function assertNoteOff(msg: ParsedMidiMessage | null) {
    expect(msg?.type).toBe('noteOff');
    if (msg?.type !== 'noteOff') throw new Error('expected noteOff');
    return msg;
}

function assertCc(msg: ParsedMidiMessage | null) {
    expect(msg?.type).toBe('cc');
    if (msg?.type !== 'cc') throw new Error('expected cc');
    return msg;
}

describe('parseMidiMessage', () => {
    // ── Basic validity ──────────────────────────────────────────────────────

    it('returns null for null/empty data', () => {
        expect(parseMidiMessage(new Uint8Array(0))).toBeNull();
        expect(parseMidiMessage(new Uint8Array(1))).toBeNull(); // need at least 2 bytes
    });

    // ── Note On ─────────────────────────────────────────────────────────────

    it('parses a note-on message', () => {
        const msg = assertNoteOn(parseMidiMessage(new Uint8Array([0x90, 60, 100])));
        expect(msg.channel).toBe(0);
        expect(msg.note).toBe(60);
        expect(msg.velocity).toBe(100);
    });

    it('parses note-on on channel 9 (drums)', () => {
        const msg = assertNoteOn(parseMidiMessage(new Uint8Array([0x99, 36, 127])));
        expect(msg.channel).toBe(9);
    });

    it('treats note-on with velocity 0 as note-off (MIDI spec)', () => {
        const msg = assertNoteOff(parseMidiMessage(new Uint8Array([0x91, 48, 0])));
        expect(msg.channel).toBe(1);
        expect(msg.note).toBe(48);
        expect(msg.velocity).toBe(0);
    });

    // ── Note Off ────────────────────────────────────────────────────────────

    it('parses a note-off message', () => {
        const msg = assertNoteOff(parseMidiMessage(new Uint8Array([0x80, 60, 64])));
        expect(msg.channel).toBe(0);
        expect(msg.note).toBe(60);
        expect(msg.velocity).toBe(64);
    });

    it('parses note-off on all 16 channels', () => {
        for (let ch = 0; ch < 16; ch++) {
            const msg = assertNoteOff(parseMidiMessage(new Uint8Array([0x80 | ch, 48, 0])));
            expect(msg.channel).toBe(ch);
        }
    });

    // ── Control Change ──────────────────────────────────────────────────────

    it('parses a CC message', () => {
        const msg = assertCc(parseMidiMessage(new Uint8Array([0xB0, 74, 100])));
        expect(msg.channel).toBe(0);
        expect(msg.cc).toBe(74);
        expect(msg.value).toBe(100);
    });

    it('parses all-notes-off CC (CC#123)', () => {
        const msg = assertCc(parseMidiMessage(new Uint8Array([0xB0, 123, 0])));
        expect(msg.cc).toBe(123);
    });

    it('parses a program change', () => {
        const msg = parseMidiMessage(new Uint8Array([0xC2, 7]));
        expect(msg?.type).toBe('programChange');
        if (msg?.type === 'programChange') {
            expect(msg.channel).toBe(2);
            expect(msg.value).toBe(7);
        }
    });

    it('parses pitch bend centre position (no bend)', () => {
        const msg = parseMidiMessage(new Uint8Array([0xE0, 0x00, 0x40]));
        expect(msg?.type).toBe('pitchBend');
        if (msg?.type === 'pitchBend') {
            expect(msg.pitchBendValue).toBe(0);
        }
    });

    it('parses full pitch-bend up (+8191)', () => {
        const msg = parseMidiMessage(new Uint8Array([0xE0, 0x7F, 0x7F]));
        if (msg?.type === 'pitchBend') {
            expect(msg.pitchBendValue).toBe(8191);
        }
    });

    it('parses full pitch-bend down (-8192)', () => {
        const msg = parseMidiMessage(new Uint8Array([0xE0, 0x00, 0x00]));
        if (msg?.type === 'pitchBend') {
            expect(msg.pitchBendValue).toBe(-8192);
        }
    });

    // ── Unsupported / unknown ───────────────────────────────────────────────

    it('returns null for sysex messages (0xF0)', () => {
        expect(parseMidiMessage(new Uint8Array([0xF0, 0x41, 0x10]))).toBeNull();
    });

    it('returns null for MIDI clock (0xF8)', () => {
        expect(parseMidiMessage(new Uint8Array([0xF8]))).toBeNull();
    });

    it('returns null for active sensing (0xFE)', () => {
        expect(parseMidiMessage(new Uint8Array([0xFE]))).toBeNull();
    });

    it('handles missing velocity byte (2-byte message)', () => {
        const msg = assertNoteOff(parseMidiMessage(new Uint8Array([0x90, 60])));
        expect(msg.velocity).toBe(0);
    });

    it('keeps velocity for genuine note-off even if velocity is 127', () => {
        const msg = assertNoteOff(parseMidiMessage(new Uint8Array([0x80, 60, 127])));
        expect(msg.velocity).toBe(127);
    });
});
