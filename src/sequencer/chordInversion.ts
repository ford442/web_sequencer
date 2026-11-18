/**
 * Chord inversion for the sequencer's chord steps (moved out of
 * `useStepHandler.ts` for the module-size budget). Allocation-light: it runs
 * on the step hot path, so the work arrays are module scratch.
 */
import { midiToNote, noteToMidi } from '../utils/musicTheory';

const _midiScratch: number[] = [];
const _noteScratch: string[] = [];

/**
 * Invert a chord by `inversionVal` (0–1, a share of its voices): the lowest
 * voice moves up an octave that many times. Single notes pass through.
 */
export function applyInversion(notes: string | string[], inversionVal: number): string | string[] {
    const isArray = Array.isArray(notes);
    const len = isArray ? (notes).length : 1;
    if (len <= 1) return notes;

    // Cheap exit before any parsing: the voices that sound are at most `len`,
    // so no fewer inversions than this can come out of the count below.
    if (Math.round(inversionVal * (len - 1)) === 0) return notes;

    // Fill + convert in one pass (no .map allocation). Names that do not
    // parse never sound, so they drop out of the voicing.
    let count = 0;
    _midiScratch.length = len;
    for (let i = 0; i < len; i++) {
        const midi = noteToMidi((notes as string[])[i]);
        if (midi !== null) _midiScratch[count++] = midi;
    }
    _midiScratch.length = count;
    if (count <= 1) return notes;

    // An inversion count is a share of the voices that sound: a chord of three
    // names with one that does not parse has one inversion to give, not two
    // (two would lift both voices an octave — a transposition, not an inversion).
    const numInversions = Math.round(inversionVal * (count - 1));
    if (numInversions === 0) return notes;

    // Sort ascending in place
    _midiScratch.sort((a, b) => a - b);

    // Rotate without shift() — O(n) total instead of O(n²)
    for (let inv = 0; inv < numInversions; inv++) {
        const lowest = _midiScratch[0];
        for (let i = 0; i < count - 1; i++) {
            _midiScratch[i] = _midiScratch[i + 1];
        }
        _midiScratch[count - 1] = lowest + 12;
    }

    // Convert back — return a fresh array so callers can keep it
    _noteScratch.length = count;
    for (let i = 0; i < count; i++) {
        _noteScratch[i] = midiToNote(_midiScratch[i]);
    }
    return _noteScratch;
}
