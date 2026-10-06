import { describe, expect, it } from 'vitest';
import type { PhonemeData } from '@/types';
import type { PhonemeSegment } from '../alignment/types';
import { PhonemeAligner } from '../PhonemeAligner';
import { clampElasticity, elasticityScales, matchUserPhonemes } from '../phonemeElasticity';
import { getPhonemeDataAtSample } from '@/audio-worklets/rubberband/phonemeData';

const SEGMENTS: PhonemeSegment[] = [
  { phoneme: 'HH', start: 0.0, end: 0.1, isVowel: false },
  { phoneme: 'EH', start: 0.1, end: 0.5, isVowel: true },
  { phoneme: 'L', start: 0.5, end: 0.6, isVowel: false },
  { phoneme: 'OW', start: 0.6, end: 1.0, isVowel: true },
];
const DURATION = 1.0;

const painter = (id: string, start: number, end: number, extra: Partial<PhonemeData> = {}): PhonemeData =>
  ({ id, symbol: id.toUpperCase(), start, end, pitchBend: 0, ...extra });

/** Σ duration × ratio × slot3 — the stretched length of the note. */
const stretchedLength = (ratios: number[], scales: number[]) =>
  SEGMENTS.reduce((acc, s, i) => acc + (s.end - s.start) * ratios[i] * scales[i], 0);

describe('clampElasticity', () => {
  it('defaults to 1 and clamps to 0.5–1.5', () => {
    expect(clampElasticity(undefined)).toBe(1);
    expect(clampElasticity(Number.NaN)).toBe(1);
    expect(clampElasticity(0.1)).toBe(0.5);
    expect(clampElasticity(9)).toBe(1.5);
    expect(clampElasticity(1.2)).toBe(1.2);
  });
});

describe('matchUserPhonemes', () => {
  it('pairs segments with the painter phoneme under their midpoint, not by index', () => {
    // The painter list is out of order and missing one phoneme.
    const user = [painter('ow', 0.6, 1.0, { elasticity: 1.5 }), painter('hh', 0, 0.1), painter('eh', 0.1, 0.5, { pitchBend: 30 })];
    const matched = matchUserPhonemes(SEGMENTS, user, DURATION);
    expect(matched.map((p) => p?.id)).toEqual(['hh', 'eh', undefined, 'ow']);
  });

  it('falls back to index order without a duration', () => {
    const user = [painter('a', 0, 1), painter('b', 0, 1)];
    expect(matchUserPhonemes(SEGMENTS, user, 0).map((p) => p?.id)).toEqual(['a', 'b', undefined, undefined]);
  });
});

describe('elasticityScales', () => {
  const aligner = new PhonemeAligner();
  const target = 2.0;
  const ratios = aligner.calculateStretchRatios(SEGMENTS, target);

  it('leaves every slot at exactly 1 when nothing is elastic', () => {
    expect(elasticityScales(SEGMENTS, ratios, [1, 1, 1, 1])).toEqual([1, 1, 1, 1]);
  });

  it('redistributes time inside the note without changing its length', () => {
    const scales = elasticityScales(SEGMENTS, ratios, [1, 1.5, 1, 0.5]);
    expect(stretchedLength(ratios, scales)).toBeCloseTo(stretchedLength(ratios, [1, 1, 1, 1]), 10);
    // EH now takes 3× OW's per-second share (1.5 / 0.5).
    expect(scales[1] / scales[3]).toBeCloseTo(3, 10);
    expect(scales[1]).toBeGreaterThan(1);
    expect(scales[3]).toBeLessThan(1);
  });
});

describe('createSharedPhonemeBuffer', () => {
  it('writes elasticity (slot 3) and painter params per matched segment', () => {
    const aligner = new PhonemeAligner();
    const ratios = aligner.calculateStretchRatios(SEGMENTS, 2.0);
    const user = matchUserPhonemes(
      SEGMENTS,
      [painter('eh', 0.1, 0.5, { elasticity: 1.4, pitchBend: 40, volume: 0.6 })],
      DURATION,
    );
    const view = new Float32Array(aligner.createSharedPhonemeBuffer(SEGMENTS, 48000, user, ratios));
    const slot = (i: number, s: number) => view[1 + i * 10 + s];

    expect(view[0]).toBe(4);
    expect(slot(1, 3)).toBeGreaterThan(1); // EH stretched
    expect(slot(0, 3)).toBeLessThan(1);    // the others give time up
    expect(slot(1, 4)).toBeCloseTo(0.6);
    expect(slot(1, 5)).toBe(40);
    expect(slot(2, 5)).toBe(0);            // unmatched: defaults
  });

  it('keeps slot 3 at 1 for notes without painter data', () => {
    const aligner = new PhonemeAligner();
    const view = new Float32Array(aligner.createSharedPhonemeBuffer(SEGMENTS, 48000));
    for (let i = 0; i < SEGMENTS.length; i++) expect(view[1 + i * 10 + 3]).toBe(1);
  });
});

describe('worklet phoneme tuple', () => {
  it('multiplies the target-fit ratio by the phoneme elasticity', () => {
    const aligner = new PhonemeAligner();
    const ratios = aligner.calculateStretchRatios(SEGMENTS, 2.0);
    const user = matchUserPhonemes(SEGMENTS, [painter('eh', 0.1, 0.5, { elasticity: 1.5 })], DURATION);
    const data = new Float32Array(aligner.createSharedPhonemeBuffer(SEGMENTS, 48000, user, ratios));
    const plain = new Float32Array(aligner.createSharedPhonemeBuffer(SEGMENTS, 48000, undefined, ratios));
    const out = new Float32Array(9);

    const inEh = 0.3 * 48000;
    const elastic = getPhonemeDataAtSample(data, ratios, inEh, out)[0];
    const asAligned = getPhonemeDataAtSample(plain, ratios, inEh, new Float32Array(9))[0];
    expect(asAligned).toBeCloseTo(ratios[1], 6);
    expect(elastic).toBeCloseTo(ratios[1] * data[1 + 10 + 3], 5);
    expect(elastic).toBeGreaterThan(asAligned);
  });
});

