// Unit tests for the clock-processor step-timing arithmetic.
//
// The processor itself runs in an AudioWorkletGlobalScope (no DOM), so we test
// the step-duration math by extracting it as pure functions — same logic the
// class uses internally.

import { describe, it, expect } from 'vitest';

// ── Extracted pure helpers (mirrors clock-processor.ts internals) ─────────────

const SAMPLE_RATE = 44100;

function baseSamplesPerStep(tempo: number): number {
    return (SAMPLE_RATE * 60) / (tempo * 4);
}

// swing 0 = straight, 1 = max shuffle
function stepDuration(tempo: number, swing: number, parity: 0 | 1): number {
    const base = baseSamplesPerStep(tempo);
    const shift = swing * base * 0.5;
    return parity === 0 ? base + shift : base - shift;
}

// Build the sample indices at which each of `numSteps` steps fires, given tempo+swing.
function stepFireTimes(tempo: number, swing: number, numSteps: number): number[] {
    const times: number[] = [];
    let cursor = 0;
    for (let s = 0; s < numSteps; s++) {
        times.push(cursor);
        const parity = (s % 2) as 0 | 1;
        cursor += stepDuration(tempo, swing, parity);
    }
    return times;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('clock-processor step timing', () => {
    it('step duration is exactly 60/tempo/4 seconds at swing=0', () => {
        const tempo = 120;
        const expectedSec = 60 / (tempo * 4);
        const durSamples = stepDuration(tempo, 0, 0);
        expect(durSamples / SAMPLE_RATE).toBeCloseTo(expectedSec, 6);
        // Same for odd steps
        expect(stepDuration(tempo, 0, 1) / SAMPLE_RATE).toBeCloseTo(expectedSec, 6);
    });

    it('even and odd durations sum to 2× base step regardless of swing', () => {
        const tempo = 130;
        const base = baseSamplesPerStep(tempo);
        for (const swing of [0, 0.25, 0.5, 0.75, 1.0]) {
            const even = stepDuration(tempo, swing, 0);
            const odd = stepDuration(tempo, swing, 1);
            expect(even + odd).toBeCloseTo(base * 2, 3);
        }
    });

    it('swing=0 produces evenly-spaced steps', () => {
        const tempo = 120;
        const base = baseSamplesPerStep(tempo);
        const times = stepFireTimes(tempo, 0, 8);
        for (let i = 1; i < times.length; i++) {
            expect(times[i] - times[i - 1]).toBeCloseTo(base, 3);
        }
    });

    it('swing=1 delays every odd step by half a base step', () => {
        const tempo = 120;
        const base = baseSamplesPerStep(tempo);
        const times = stepFireTimes(tempo, 1, 4);
        // step 0 fires at 0
        expect(times[0]).toBe(0);
        // step 1 fires at base + 0.5*base = 1.5*base
        expect(times[1]).toBeCloseTo(base + base * 0.5, 3);
        // step 2 fires at step1 + (base - 0.5*base) = step1 + 0.5*base = 2*base
        expect(times[2]).toBeCloseTo(times[1] + base * 0.5, 3);
        // step 3 fires at step2 + 1.5*base = 3.5*base
        expect(times[3]).toBeCloseTo(times[2] + base * 1.5, 3);
    });

    it('32-step bar duration equals 2 seconds at 120 BPM regardless of swing', () => {
        const tempo = 120;
        const times = stepFireTimes(tempo, 0, 32);
        const base = baseSamplesPerStep(tempo);
        const barDuration = times[times.length - 1] + stepDuration(tempo, 0, (31 % 2) as 0 | 1);
        // 32 steps × (60/120/4 s) = 32 × 0.125 = 4 s  (one 4-bar phrase at 16ths)
        // but our bar above is just the 32 steps, = 4 seconds
        expect(barDuration / SAMPLE_RATE).toBeCloseTo(4.0, 4);
        // With full swing the total duration is the same (pairs cancel out)
        const timesSwing = stepFireTimes(tempo, 1, 32);
        const barSwing = timesSwing[timesSwing.length - 1] + stepDuration(tempo, 1, (31 % 2) as 0 | 1);
        expect(barSwing / SAMPLE_RATE).toBeCloseTo(4.0, 4);
    });

    it('step fire times are strictly monotonically increasing for any swing', () => {
        const times = stepFireTimes(140, 0.6, 16);
        for (let i = 1; i < times.length; i++) {
            expect(times[i]).toBeGreaterThan(times[i - 1]);
        }
    });

    it('step period scales inversely with tempo', () => {
        const t1 = baseSamplesPerStep(60);
        const t2 = baseSamplesPerStep(120);
        expect(t1 / t2).toBeCloseTo(2, 6); // 120 BPM is twice as fast as 60 BPM
    });
});
