import { describe, expect, it } from 'vitest';
import Harmonizer from '../Harmonizer';
import type { SamplerBankParams } from '../../types';

// Formant preservation for pitched harmony voices lives in Rubber Band
// (OptionFormantPreserved, see stretchProfiles.ts). The harmonizer must only
// add its width spread; a -pitchOffset term here would double-compensate (#1297).
function configsFor(harmonyType: 'octave' | 'fifth' | 'unison', formantShift?: number, formantSpread = 0) {
  const h = new Harmonizer({
    voiceCount: 3,
    harmonyType,
    detuneSpread: 0,
    formantSpread,
  });
  h.setActive(true);
  const base = { playbackSpeed: 1, volume: 1, formantShift } as SamplerBankParams;
  return h.generateSamplerConfigs(base);
}

describe('Harmonizer.generateSamplerConfigs formant handling', () => {
  it('does not compensate formants for the pitch offset', () => {
    const [base, up, down] = configsFor('octave');
    expect(base.formantShift).toBe(0);
    expect(up.playbackSpeed).toBeCloseTo(2);
    expect(up.formantShift).toBe(0);
    expect(down.playbackSpeed).toBeCloseTo(0.5);
    expect(down.formantShift).toBe(0);
  });

  it('passes the user shift through unchanged on every voice', () => {
    for (const c of configsFor('fifth', 2)) expect(c.formantShift).toBe(2);
  });

  it('applies only the width spread to harmony voices', () => {
    const [base, first, second] = configsFor('octave', 1, 4);
    expect(base.formantShift).toBe(1);
    expect(first.formantShift).toBe(1 - 2);
    expect(second.formantShift).toBe(1 + 2);
  });
});
