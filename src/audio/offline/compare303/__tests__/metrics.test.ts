import { describe, expect, it } from 'vitest';
import {
  analyzeSignal,
  bestLag,
  comparePair,
  fft,
  nullTest,
  spectralDistanceDb,
} from '../metrics';

const SR = 44_100;

function sine(hz: number, seconds: number, amp = 0.5): Float32Array {
  const out = new Float32Array(Math.round(seconds * SR));
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
}

/** A tone gated on for `on` s of every `period` s: a voice that closes between notes. */
function gated(hz: number, seconds: number, period = 0.25, on = 0.1): Float32Array {
  const s = sine(hz, seconds);
  for (let i = 0; i < s.length; i++) if ((i / SR) % period >= on) s[i] = 0;
  return s;
}

describe('fft', () => {
  it('puts a bin-centred sine in exactly that bin', () => {
    const n = 1024;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 64 * i) / n);
    fft(re, im);
    const mags = Array.from(re, (r, k) => Math.hypot(r, im[k]));
    expect(mags.indexOf(Math.max(...mags.slice(0, n / 2)))).toBe(64);
    expect(mags[64]).toBeCloseTo(n / 2, 6);
  });
});

describe('nullTest', () => {
  it('nulls an identical signal', () => {
    const a = sine(220, 1);
    const r = nullTest(a, a, 100, SR);
    expect(r.lagSamples).toBe(0);
    expect(r.corr).toBeCloseTo(1, 9);
    expect(r.nullDb).toBeLessThan(-90);
  });

  it('finds the lag and gain of a delayed, scaled copy and still nulls it', () => {
    const a = sine(330, 1);
    const delayed = new Float32Array(a.length);
    for (let i = 40; i < a.length; i++) delayed[i] = 0.25 * a[i - 40]; // delayed 40 samples, -12 dB
    expect(bestLag(a, delayed, 100, SR)).toBe(40); // a[n] ~ g * delayed[n + 40]
    const r = nullTest(a, delayed, 100, SR);
    expect(r.gain).toBeCloseTo(4, 2);
    expect(r.nullDb).toBeLessThan(-40);
  });

  it('does not null unrelated tones', () => {
    const r = nullTest(sine(220, 1), sine(317, 1), 100, SR);
    expect(r.nullDb).toBeGreaterThan(-1);
    expect(Math.abs(r.corr)).toBeLessThan(0.1);
  });
});

describe('comparePair', () => {
  it('reports the level offset and zero spectral distance for a scaled copy', () => {
    const a = gated(220, 2);
    const b = a.map((v) => v * 0.1);
    const m = comparePair(a, analyzeSignal(a, SR), b, analyzeSignal(b, SR));
    expect(m.levelDb).toBeCloseTo(-20, 1);
    // float32 rounding in the near-empty bands of a gated tone is the only difference
    expect(m.lsdDb).toBeLessThan(0.5);
    expect(m.avgSpectrumLsdDb).toBeLessThan(0.5);
    expect(m.envCorr).toBeGreaterThan(0.999);
    expect(m.nullDb).toBeLessThan(-60);
  });

  it('measures a brighter tone as a positive centroid shift and a spectral difference', () => {
    const lo = sine(220, 2);
    const hi = sine(2200, 2);
    const m = comparePair(lo, analyzeSignal(lo, SR), hi, analyzeSignal(hi, SR));
    expect(m.centroidDeltaHz).toBeGreaterThan(1500);
    expect(m.lsdDb).toBeGreaterThan(20);
    expect(m.bandDiffDb).toHaveLength(23);
  });

  it('separates a gated voice from a drone by gate range and envelope correlation', () => {
    const drone = sine(220, 3);
    const notes = gated(220, 3);
    const aDrone = analyzeSignal(drone, SR);
    const aNotes = analyzeSignal(notes, SR);
    expect(aNotes.envRangeDb).toBeGreaterThan(aDrone.envRangeDb + 40);
    const m = comparePair(notes, aNotes, drone, aDrone);
    expect(m.envCorr).toBeLessThan(0.2);
  });

  it('marks near-silence so callers can skip it', () => {
    const quiet = sine(220, 1, 1e-6);
    expect(analyzeSignal(quiet, SR).silent).toBe(true);
    expect(analyzeSignal(sine(220, 1), SR).silent).toBe(false);
  });
});

describe('spectralDistanceDb', () => {
  it('is symmetric in magnitude for level-matched tones and 0 for the same signal', () => {
    const a = analyzeSignal(sine(220, 1), SR);
    const b = analyzeSignal(sine(880, 1), SR);
    expect(spectralDistanceDb(a, a)).toBeLessThan(1e-9);
    expect(spectralDistanceDb(a, b)).toBeGreaterThan(20);
    expect(Math.abs(spectralDistanceDb(a, b) - spectralDistanceDb(b, a))).toBeLessThan(2);
  });
});
