import { describe, expect, it } from 'vitest';
import type { Note } from '@/types';
import {
    describeRollNote,
    noteAt,
    notesInRect,
    parseRollNoteId,
    pitchRange,
    rollNoteId,
    stepsToRollNotes,
} from '../model/rollModel';

const n = (note: string, extra: Partial<Note> = {}): Note => ({ note, velocity: 1, length: 1, slide: false, ...extra });

describe('stepsToRollNotes', () => {
    it('maps step → x, microtiming → offset, length → width and chord tones → stacked voices', () => {
        const steps: (Note | null)[] = [
            n('C4'),
            null,
            n('E4', { chord: ['G4', 'B4'], length: 2, microtiming: 0.25, velocity: 0.5, probability: 0.75, timbre: 0.3, slide: true }),
        ];
        const notes = stepsToRollNotes(steps);
        expect(notes.map((x) => [x.id, x.pitch, x.start, x.length])).toEqual([
            ['0:0', 60, 0, 1],
            ['2:0', 64, 2.25, 2],
            ['2:1', 67, 2.25, 2],
            ['2:2', 71, 2.25, 2],
        ]);
        expect(notes[1]).toMatchObject({ velocity: 0.5, probability: 0.75, timbre: 0.3, slide: true, voice: 0 });
        expect(notes[3].voice).toBe(2);
    });

    it('defaults missing length / probability / timbre', () => {
        const [note] = stepsToRollNotes([{ note: 'A3', velocity: 0.8 }]);
        expect(note).toMatchObject({ length: 1, probability: 1, timbre: null, slide: false });
    });

    it('reads past a short steps array as rests (no holes, no throw)', () => {
        expect(stepsToRollNotes([])).toEqual([]);
    });
});

describe('roll queries', () => {
    const notes = stepsToRollNotes([n('C4', { length: 2 }), null, n('C4'), n('D4')]);

    it('finds the note covering a cell', () => {
        expect(noteAt(notes, 1.5, 60)?.id).toBe('0:0');
        expect(noteAt(notes, 2.1, 60)?.id).toBe('2:0');
        expect(noteAt(notes, 2.1, 61)).toBeNull();
    });

    it('selects notes intersecting a marquee', () => {
        expect(notesInRect(notes, { start: 1.5, end: 3.5, low: 60, high: 62 })).toEqual(['0:0', '2:0', '3:0']);
        expect(notesInRect(notes, { start: 3.5, end: 1.5, low: 62, high: 61 })).toEqual(['3:0']);
    });

    it('round-trips ids and reports the pitch span', () => {
        expect(parseRollNoteId(rollNoteId(12, 3))).toEqual({ step: 12, voice: 3 });
        expect(parseRollNoteId('nope')).toBeNull();
        expect(pitchRange(notes)).toEqual({ low: 60, high: 62 });
        expect(pitchRange([])).toBeNull();
    });

    it('describes a note for screen readers', () => {
        const [note] = stepsToRollNotes([null, n('F#3', { length: 2, velocity: 0.8, probability: 0.5, microtiming: -0.25 })]);
        expect(describeRollNote(note)).toBe('F#3, step 2, offset -0.25 step, length 2, velocity 80%, probability 50%');
    });
});
