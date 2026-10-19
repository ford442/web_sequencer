import { describe, expect, it } from 'vitest';
import {
  CONSONANT_DELAY_SECONDS,
  PhonemeDelay,
  VOWEL_DELAY_SECONDS,
  type PhonemeDelayContext,
} from '../phonemeDelay';

const SR = 48000;
const BLOCK = 128;
const vowel: PhonemeDelayContext = { hasPhonemeContext: true, isVowel: 1, phonemeIndex: 0 };
const consonant: PhonemeDelayContext = { hasPhonemeContext: true, isVowel: 0, phonemeIndex: 1 };

/** Runs `blocks` blocks of an impulse (first sample of block 0) and returns both channels. */
function render(
  delay: PhonemeDelay,
  blocks: number,
  amount: number,
  feedback: number,
  ctxAt: (block: number) => PhonemeDelayContext,
  input: (block: number, i: number) => number = (b, i) => (b === 0 && i === 0 ? 1 : 0),
): [Float32Array, Float32Array] {
  const outL = new Float32Array(blocks * BLOCK);
  const outR = new Float32Array(blocks * BLOCK);
  for (let b = 0; b < blocks; b++) {
    const l = new Float32Array(BLOCK);
    const r = new Float32Array(BLOCK);
    for (let i = 0; i < BLOCK; i++) l[i] = r[i] = input(b, i);
    delay.process(l, r, amount, feedback, ctxAt(b));
    outL.set(l, b * BLOCK);
    outR.set(r, b * BLOCK);
  }
  return [outL, outR];
}

/** Index of the largest |x| at or after `from`. */
function peakIndex(x: Float32Array, from = 1): number {
  let best = from;
  for (let i = from; i < x.length; i++) if (Math.abs(x[i]) > Math.abs(x[best])) best = i;
  return best;
}

function rms(x: Float32Array, from: number, to: number): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
}

describe('PhonemeDelay', () => {
  it('is a bit-exact bypass at amount 0', () => {
    const delay = new PhonemeDelay(SR);
    const l = Float32Array.from({ length: BLOCK }, (_, i) => Math.sin(i * 0.1) * 0.7);
    const r = Float32Array.from({ length: BLOCK }, (_, i) => Math.cos(i * 0.13) * 0.5);
    const l0 = l.slice();
    const r0 = r.slice();
    delay.process(l, r, 0, 0.9, vowel);
    expect(l).toEqual(l0);
    expect(r).toEqual(r0);
    expect(delay.isActive).toBe(false);
  });

  it('ramps out over one block when switched off, then bypasses bit-exact', () => {
    const delay = new PhonemeDelay(SR);
    render(delay, 4, 0.8, 0.5, () => vowel);
    expect(delay.isActive).toBe(true);
    const l = new Float32Array(BLOCK).fill(0.25);
    delay.process(l, null, 0, 0.5, vowel);
    expect(delay.isActive).toBe(false);
    const l2 = new Float32Array(BLOCK).fill(0.25);
    delay.process(l2, null, 0, 0.5, vowel);
    expect(Array.from(l2)).toEqual(new Array<number>(BLOCK).fill(0.25));
  });

  it('places the first echo at the vowel tap, and a consonant at the short slap', () => {
    const v = render(new PhonemeDelay(SR), 100, 1, 0, () => vowel)[0];
    expect(peakIndex(v)).toBeCloseTo(VOWEL_DELAY_SECONDS[0] * SR, -1);

    const c = render(new PhonemeDelay(SR), 40, 1, 0, () => consonant)[0];
    expect(peakIndex(c)).toBeCloseTo(CONSONANT_DELAY_SECONDS[0] * SR, -1);
  });

  it('a phoneme change glides the tap to the new target', () => {
    const delay = new PhonemeDelay(SR);
    render(delay, 4, 1, 0, () => consonant);
    expect(delay.tapSamples(0)).toBeCloseTo(CONSONANT_DELAY_SECONDS[0] * SR, 3);
    // One block after the change the head has moved, but not jumped.
    render(delay, 1, 1, 0, () => vowel);
    const moved = delay.tapSamples(0);
    expect(moved).toBeGreaterThan(CONSONANT_DELAY_SECONDS[0] * SR);
    expect(moved).toBeLessThan(VOWEL_DELAY_SECONDS[0] * SR);
    render(delay, 200, 1, 0, () => vowel);
    expect(delay.tapSamples(0)).toBeCloseTo(VOWEL_DELAY_SECONDS[0] * SR, 1);
  });

  it('throws consonant slaps to alternating sides; vowels stay centred', () => {
    const odd = render(new PhonemeDelay(SR), 40, 1, 0, () => consonant);
    const even = render(new PhonemeDelay(SR), 40, 1, 0, () => ({ ...consonant, phonemeIndex: 2 }));
    const tap = Math.round(CONSONANT_DELAY_SECONDS[0] * SR);
    const tapR = Math.round(CONSONANT_DELAY_SECONDS[1] * SR);
    expect(Math.abs(odd[0][tap])).toBeLessThan(Math.abs(even[0][tap]));
    expect(Math.abs(odd[1][tapR])).toBeGreaterThan(Math.abs(even[1][tapR]));

    const [vl, vr] = render(new PhonemeDelay(SR), 100, 1, 0, () => vowel);
    expect(Math.abs(vl[peakIndex(vl)])).toBeCloseTo(Math.abs(vr[peakIndex(vr)]), 2);
  });

  it('feedback decays, even with the knob at 1', () => {
    const [l] = render(new PhonemeDelay(SR), 1200, 1, 1, () => vowel);
    const tap = VOWEL_DELAY_SECONDS[0] * SR;
    const windows = [1, 3, 6, 12].map((k) => rms(l, Math.floor(k * tap), Math.floor((k + 1) * tap)));
    for (let i = 1; i < windows.length; i++) expect(windows[i]).toBeLessThan(windows[i - 1]);
    expect(windows[windows.length - 1]).toBeLessThan(windows[0] * 0.5);
  });

  it('produces no NaN and no denormals, and a NaN input does not poison the line', () => {
    const delay = new PhonemeDelay(SR);
    // NaN in block 1, impulse in block 0, then a long silent ring-out.
    const [l, r] = render(delay, 3000, 1, 1, () => vowel, (b, i) => (b === 0 && i === 0 ? 1 : b === 1 && i === 5 ? NaN : 0));
    const MIN_NORMAL = 1.1754943508222875e-38;
    for (const ch of [l, r]) {
      for (let i = 0; i < ch.length; i++) {
        if (i === BLOCK + 5) continue; // the NaN sample itself passes through dry
        const x = ch[i];
        expect(Number.isFinite(x)).toBe(true);
        if (x !== 0) expect(Math.abs(x)).toBeGreaterThanOrEqual(MIN_NORMAL);
      }
    }
    // Long after the impulse the tail has died to exact silence (flushed, not denormal).
    expect(l.subarray(l.length - BLOCK).every((x) => x === 0)).toBe(true);
  });

  it('runs mono (no right channel) without throwing', () => {
    const delay = new PhonemeDelay(SR);
    const l = new Float32Array(BLOCK);
    l[0] = 1;
    expect(() => delay.process(l, null, 0.5, 0.5, consonant)).not.toThrow();
  });
});
