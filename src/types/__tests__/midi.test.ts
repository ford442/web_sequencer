import { describe, it, expect } from 'vitest';
import { midiValueToNormalized, midiKeyToString, formatMidiBindingLabel } from '../midi';

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
});
