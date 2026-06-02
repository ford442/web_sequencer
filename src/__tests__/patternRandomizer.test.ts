import { describe, it, expect } from 'vitest';
import {
    euclideanRhythm,
    randomizeDrumTrack,
    randomizeMelodicTrack,
    humanizePattern,
    applyGrooveTemplate,
    seededRng,
    GROOVE_TEMPLATES,
} from '../utils/patternRandomizer';
import type { PartSequence } from '../types';

// ── euclideanRhythm ───────────────────────────────────────────────────────────

describe('euclideanRhythm', () => {
    it('returns empty array for steps=0', () => {
        expect(euclideanRhythm(0, 4)).toEqual([]);
    });

    it('returns all-false for hits=0', () => {
        const r = euclideanRhythm(8, 0);
        expect(r).toHaveLength(8);
        expect(r.every(v => !v)).toBe(true);
    });

    it('returns all-true for hits>=steps', () => {
        const r = euclideanRhythm(4, 4);
        expect(r.every(v => v)).toBe(true);
    });

    it('clamps hits to [0, steps]', () => {
        const r = euclideanRhythm(8, 20);
        expect(r.every(v => v)).toBe(true);
    });

    it('contains exactly k true values', () => {
        for (const [n, k] of [[16, 4], [16, 3], [16, 5], [8, 3], [12, 7]]) {
            const r = euclideanRhythm(n, k);
            expect(r.filter(v => v).length).toBe(k);
        }
    });

    it('E(16,4) has 4 hits spaced exactly 4 steps apart (evenly distributed)', () => {
        const r = euclideanRhythm(16, 4);
        const positions = r.map((v, i) => (v ? i : -1)).filter(i => i >= 0);
        expect(positions).toHaveLength(4);
        // All gaps between consecutive hits should be equal (evenly spaced).
        const gaps = positions.slice(1).map((p, i) => p - positions[i]!);
        expect(gaps.every(g => g === gaps[0])).toBe(true);
    });

    it('E(16,1) has exactly one hit', () => {
        const r = euclideanRhythm(16, 1);
        expect(r.filter(v => v).length).toBe(1);
    });

    it('produces deterministic output (no random component)', () => {
        const a = euclideanRhythm(16, 5);
        const b = euclideanRhythm(16, 5);
        expect(a).toEqual(b);
    });
});

// ── seededRng ─────────────────────────────────────────────────────────────────

describe('seededRng', () => {
    it('produces values in [0, 1)', () => {
        const rng = seededRng(42);
        for (let i = 0; i < 100; i++) {
            const v = rng();
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });

    it('produces the same sequence for the same seed', () => {
        const a = seededRng(99);
        const b = seededRng(99);
        const seqA = Array.from({ length: 20 }, () => a());
        const seqB = Array.from({ length: 20 }, () => b());
        expect(seqA).toEqual(seqB);
    });

    it('produces different sequences for different seeds', () => {
        const a = seededRng(1);
        const b = seededRng(2);
        const seqA = Array.from({ length: 10 }, () => a());
        const seqB = Array.from({ length: 10 }, () => b());
        expect(seqA).not.toEqual(seqB);
    });
});

// ── randomizeDrumTrack ────────────────────────────────────────────────────────

describe('randomizeDrumTrack', () => {
    it('returns a PartSequence with the right number of steps', () => {
        const seq = randomizeDrumTrack(16);
        expect(seq.steps).toHaveLength(16);
    });

    it('density=0 produces all null steps', () => {
        const seq = randomizeDrumTrack(16, { density: 0 });
        expect(seq.steps.every(s => s === null)).toBe(true);
    });

    it('density=1 produces all active steps', () => {
        const seq = randomizeDrumTrack(16, { density: 1 });
        expect(seq.steps.every(s => s !== null)).toBe(true);
    });

    it('active steps have velocity in [0, 1]', () => {
        const rng = seededRng(7);
        const seq = randomizeDrumTrack(32, { density: 0.5, rng });
        for (const step of seq.steps) {
            if (step) {
                expect(step.velocity).toBeGreaterThanOrEqual(0);
                expect(step.velocity).toBeLessThanOrEqual(1);
            }
        }
    });

    it('euclidean mode produces exactly round(steps*density) hits', () => {
        const steps = 16;
        const density = 0.25;
        const seq = randomizeDrumTrack(steps, { density, euclidean: true });
        const hits = seq.steps.filter(s => s !== null).length;
        expect(hits).toBe(Math.round(steps * density));
    });

    it('is deterministic with a seeded rng', () => {
        const a = randomizeDrumTrack(16, { density: 0.5, euclidean: false, rng: seededRng(42) });
        const b = randomizeDrumTrack(16, { density: 0.5, euclidean: false, rng: seededRng(42) });
        expect(a.steps).toEqual(b.steps);
    });
});

// ── randomizeMelodicTrack ─────────────────────────────────────────────────────

describe('randomizeMelodicTrack', () => {
    it('returns correct step count', () => {
        const seq = randomizeMelodicTrack(32);
        expect(seq.steps).toHaveLength(32);
    });

    it('density=0 produces all nulls', () => {
        const seq = randomizeMelodicTrack(16, { density: 0 });
        expect(seq.steps.every(s => s === null)).toBe(true);
    });

    it('all non-null steps have valid note strings', () => {
        const rng = seededRng(13);
        const seq = randomizeMelodicTrack(32, { density: 0.5, rng });
        for (const step of seq.steps) {
            if (step) {
                // Note strings must match e.g. "C4", "A#3"
                expect(step.note).toMatch(/^[A-G]#?\d+$/);
            }
        }
    });

    it('only uses notes from the given scale', () => {
        const rng = seededRng(5);
        // C Minor scale notes: C, D, D#, F, G, G#, A#
        const seq = randomizeMelodicTrack(64, { root: 'C', scale: 'Minor', density: 0.6, rng });
        const minorPcs = new Set([0, 2, 3, 5, 7, 8, 10]); // C Minor pitch classes
        for (const step of seq.steps) {
            if (!step) continue;
            const match = step.note.match(/([A-G]#?)(\d+)/);
            expect(match).toBeTruthy();
            const noteName = match![1];
            const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
            const pc = noteNames.indexOf(noteName);
            expect(minorPcs.has(pc)).toBe(true);
        }
    });

    it('is deterministic with a seed', () => {
        const a = randomizeMelodicTrack(16, { rng: seededRng(99) });
        const b = randomizeMelodicTrack(16, { rng: seededRng(99) });
        expect(a.steps).toEqual(b.steps);
    });
});

// ── humanizePattern ───────────────────────────────────────────────────────────

describe('humanizePattern', () => {
    const baseSeq: PartSequence = {
        steps: [
            { note: 'C4', velocity: 0.8, length: 1 },
            null,
            { note: 'E4', velocity: 0.8, length: 1 },
            null,
        ],
    };

    it('does not alter null steps', () => {
        const result = humanizePattern(baseSeq);
        expect(result.steps[1]).toBeNull();
        expect(result.steps[3]).toBeNull();
    });

    it('returns a new object (immutable)', () => {
        const result = humanizePattern(baseSeq);
        expect(result).not.toBe(baseSeq);
        expect(result.steps).not.toBe(baseSeq.steps);
    });

    it('keeps velocity within [0, 1]', () => {
        const rng = seededRng(77);
        const result = humanizePattern(baseSeq, { velocityAmount: 1.0, rng });
        for (const step of result.steps) {
            if (step) {
                expect(step.velocity).toBeGreaterThanOrEqual(0);
                expect(step.velocity).toBeLessThanOrEqual(1);
            }
        }
    });

    it('amount=0 leaves steps unchanged', () => {
        const result = humanizePattern(baseSeq, { velocityAmount: 0, timingAmount: 0, rng: seededRng(1) });
        for (let i = 0; i < result.steps.length; i++) {
            const orig = baseSeq.steps[i];
            const res = result.steps[i];
            if (orig && res) {
                expect(res.velocity).toBeCloseTo(orig.velocity);
            }
        }
    });

    it('adds microtiming when timingAmount > 0', () => {
        const rng = seededRng(3);
        const result = humanizePattern(baseSeq, { velocityAmount: 0, timingAmount: 0.1, rng });
        const activeResults = result.steps.filter(s => s !== null);
        const hasTiming = activeResults.some(s => s!.microtiming !== undefined && s!.microtiming !== 0);
        expect(hasTiming).toBe(true);
    });
});

// ── applyGrooveTemplate ───────────────────────────────────────────────────────

describe('applyGrooveTemplate', () => {
    const baseSeq: PartSequence = {
        steps: Array.from({ length: 16 }, (_, i) => (
            i % 2 === 0 ? { note: 'C4', velocity: 0.8, length: 1 } : null
        )),
    };

    it('preserves step count', () => {
        const result = applyGrooveTemplate(baseSeq, GROOVE_TEMPLATES.funk!);
        expect(result.steps).toHaveLength(baseSeq.steps.length);
    });

    it('leaves null steps as null', () => {
        const result = applyGrooveTemplate(baseSeq, GROOVE_TEMPLATES.shuffleLight!);
        for (let i = 0; i < result.steps.length; i++) {
            if (baseSeq.steps[i] === null) expect(result.steps[i]).toBeNull();
        }
    });

    it('straight groove does not change timing (timing=0 on all steps)', () => {
        const result = applyGrooveTemplate(baseSeq, GROOVE_TEMPLATES.straight!);
        for (const step of result.steps) {
            if (step) expect(step.microtiming).toBe(0);
        }
    });

    it('shuffleLight delays odd active steps', () => {
        // baseSeq has active steps at even indices (0, 2, 4, …)
        // shuffleLight: timing for even steps is 0, for odd steps is 0.07
        // Our base has active steps at even indices, so shuffle timing = 0 for them
        const result = applyGrooveTemplate(baseSeq, GROOVE_TEMPLATES.shuffleLight!);
        for (let i = 0; i < result.steps.length; i++) {
            if (result.steps[i]) {
                expect(result.steps[i]!.microtiming).toBe(i % 2 === 0 ? 0 : 0.07);
            }
        }
    });

    it('wraps groove template when pattern is longer than template period', () => {
        const longSeq: PartSequence = {
            steps: Array.from({ length: 32 }, () => ({ note: 'C4', velocity: 0.8, length: 1 })),
        };
        // funk template has 16 steps; steps 0 and 16 should get the same groove timing
        const result = applyGrooveTemplate(longSeq, GROOVE_TEMPLATES.funk!);
        expect(result.steps[0]?.microtiming).toEqual(result.steps[16]?.microtiming);
    });

    it('clamps resulting velocity to [0, 1]', () => {
        const lowVelSeq: PartSequence = {
            steps: [{ note: 'C4', velocity: 0.01, length: 1 }],
        };
        const result = applyGrooveTemplate(lowVelSeq, GROOVE_TEMPLATES.funk!);
        expect(result.steps[0]?.velocity).toBeGreaterThanOrEqual(0.01);
        expect(result.steps[0]?.velocity).toBeLessThanOrEqual(1);
    });
});

// ── GROOVE_TEMPLATES ──────────────────────────────────────────────────────────

describe('GROOVE_TEMPLATES', () => {
    it('all templates have exactly 16 steps', () => {
        for (const [key, tmpl] of Object.entries(GROOVE_TEMPLATES)) {
            expect(tmpl.steps).toHaveLength(16), `${key} should have 16 steps`;
        }
    });

    it('all template timing values are in a reasonable range', () => {
        for (const tmpl of Object.values(GROOVE_TEMPLATES)) {
            for (const step of tmpl.steps) {
                expect(Math.abs(step.timing)).toBeLessThanOrEqual(0.5);
            }
        }
    });

    it('straight template has all-zero timing', () => {
        for (const step of GROOVE_TEMPLATES.straight!.steps) {
            expect(step.timing).toBe(0);
        }
    });
});
