import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RUBBERBAND_OPTIONS, getStretchProfileOptions, type StretchProfile } from '../stretchProfiles';

const PROFILES: StretchProfile[] = ['vocal', 'harmonic', 'fast'];
const has = (mask: number, flag: number) => (mask & flag) === flag;

describe('getStretchProfileOptions', () => {
  it('vocal preserves formants (#1297)', () => {
    expect(has(getStretchProfileOptions('vocal'), RUBBERBAND_OPTIONS.OptionFormantPreserved)).toBe(true);
  });

  it('stays on the R2 engine for every profile', () => {
    for (const p of PROFILES) {
      expect(has(getStretchProfileOptions(p), RUBBERBAND_OPTIONS.OptionEngineFiner)).toBe(false);
    }
  });

  it('never sets the bogus 0x20 "Finer" bit', () => {
    for (const p of PROFILES) expect(getStretchProfileOptions(p) & 0x20).toBe(0);
  });

  it('falls back to vocal for unknown profiles', () => {
    expect(getStretchProfileOptions('nope' as StretchProfile)).toBe(getStretchProfileOptions('vocal'));
  });
});

describe('Rubber Band worklets', () => {
  const worklets = ['rubberband-processor.ts', 'sustain-processor.ts'];

  it.each(worklets)('%s takes its options from getStretchProfileOptions', (file) => {
    const src = readFileSync(resolve(__dirname, '../../../audio-worklets', file), 'utf8');
    expect(src).toContain('getStretchProfileOptions(');
    // `1048576` is OptionWindowShort, not OptionFormantPreserved.
    expect(src).not.toMatch(/\b1048576\b/);
  });
});
