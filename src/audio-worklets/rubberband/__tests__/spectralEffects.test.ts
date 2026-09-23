import { describe, expect, it } from 'vitest';
import { SpectralBandProcessor, type BandSplitParams } from '../spectralEffects';
import { TsVocalFx, createVocalFxBlock } from '../vocalFx';

const SAMPLE_RATE = 48000;
const QUANTUM = 128;
const CENTRE = [Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2];

/** 1 s golden fixture: 220 Hz, 8 harmonics, loud enough to sit over the 0.1 threshold. */
function vowelFixture(): Float32Array {
  return new Float32Array(SAMPLE_RATE).map((_, i) => {
    let v = 0;
    for (let k = 1; k <= 8; k++) v += Math.sin((2 * Math.PI * 220 * k * i) / SAMPLE_RATE) / k;
    return 0.5 * v;
  });
}

/** Runs the fixture through `passes` split+compress calls per 128-frame block (L only). */
function render(signal: Float32Array, passes: number, comp = 1): Float32Array {
  const spectral = new SpectralBandProcessor();
  const out = new Float32Array(signal.length);
  const l = new Float32Array(QUANTUM);
  const r = new Float32Array(QUANTUM);
  const p: BandSplitParams = {
    outL: l, outR: r, hasStereo: true, spectralComp: comp,
    grainPanSpread: 0, grainPanL: CENTRE, grainPanR: CENTRE, sampleRate: SAMPLE_RATE,
  };
  for (let i = 0; i + QUANTUM <= signal.length; i += QUANTUM) {
    l.set(signal.subarray(i, i + QUANTUM));
    for (let n = 0; n < passes; n++) spectral.applyBandSplitAndCompression(p);
    out.set(l, i);
  }
  return out;
}

/** RMS of the settled second half, dB. */
const tailRmsDb = (x: Float32Array) => {
  const tail = x.subarray(x.length / 2);
  return 10 * Math.log10(tail.reduce((acc, v) => acc + v * v, 0) / tail.length);
};

describe('spectral path: one crossover, one compressor (#1273)', () => {
  const fixture = vowelFixture();

  it('the 1 s fixture loses a single stage of gain reduction, not two', () => {
    const dry = tailRmsDb(render(fixture, 1, 1e-9));
    const once = dry - tailRmsDb(render(fixture, 1));
    const twice = dry - tailRmsDb(render(fixture, 2));

    // Golden (measured): one stage at comp 1 (4:1, capped at 12 dB per band)
    // takes ~12.7 dB off this vowel; the pre-#1228 double pass took ~16.4 dB.
    // That ~3.6 dB is the loudness change the fix is allowed, and the signal
    // this test watches for a second stage coming back.
    expect(once).toBeGreaterThan(11.5);
    expect(once).toBeLessThan(13.5);
    expect(twice - once).toBeGreaterThan(2);
  });

  it('TsVocalFx runs the spectral stage once per block', () => {
    const fx = new TsVocalFx(SAMPLE_RATE);
    const block = Object.assign(createVocalFxBlock(), { spectralComp: 1 });
    const chainOut = new Float32Array(fixture.length);
    const l = new Float32Array(QUANTUM);
    const r = new Float32Array(QUANTUM);
    for (let i = 0; i + QUANTUM <= fixture.length; i += QUANTUM) {
      l.set(fixture.subarray(i, i + QUANTUM));
      fx.process(block, l, r);
      chainOut.set(l, i);
    }
    expect(chainOut).toEqual(render(fixture, 1));
  });

  it('exposes no second compressor stage to call', () => {
    const methods = Object.getOwnPropertyNames(SpectralBandProcessor.prototype)
      .filter((name) => name !== 'constructor' && !name.startsWith('compress'));
    expect(methods).toEqual(['applyBandSplitAndCompression']);
  });
});
