import { describe, expect, it } from 'vitest';
import { SESSION_PACKS, getSessionPack, mergePackStorage } from '../packs';
import { createEmptyTrackStorage } from '../../utils/trackStorageUtils';
import { TRACK_KEYS } from '../../constants';

describe('session starter packs', () => {
  it('ships the curated live sets', () => {
    expect(SESSION_PACKS.map((p) => p.id).sort()).toEqual([
      'acid-live-set',
      'dual-303-jam',
      'macro-palette',
      'minimal-drum-lab',
      'vocal-chop-performance',
    ].sort());
  });

  it('fills at least one clip per pack and merges without wiping empty slots', () => {
    for (const pack of SESSION_PACKS) {
      const filled = TRACK_KEYS.some((t) => pack.session.columns[t].clips.some((c) => !c.empty));
      expect(filled).toBe(true);
      const base = createEmptyTrackStorage();
      const merged = mergePackStorage(base, pack.trackStorage);
      expect(merged.kick.length).toBe(base.kick.length);
    }
    expect(getSessionPack('acid-live-set')?.name).toBe('Acid Live Set');
  });

  it('Macro Palette sets both synth parts to macro patches and writes chords', () => {
    const pack = getSessionPack('macro-palette');
    expect(pack?.instruments?.synthA?.waveform).toMatch(/^macro-/);
    expect(pack?.instruments?.synthB?.waveform).toMatch(/^macro-/);
    expect(pack?.instruments?.synthB?.macro?.polyphony).toBe(1);
    const padClip = pack?.trackStorage.partA[0] as { steps: Array<{ chord?: string[] } | null> } | null;
    expect(padClip?.steps.some((s) => (s?.chord?.length ?? 0) >= 3)).toBe(true);
  });
});
