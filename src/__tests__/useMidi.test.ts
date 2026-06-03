import { describe, it, expect } from 'vitest';
import { parseMidiMessage } from '../hooks/useMidi';

// parseMidiMessage is pure — no mocks needed.

describe('parseMidiMessage', () => {
    // ── Basic validity ──────────────────────────────────────────────────────

    it('returns null for null/empty data', () => {
        expect(parseMidiMessage(new Uint8Array(0))).toBeNull();
        expect(parseMidiMessage(new Uint8Array(1))).toBeNull(); // need at least 2 bytes
    });

    // ── Note On ─────────────────────────────────────────────────────────────

    it('parses a note-on message', () => {
        // 0x90 = note-on ch0, note=60 (C4), vel=100
        const msg = parseMidiMessage(new Uint8Array([0x90, 60, 100]));
        expect(msg?.type).toBe('noteOn');
        expect(msg?.channel).toBe(0);
        expect(msg?.note).toBe(60);
        expect(msg?.velocity).toBe(100);
    });

    it('parses note-on on channel 9 (drums)', () => {
        // 0x99 = note-on channel 9
        const msg = parseMidiMessage(new Uint8Array([0x99, 36, 127]));
        expect(msg?.type).toBe('noteOn');
        expect(msg?.channel).toBe(9);
    });

    it('treats note-on with velocity 0 as note-off (MIDI spec)', () => {
        const msg = parseMidiMessage(new Uint8Array([0x91, 48, 0]));
        expect(msg?.type).toBe('noteOff');
        expect(msg?.channel).toBe(1);
        expect(msg?.note).toBe(48);
        expect(msg?.velocity).toBe(0);
    });

    // ── Note Off ────────────────────────────────────────────────────────────

    it('parses a note-off message', () => {
        // 0x80 = note-off ch0
        const msg = parseMidiMessage(new Uint8Array([0x80, 60, 64]));
        expect(msg?.type).toBe('noteOff');
        expect(msg?.channel).toBe(0);
        expect(msg?.note).toBe(60);
        expect(msg?.velocity).toBe(64);
    });

    it('parses note-off on all 16 channels', () => {
        for (let ch = 0; ch < 16; ch++) {
            const msg = parseMidiMessage(new Uint8Array([0x80 | ch, 48, 0]));
            expect(msg?.type).toBe('noteOff');
            expect(msg?.channel).toBe(ch);
        }
    });

    // ── Control Change ──────────────────────────────────────────────────────

    it('parses a CC message', () => {
        // 0xB0 ch0, CC#74 (filter cutoff), value 100
        const msg = parseMidiMessage(new Uint8Array([0xB0, 74, 100]));
        expect(msg?.type).toBe('cc');
        expect(msg?.channel).toBe(0);
        expect(msg?.cc).toBe(74);
        expect(msg?.value).toBe(100);
    });

    it('parses all-notes-off CC (CC#123)', () => {
        const msg = parseMidiMessage(new Uint8Array([0xB0, 123, 0]));
        expect(msg?.type).toBe('cc');
        expect(msg?.cc).toBe(123);
    });

    // ── Program Change ──────────────────────────────────────────────────────

    it('parses a program change', () => {
        // 0xC2 = program-change ch2, program 7
        const msg = parseMidiMessage(new Uint8Array([0xC2, 7]));
        expect(msg?.type).toBe('programChange');
        expect(msg?.channel).toBe(2);
        expect(msg?.value).toBe(7);
    });

    // ── Pitch Bend ──────────────────────────────────────────────────────────

    it('parses pitch bend centre position (no bend)', () => {
        // Pitch bend centre = LSB 0x00, MSB 0x40 → raw = 8192 → signed = 0
        const msg = parseMidiMessage(new Uint8Array([0xE0, 0x00, 0x40]));
        expect(msg?.type).toBe('pitchBend');
        expect(msg?.pitchBendValue).toBe(0);
    });

    it('parses full pitch-bend up (+8191)', () => {
        // Max up: LSB=0x7F, MSB=0x7F → raw=16383 → 16383-8192=8191
        const msg = parseMidiMessage(new Uint8Array([0xE0, 0x7F, 0x7F]));
        expect(msg?.pitchBendValue).toBe(8191);
    });

    it('parses full pitch-bend down (-8192)', () => {
        // Max down: LSB=0x00, MSB=0x00 → raw=0 → 0-8192=-8192
        const msg = parseMidiMessage(new Uint8Array([0xE0, 0x00, 0x00]));
        expect(msg?.pitchBendValue).toBe(-8192);
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
        // Only status + note, no velocity byte — should not throw
        const msg = parseMidiMessage(new Uint8Array([0x90, 60]));
        expect(msg?.type).toBe('noteOff'); // vel defaults to 0 → treated as note-off
        expect(msg?.velocity).toBe(0);
    });

    // ── Velocity-to-note-off edge cases ─────────────────────────────────────

    it('keeps velocity for genuine note-off even if velocity is 127', () => {
        const msg = parseMidiMessage(new Uint8Array([0x80, 60, 127]));
        expect(msg?.type).toBe('noteOff');
        expect(msg?.velocity).toBe(127);
    });
});
