import { describe, expect, it } from 'vitest';
import { DrumDuckEnvelope } from '../drumDuckEnvelope';
import { SingingVoiceManager } from '../../../engines/SingingVoiceManager';

const SR = 48000;
const BLOCK = 128;
const DT = BLOCK / SR;

describe('DrumDuckEnvelope on the trigger ring', () => {
  it('ducks on every hit of a dense pattern written ahead, with each hit\'s snare flag', () => {
    const manager = new SingingVoiceManager(new AudioContext(), 1);
    const duck = new DrumDuckEnvelope();
    const sab = manager.getDrumSidechainSAB();
    // Kick, snare, kick, snare 16ths at 170 BPM: all four posted before the first sounds.
    const hits = [0, 1, 2, 3].map((i) => ({ t: 1 + i * (60 / 170 / 4), snare: i % 2 === 1 }));
    for (const h of hits) manager.pushDrumTrigger(h.t, 1, 0.02, h.snare);

    const peaks: number[] = [];
    let prev = 0;
    for (let t = 0.99; t < 1.5; t += DT) {
      const { duckingScalar, isSnare } = duck.process(sab, 1, t, BLOCK, SR);
      if (duckingScalar > 0.9 && prev <= 0.9) peaks.push(isSnare);
      prev = duckingScalar;
    }
    expect(peaks).toEqual([0, 1, 0, 1]);
  });

  it('drains hits at depth 0, so raising the depth later does not replay them', () => {
    const manager = new SingingVoiceManager(new AudioContext(), 1);
    const duck = new DrumDuckEnvelope();
    const sab = manager.getDrumSidechainSAB();
    manager.pushDrumTrigger(1, 1, 0.01, false);
    for (let t = 1; t < 2; t += DT) duck.process(sab, 0, t, BLOCK, SR);
    expect(duck.process(sab, 1, 2, BLOCK, SR).duckingScalar).toBeLessThan(1e-6);
  });
});
