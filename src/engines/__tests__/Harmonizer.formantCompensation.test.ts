import { describe, expect, it } from 'vitest';
import Harmonizer from '../Harmonizer';
import type { SamplerBankParams } from '../../types';

function configsFor(harmonyType: 'octave' | 'fifth' | 'unison', formantShift?: number) {
  const h = new Harmonizer({
    voiceCount: 3,
    harmonyType,
    detuneSpread: 0,
    formantSpread: 0, // isolate the compensation from the spread
  });
  h.setActive(true);
  const base = { playbackSpeed: 1, volume: 1, formantShift } as SamplerBankParams;
  return h.generateSamplerConfigs(base);
}

describe('Harmonizer.generateSamplerConfigs formant compensation', () => {
  it('counters the playbackRate formant scaling with -pitchOffset semitones', () => {
    const [base, up, down] = configsFor('octave');
    expect(base.formantShift).toBe(0);
    expect(up.playbackSpeed).toBeCloseTo(2);
    expect(up.formantShift).toBe(-12); // +12 st pitch -> formants pulled back down
    expect(down.playbackSpeed).toBeCloseTo(0.5);
    expect(down.formantShift).toBe(12);
  });

  it('keeps the compensation proportional to the interval and adds to the user shift', () => {
    const [, fifthUp, fifthDown] = configsFor('fifth', 2);
    expect(fifthUp.formantShift).toBe(2 - 7);
    expect(fifthDown.formantShift).toBe(2 + 7);
  });

  it('leaves unison voices uncompensated', () => {
    const cfgs = configsFor('unison', 3);
    for (const c of cfgs) expect(c.formantShift).toBe(3);
  });
});
