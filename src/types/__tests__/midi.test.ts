import { describe, it, expect } from 'vitest';
import { midiValueToNormalized, midiKeyToString, formatMidiBindingLabel, isMidiBinding } from '../midi';

describe('midi types', () => {
  it('normalizes MIDI values to 0–1', () => {
    expect(midiValueToNormalized(0)).toBe(0);
    expect(midiValueToNormalized(127)).toBe(1);
    expect(midiValueToNormalized(64)).toBeCloseTo(64 / 127);
  });

  it('formats binding labels', () => {
    expect(formatMidiBindingLabel({ type: 'cc', channel: 0, number: 6 })).toContain('CC7');
    expect(midiKeyToString({ type: 'note', channel: 2, number: 60 })).toBe('note:2:60');
  });

  it('accepts only well-formed bindings from untrusted storage', () => {
    const key = { type: 'cc', channel: 0, number: 7 };
    expect(isMidiBinding({ key, controlId: 'synthA:filterCutoff' })).toBe(true);
    expect(isMidiBinding({ key, controlId: 'synthA:filterCutoff', deviceId: 'dev-1' })).toBe(true);
    expect(isMidiBinding(null)).toBe(false);
    expect(isMidiBinding({ controlId: 'synthA:filterCutoff' })).toBe(false);
    expect(isMidiBinding({ key: { ...key, type: 'sysex' }, controlId: 'synthA:filterCutoff' })).toBe(false);
    expect(isMidiBinding({ key, controlId: 'noColon' })).toBe(false);
    expect(isMidiBinding({ key, controlId: 'synthA:filterCutoff', deviceId: 3 })).toBe(false);
  });
});
