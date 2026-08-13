import { describe, it, expect } from 'vitest';
import { isMidiSystemRealtime, parseMidiRealtime, sppToStep } from '../midiRealtime';

describe('midiRealtime', () => {
  it('detects system realtime bytes', () => {
    expect(isMidiSystemRealtime(0xf8)).toBe(true);
    expect(isMidiSystemRealtime(0xfa)).toBe(true);
    expect(isMidiSystemRealtime(0x90)).toBe(false);
  });

  it('parses clock/start/stop/continue', () => {
    expect(parseMidiRealtime(new Uint8Array([0xf8]))).toEqual({ type: 'clock' });
    expect(parseMidiRealtime(new Uint8Array([0xfa]))).toEqual({ type: 'start' });
    expect(parseMidiRealtime(new Uint8Array([0xfb]))).toEqual({ type: 'continue' });
    expect(parseMidiRealtime(new Uint8Array([0xfc]))).toEqual({ type: 'stop' });
  });

  it('parses song position pointer as 16th notes', () => {
    // 4 beats = 16 sixteenth notes
    expect(parseMidiRealtime(new Uint8Array([0xf2, 4, 0]))).toEqual({
      type: 'songPosition',
      sixteenthNotes: 16,
    });
  });

  it('maps SPP to step index', () => {
    expect(sppToStep(16, 32)).toBe(16);
    expect(sppToStep(33, 32)).toBe(1);
  });
});
