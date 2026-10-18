import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Note } from '@/types';
import {
    copySelection,
    deleteNotes,
    drawNote,
    drawNoteAt,
    duplicateNotes,
    lockNotesToScale,
    moveNotes,
    quantizeNotes,
    resizeNotes,
    setLaneValue,
    snapToScale,
    toggleSlide,
    transposePitch,
} from '../model/rollEdits';
import { stepPitches, stepsToRollNotes, type Steps } from '../model/rollModel';

const n = (note: string, extra: Partial<Note> = {}): Note => ({ note, velocity: 1, length: 1, slide: false, ...extra });
const empty = (len = 16): (Note | null)[] => Array<Note | null>(len).fill(null);
const C_MINOR = { root: 'C', scale: 'Minor' };

describe('drawNote', () => {
    it('writes the exact note shape the step grid writes', () => {
        const r = drawNote(empty(), 3, 62);
        expect(r.changed).toBe(true);
        expect(r.steps[3]).toEqual({ note: 'D4', velocity: 1, length: 1, slide: false });
        expect(r.selection).toEqual([{ step: 3, voice: 0 }]);
    });

    it('stacks a second pitch on an occupied step as a chord tone', () => {
        const base = empty();
        base[2] = n('C4');
        const r = drawNote(base, 2, 67);
        expect(r.steps[2]).toEqual({ ...n('C4'), chord: ['G4'] });
        expect(r.selection).toEqual([{ step: 2, voice: 1 }]);
    });

    it('is a no-op on a pitch the step already has', () => {
        const base = empty();
        base[2] = n('C4', { chord: ['E4'] });
        const r = drawNote(base, 2, 64);
        expect(r.changed).toBe(false);
        expect(r.steps).toBe(base);
        expect(r.selection).toEqual([{ step: 2, voice: 1 }]);
    });

    it('pads arrays shorter than the pattern and refuses steps past it', () => {
        const short: (Note | null)[] = [null, null];
        expect(drawNote(short, 5, 60, { maxSteps: 8 }).steps).toHaveLength(6);
        expect(drawNote(short, 8, 60, { maxSteps: 8 }).changed).toBe(false);
    });

    it('drawNoteAt keeps a fine-grid offset as microtiming', () => {
        const r = drawNoteAt(empty(), 3.25, 60);
        expect(r.steps[3]).toMatchObject({ note: 'C4', microtiming: 0.25 });
        const late = drawNoteAt(empty(), 3.75, 60);
        expect(late.steps[4]).toMatchObject({ note: 'C4', microtiming: -0.25 });
    });
});

describe('deleteNotes', () => {
    it('promotes the first chord tone when the root goes and clears an emptied step', () => {
        const base = empty();
        base[0] = n('C4', { chord: ['E4', 'G4'] });
        base[1] = n('D4');
        const r = deleteNotes(base, [{ step: 0, voice: 0 }, { step: 1, voice: 0 }]);
        expect(r.steps[0]).toEqual({ ...n('E4'), chord: ['G4'] });
        expect(r.steps[1]).toBeNull();
        expect(base[0]!.note).toBe('C4');
    });
});

describe('moveNotes', () => {
    it('moves whole steps in time, overwriting the target', () => {
        const base = empty();
        base[0] = n('C4', { chord: ['E4'] });
        base[4] = n('A4');
        const r = moveNotes(base, [{ step: 0, voice: 1 }], 4, 0);
        expect(r.steps[0]).toBeNull();
        expect(r.steps[4]).toEqual({ ...n('C4'), chord: ['E4'] });
        expect(r.selection).toEqual([{ step: 4, voice: 1 }]);
    });

    it('transposes only the selected voices', () => {
        const base = empty();
        base[0] = n('C4', { chord: ['E4'] });
        const r = moveNotes(base, [{ step: 0, voice: 1 }], 0, 1);
        expect(r.steps[0]).toEqual({ ...n('C4'), chord: ['F4'] });
    });

    it('snaps the delta, not the position, so microtiming survives a drag', () => {
        const base = empty();
        base[2] = n('C4', { microtiming: 0.25 });
        const r = moveNotes(base, [{ step: 2, voice: 0 }], 1.4, 0, { grid: 1 });
        expect(r.steps[3]).toMatchObject({ microtiming: 0.25 });
        const fine = moveNotes(base, [{ step: 2, voice: 0 }], 0.5, 0, { grid: 0.25 });
        // 2.25 + 0.5 = 2.75 → step 3, -0.25.
        expect(fine.steps[3]).toMatchObject({ microtiming: -0.25 });
    });

    it('does not add a microtiming field to a note that had none', () => {
        const base = empty();
        base[1] = n('C4');
        const r = moveNotes(base, [{ step: 1, voice: 0 }], 2, 0);
        expect(r.steps[3]).toEqual(n('C4'));
    });

    it('collapses a voice transposed onto another voice of its step', () => {
        const base = empty();
        base[0] = n('C4', { chord: ['D4'] });
        const r = moveNotes(base, [{ step: 0, voice: 0 }], 0, 2);
        expect(r.steps[0]).toEqual({ ...n('D4'), chord: [] });
        expect(r.selection).toEqual([{ step: 0, voice: 0 }]);
    });

    it('walks scale degrees under scale lock', () => {
        // C minor: C D Eb F G Ab Bb.
        expect(transposePitch(62, 1, C_MINOR)).toBe(63);
        expect(transposePitch(63, 1, C_MINOR)).toBe(65);
        expect(transposePitch(60, 4, C_MINOR)).toBe(65);
        expect(snapToScale(64, C_MINOR)).toBe(63);
        expect(snapToScale(64, C_MINOR, 1)).toBe(65);
    });
});

describe('resizeNotes', () => {
    it('clears the steps a longer note covers, like a grid length edit', () => {
        const base = empty();
        base[0] = n('C4');
        base[1] = n('D4');
        base[2] = n('E4');
        const r = resizeNotes(base, [{ step: 0, voice: 0 }], 2);
        expect(r.steps[0]).toEqual(n('C4', { length: 3 }));
        expect(r.steps[1]).toBeNull();
        expect(r.steps[2]).toBeNull();
    });

    it('never shrinks below the grid unit and never past the pattern end', () => {
        const base = empty(8);
        base[6] = n('C4');
        expect(resizeNotes(base, [{ step: 6, voice: 0 }], -4).changed).toBe(false);
        expect(resizeNotes(base, [{ step: 6, voice: 0 }], 10, { maxSteps: 8 }).steps[6]!.length).toBe(2);
        expect(resizeNotes(base, [{ step: 6, voice: 0 }], -0.5, { grid: 0.25 }).steps[6]!.length).toBe(0.5);
    });
});

describe('duplicate / quantize / scale / lane / slide / copy', () => {
    it('duplicates a selection to the right of its span', () => {
        const base = empty();
        base[0] = n('C4', { length: 2 });
        base[2] = n('D4');
        const r = duplicateNotes(base, [{ step: 0, voice: 0 }, { step: 2, voice: 0 }]);
        expect(r.steps[3]).toEqual(base[0]);
        expect(r.steps[5]).toEqual(base[2]);
        expect(r.selection).toEqual([{ step: 3, voice: 0 }, { step: 5, voice: 0 }]);
    });

    it('quantizes starts toward the grid with a strength', () => {
        const base = empty();
        base[2] = n('C4', { microtiming: 0.4 });
        base[5] = n('D4', { microtiming: -0.2 });
        const hard = quantizeNotes(base, [{ step: 2, voice: 0 }, { step: 5, voice: 0 }]);
        expect(hard.steps[2]).toMatchObject({ microtiming: 0 });
        expect(hard.steps[5]).toMatchObject({ microtiming: 0 });
        const half = quantizeNotes(base, [{ step: 2, voice: 0 }], { strength: 0.5 });
        expect(half.steps[2]!.microtiming).toBeCloseTo(0.2);
        const toBeat = quantizeNotes(base, [{ step: 2, voice: 0 }], { grid: 4 });
        expect(toBeat.steps[4]).toMatchObject({ note: 'C4', microtiming: 0 });
        expect(toBeat.steps[2]).toBeNull();
    });

    it('locks selected voices to the scale', () => {
        const base = empty();
        base[0] = n('E4', { chord: ['A4'] });
        const r = lockNotesToScale(base, [{ step: 0, voice: 0 }, { step: 0, voice: 1 }], C_MINOR);
        expect(stepPitches(r.steps[0]!)).toEqual([63, 68]);
        expect(lockNotesToScale(r.steps, [{ step: 0, voice: 0 }], C_MINOR).changed).toBe(false);
    });

    it('writes lane values per step and toggles slide', () => {
        const base = empty();
        base[1] = n('C4');
        const v = setLaneValue(base, [1, 2], 'velocity', 0.4);
        expect(v.steps[1]!.velocity).toBe(0.4);
        expect(v.steps[2]).toBeNull();
        expect(setLaneValue(base, [1], 'probability', 2).steps[1]!.probability).toBe(1);
        expect(toggleSlide(base, 1).steps[1]!.slide).toBe(true);
    });

    it('copies the selected voices over the step span, empty elsewhere', () => {
        const base = empty();
        base[1] = n('C4', { chord: ['E4'] });
        base[2] = n('D4');
        base[3] = n('F4');
        const clip = copySelection(base, [{ step: 1, voice: 1 }, { step: 3, voice: 0 }]);
        expect(clip?.start).toBe(1);
        expect(clip?.steps).toEqual([{ ...n('E4'), chord: [] }, null, n('F4')]);
    });
});

// ── Properties ────────────────────────────────────────────────────────────

const PITCHES = ['C3', 'D#3', 'G3', 'C4', 'E4', 'A4', 'C5'];
const noteArb: fc.Arbitrary<Note> = fc.record({
    note: fc.constantFrom(...PITCHES),
    velocity: fc.double({ min: 0, max: 1, noNaN: true }),
    length: fc.constantFrom(1, 1, 1, 2, 0.5),
    slide: fc.boolean(),
});
const stepsArb: fc.Arbitrary<(Note | null)[]> = fc.array(fc.option(noteArb, { nil: null, freq: 2 }), { minLength: 1, maxLength: 32 });

describe('rollEdits properties', () => {
    it('never mutates the input steps', () => {
        fc.assert(
            fc.property(stepsArb, fc.integer({ min: 0, max: 31 }), fc.integer({ min: -3, max: 3 }), fc.integer({ min: -5, max: 5 }), (steps, s, dt, dp) => {
                const frozen = JSON.stringify(steps);
                const refs = stepsToRollNotes(steps).filter((x) => x.step === s).map((x) => ({ step: x.step, voice: x.voice }));
                drawNote(steps, s % steps.length, 60);
                deleteNotes(steps, refs);
                moveNotes(steps, refs, dt, dp);
                resizeNotes(steps, refs, dt);
                duplicateNotes(steps, refs);
                quantizeNotes(steps, refs, { grid: 2 });
                expect(JSON.stringify(steps)).toBe(frozen);
            }),
        );
    });

    it('a time move and its inverse restore the pattern when nothing collides', () => {
        fc.assert(
            fc.property(stepsArb, fc.integer({ min: 1, max: 4 }), (steps, d) => {
                const notes = stepsToRollNotes(steps);
                if (notes.length === 0) return;
                const first = notes[0].step;
                const refs = notes.filter((x) => x.step === first).map((x) => ({ step: x.step, voice: x.voice }));
                if (first + d >= 64 || steps[first + d]) return; // would collide or clamp
                const there = moveNotes(steps, refs, d, 0);
                const back = moveNotes(there.steps, there.selection, -d, 0);
                const trim = (xs: Steps) => {
                    const out = [...xs];
                    while (out.length > steps.length && out[out.length - 1] === null) out.pop();
                    return out;
                };
                expect(trim(back.steps)).toEqual(steps);
            }),
        );
    });

    it('every voice of every step is a roll note', () => {
        fc.assert(
            fc.property(stepsArb, (steps) => {
                const voices = steps.reduce((sum, s) => sum + (s ? stepPitches(s).length : 0), 0);
                expect(stepsToRollNotes(steps)).toHaveLength(voices);
            }),
        );
    });
});
