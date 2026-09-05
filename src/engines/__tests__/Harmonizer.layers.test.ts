import { describe, expect, it } from 'vitest';
import Harmonizer, { HARMONIZE_PRESETS, layersIntervalsForChord } from '../Harmonizer';

describe('HARMONIZE_PRESETS.layers', () => {
  it('emits base plus 3rd, 5th, and octave', () => {
    const cfg = HARMONIZE_PRESETS.layers();
    const h = new Harmonizer(cfg);
    h.setActive(true);
    const voices = h.generateVoices();
    expect(voices).toHaveLength(4);
    expect(voices.map((v) => v.pitchOffset)).toEqual([0, 4, 7, 12]);
  });

  it('maps chord types to three harmony intervals', () => {
    expect(layersIntervalsForChord('major')).toEqual([4, 7, 12]);
    expect(layersIntervalsForChord('minor')).toEqual([3, 7, 12]);
  });
});
