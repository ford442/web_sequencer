/**
 * The piano roll's view of a track (#1345 Phase 1).
 *
 * There is no piano-roll store: the roll is a projection of
 * `PartSequence.steps`, and every edit (see `rollEdits.ts`) is a pure
 * function from steps to steps that the caller commits through
 * `usePatternHandlers` — so undo/redo, the clipboard, song storage and
 * export all see exactly what the step grid would have written.
 *
 * Mapping:
 *
 * | Note field     | Roll                                                     |
 * |----------------|----------------------------------------------------------|
 * | step index     | x (plus `microtiming`, −0.5…0.5 of a step)               |
 * | `length`       | width, in steps (default 1)                              |
 * | `note`         | y — the root voice (`voice` 0)                           |
 * | `chord[i]`     | stacked notes on the same step (`voice` i + 1)           |
 * | `slide`        | a tie from the previous note                             |
 * | `velocity`, `probability`, `timbre` | the lane under the grid            |
 *
 * The step model allows one note-start per step, so every voice of a step
 * shares its start, length and lane values. Moving a voice in time moves the
 * whole step; changing its pitch changes only that voice.
 */
import type { Note } from '@/types';
import { midiToNote, noteToMidi } from '@/utils/musicTheory';

export type Steps = readonly (Note | null)[];
export type MutableSteps = (Note | null)[];

export const MIN_PITCH = 0;
export const MAX_PITCH = 127;
/** Longest pattern a song can hold (SongMeter.stepCount is 1–64). */
export const MAX_ROLL_STEPS = 64;

export interface RollNote {
    /** `${step}:${voice}` — stable across re-renders while the step is unchanged. */
    id: string;
    step: number;
    /** 0 = the step's root (`note`), n = `chord[n - 1]`. */
    voice: number;
    pitch: number;
    /** step + microtiming, in steps. */
    start: number;
    length: number;
    velocity: number;
    probability: number;
    timbre: number | null;
    slide: boolean;
}

export interface NoteRef {
    step: number;
    voice: number;
}

export function rollNoteId(step: number, voice: number): string {
    return `${step}:${voice}`;
}

export function parseRollNoteId(id: string): NoteRef | null {
    const m = /^(\d+):(\d+)$/.exec(id);
    if (!m) return null;
    return { step: Number(m[1]), voice: Number(m[2]) };
}

export function clampPitch(pitch: number): number {
    return Math.min(MAX_PITCH, Math.max(MIN_PITCH, Math.round(pitch)));
}

/** `midiToNote` for any integer, clamped to the MIDI range. */
export function pitchName(pitch: number): string {
    return midiToNote(clampPitch(pitch));
}

export function noteLength(note: Note): number {
    return typeof note.length === 'number' && note.length > 0 ? note.length : 1;
}

export function noteStart(step: number, note: Note): number {
    const mt = typeof note.microtiming === 'number' && Number.isFinite(note.microtiming) ? note.microtiming : 0;
    return step + mt;
}

/**
 * Pitches of every voice on a step: root first, then chord tones in order.
 * A name that does not parse is not a voice (it never sounds), so it is left
 * out; an edit that rewrites the step drops it.
 */
export function stepPitches(note: Note): number[] {
    const out: number[] = [];
    const root = noteToMidi(note.note);
    if (root !== null) out.push(root);
    if (note.chord) {
        for (const tone of note.chord) {
            const midi = noteToMidi(tone);
            if (midi !== null) out.push(midi);
        }
    }
    return out;
}

export function stepsToRollNotes(steps: Steps): RollNote[] {
    const out: RollNote[] = [];
    for (let step = 0; step < steps.length; step++) {
        const note = steps[step];
        if (!note) continue;
        const start = noteStart(step, note);
        const length = noteLength(note);
        const pitches = stepPitches(note);
        for (let voice = 0; voice < pitches.length; voice++) {
            out.push({
                id: rollNoteId(step, voice),
                step,
                voice,
                pitch: pitches[voice],
                start,
                length,
                velocity: note.velocity ?? 1,
                probability: note.probability ?? 1,
                timbre: typeof note.timbre === 'number' ? note.timbre : null,
                slide: !!note.slide,
            });
        }
    }
    return out;
}

/** Lowest and highest pitch in use, or null for an empty track. */
export function pitchRange(notes: readonly RollNote[]): { low: number; high: number } | null {
    if (notes.length === 0) return null;
    let low = MAX_PITCH;
    let high = MIN_PITCH;
    for (const n of notes) {
        if (n.pitch < low) low = n.pitch;
        if (n.pitch > high) high = n.pitch;
    }
    return { low, high };
}

/** The roll note at (step, pitch) — the one whose rectangle covers that cell. */
export function noteAt(notes: readonly RollNote[], position: number, pitch: number): RollNote | null {
    // Later steps win where long notes overlap, matching draw order.
    for (let i = notes.length - 1; i >= 0; i--) {
        const n = notes[i];
        if (n.pitch === pitch && position >= n.start && position < n.start + n.length) return n;
    }
    return null;
}

export interface RollRect {
    /** Step positions (fractional). */
    start: number;
    end: number;
    /** Inclusive pitch bounds. */
    low: number;
    high: number;
}

/** Ids of notes whose rectangle intersects `rect` (marquee selection). */
export function notesInRect(notes: readonly RollNote[], rect: RollRect): string[] {
    const start = Math.min(rect.start, rect.end);
    const end = Math.max(rect.start, rect.end);
    const low = Math.min(rect.low, rect.high);
    const high = Math.max(rect.low, rect.high);
    const ids: string[] = [];
    for (const n of notes) {
        if (n.pitch < low || n.pitch > high) continue;
        if (n.start + n.length <= start || n.start >= end) continue;
        ids.push(n.id);
    }
    return ids;
}

/** Describe a note for screen readers: "C4, step 5, length 2, velocity 80%". */
export function describeRollNote(note: RollNote): string {
    const parts = [pitchName(note.pitch), `step ${note.step + 1}`];
    const mt = Math.round((note.start - note.step) * 100) / 100;
    if (mt !== 0) parts.push(`offset ${mt > 0 ? '+' : ''}${mt} step`);
    parts.push(`length ${Math.round(note.length * 100) / 100}`);
    parts.push(`velocity ${Math.round(note.velocity * 100)}%`);
    if (note.probability < 1) parts.push(`probability ${Math.round(note.probability * 100)}%`);
    if (note.voice > 0) parts.push('chord tone');
    if (note.slide) parts.push('slide');
    return parts.join(', ');
}
