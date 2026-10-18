/**
 * Acceptance (#1345 Phase 2): the live path (the step handler walking the
 * clock and scheduling each step's bucket at its sub-step offset) and the
 * offline path (one schedule at start × stepDuration) produce the same event
 * list for any pattern and chain.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Note } from '@/types';
import { renderNoteFx, renderNoteFxTimeline } from '../chain';
import { clearLiveNoteFxCache, liveNoteFxBuckets } from '../runtime';
import { ARP_MODES, ARP_RATES, type NoteFxChain } from '../types';

const PITCHES = ['C3', 'D#3', 'G3', 'C4', 'E4', 'A4'];
const noteArb: fc.Arbitrary<Note> = fc.record(
    {
        note: fc.constantFrom(...PITCHES),
        velocity: fc.double({ min: 0, max: 1, noNaN: true }),
        length: fc.constantFrom(0.5, 1, 1, 2, 3),
        slide: fc.boolean(),
        chord: fc.array(fc.constantFrom(...PITCHES), { maxLength: 2 }),
        microtiming: fc.constantFrom(0, 0, -0.25, 0.25, 0.5),
        probability: fc.constantFrom(1, 1, 0.5),
    },
    { requiredKeys: ['note', 'velocity'] },
);
const stepsArb = fc.array(fc.option(noteArb, { nil: null, freq: 2 }), { minLength: 1, maxLength: 32 });
const chainArb: fc.Arbitrary<NoteFxChain> = fc.record({
    chord: fc.record({ enabled: fc.boolean(), intervals: fc.array(fc.integer({ min: -12, max: 12 }), { maxLength: 3 }) }),
    arp: fc.record({
        enabled: fc.boolean(),
        mode: fc.constantFrom(...ARP_MODES),
        rate: fc.constantFrom(...ARP_RATES),
        octaves: fc.integer({ min: 1, max: 4 }),
        gate: fc.double({ min: 0.05, max: 1, noNaN: true }),
    }),
    ratchet: fc.record({ enabled: fc.boolean(), count: fc.integer({ min: 1, max: 8 }), decay: fc.double({ min: 0, max: 1, noNaN: true }), gate: fc.double({ min: 0.05, max: 1, noNaN: true }) }),
    euclid: fc.integer({ min: 1, max: 16 }).chain((steps) =>
        fc.record({ enabled: fc.boolean(), steps: fc.constant(steps), pulses: fc.integer({ min: 0, max: steps }), rotation: fc.integer({ min: 0, max: steps - 1 }) }),
    ),
    humanize: fc.record({ enabled: fc.boolean(), timing: fc.double({ min: 0, max: 0.5, noNaN: true }), velocity: fc.double({ min: 0, max: 1, noNaN: true }) }),
    seed: fc.integer({ min: 0, max: 0x7fffffff }),
});

const STEP_SECONDS = 0.125;
type Scheduled = { time: number; pitch: number; length: number; velocity: number };

/** The step handler's loop: per tick, the bucket, each at its offset. */
function liveSchedule(steps: (Note | null)[], chain: NoteFxChain, loopLength: number, passes: number): Scheduled[] {
    clearLiveNoteFxCache();
    const out: Scheduled[] = [];
    for (let absStep = 0; absStep < loopLength * passes; absStep++) {
        const tStep = absStep % loopLength;
        const tickTime = absStep * STEP_SECONDS;
        const buckets = liveNoteFxBuckets({
            key: 'partA', steps, chain, loopLength, iteration: Math.floor(absStep / loopLength), salt: 0, lanes: null,
        });
        for (const e of buckets[tStep]) {
            out.push({ time: tickTime + (e.start - tStep) * STEP_SECONDS, pitch: e.pitch, length: e.length, velocity: e.velocity });
        }
    }
    return out;
}

/** The offline renderer's loop: the timeline once, start × step duration. */
function offlineSchedule(steps: (Note | null)[], chain: NoteFxChain, loopLength: number, passes: number): Scheduled[] {
    const timeline: (Note | null)[] = [];
    for (let p = 0; p < passes; p++) {
        for (let s = 0; s < loopLength; s++) timeline.push(steps[s] ?? null);
    }
    return renderNoteFxTimeline(timeline, chain, { loopLength }).map((e) => ({
        time: e.start * STEP_SECONDS, pitch: e.pitch, length: e.length, velocity: e.velocity,
    }));
}

const close = (a: Scheduled[], b: Scheduled[]) => {
    expect(a.length).toBe(b.length);
    const sort = (xs: Scheduled[]) => [...xs].sort((x, y) => x.time - y.time || x.pitch - y.pitch || x.length - y.length);
    const sa = sort(a);
    const sb = sort(b);
    sa.forEach((x, i) => {
        expect(x.time).toBeCloseTo(sb[i].time, 9);
        expect(x.pitch).toBe(sb[i].pitch);
        expect(x.length).toBeCloseTo(sb[i].length, 9);
        expect(x.velocity).toBeCloseTo(sb[i].velocity, 9);
    });
};

describe('note FX live / offline parity', () => {
    it('schedules the same events live and offline, every pass', () => {
        fc.assert(
            fc.property(stepsArb, chainArb, fc.integer({ min: 1, max: 3 }), (steps, chain, passes) => {
                const loopLength = steps.length;
                close(liveSchedule(steps, chain, loopLength, passes), offlineSchedule(steps, chain, loopLength, passes));
            }),
            { numRuns: 200 },
        );
    });

    it('never schedules outside the loop or before its tick', () => {
        fc.assert(
            fc.property(stepsArb, chainArb, (steps, chain) => {
                const events = renderNoteFx(steps, chain, { loopLength: steps.length });
                for (const e of events) {
                    expect(e.start).toBeGreaterThanOrEqual(0);
                    expect(e.start).toBeLessThan(steps.length);
                    expect(e.pitch).toBeGreaterThanOrEqual(0);
                    expect(e.pitch).toBeLessThanOrEqual(127);
                    expect(e.length).toBeGreaterThan(0);
                }
            }),
        );
    });
});
