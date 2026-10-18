/**
 * Piano-roll edits as pure functions over `PartSequence.steps`.
 *
 * Every function returns a new steps array (the input is never mutated) plus
 * the selection that should follow the edit; `changed: false` means the
 * caller has nothing to commit. Notes created here have exactly the shape
 * the step grid writes (`{ note, velocity: 1, length: 1, slide: false }`),
 * and a length edit clears the steps it now covers just like
 * `handlePatternChange` does — so the same edit made in either view yields
 * the same pattern.
 *
 * Time moves act on whole steps (the step model has one note-start per
 * step); pitch moves act on the selected voices only.
 */
import type { Note } from '@/types';
import { isMidiInScale, nextScaleNote, type ScaleDefinition } from '@/utils/musicTheory';
import {
    MAX_ROLL_STEPS,
    clampPitch,
    noteLength,
    noteStart,
    pitchName,
    stepPitches,
    type MutableSteps,
    type NoteRef,
    type Steps,
} from './rollModel';

export interface EditResult {
    steps: Steps;
    selection: NoteRef[];
    changed: boolean;
}

export type LaneProperty = 'velocity' | 'probability' | 'timbre';

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

function unchanged(steps: Steps, selection: NoteRef[] = []): EditResult {
    return { steps, selection, changed: false };
}

/** Copy `steps`, padding with null up to `minLength` (patterns can outgrow old arrays). */
function copySteps(steps: Steps, minLength = 0): MutableSteps {
    const out = steps.slice() as MutableSteps;
    for (let i = out.length; i < minLength; i++) out[i] = null;
    return out;
}

/** Selected voices, grouped by step, for steps that hold a note. */
function groupRefs(steps: Steps, refs: readonly NoteRef[]): Map<number, Set<number>> {
    const byStep = new Map<number, Set<number>>();
    for (const ref of refs) {
        const note = steps[ref.step];
        if (!note) continue;
        if (ref.voice < 0 || ref.voice >= stepPitches(note).length) continue;
        let voices = byStep.get(ref.step);
        if (!voices) {
            voices = new Set();
            byStep.set(ref.step, voices);
        }
        voices.add(ref.voice);
    }
    return byStep;
}

/** Snap a drag/keyboard delta to the grid unit (offsets inside the grid are kept). */
export function snapDelta(delta: number, grid: number): number {
    if (!(grid > 0)) return delta;
    return round6(Math.round(delta / grid) * grid);
}

/**
 * Rewrite a note's voices. Duplicate pitches collapse onto the first voice;
 * `remap[i]` is the new voice index of old voice `i`.
 */
function withPitches(note: Note, pitches: readonly number[]): { note: Note; remap: number[] } {
    const unique: number[] = [];
    const remap: number[] = [];
    for (const p of pitches) {
        const at = unique.indexOf(p);
        if (at >= 0) {
            remap.push(at);
        } else {
            remap.push(unique.length);
            unique.push(p);
        }
    }
    const next: Note = { ...note, note: pitchName(unique[0]) };
    if (unique.length > 1) {
        next.chord = unique.slice(1).map(pitchName);
    } else if (note.chord !== undefined) {
        next.chord = [];
    }
    return { note: next, remap };
}

function setStart(note: Note, start: number): { note: Note; step: number } {
    const step = Math.round(start);
    const mt = round6(start - step);
    const next: Note = { ...note };
    if (mt === 0 && note.microtiming === undefined) {
        delete next.microtiming;
    } else {
        next.microtiming = mt;
    }
    return { note: next, step };
}

/** Snap a pitch into `scale`, preferring `direction` (ties go down). */
export function snapToScale(pitch: number, scale: ScaleDefinition | null | undefined, direction: 1 | -1 = -1): number {
    const p = clampPitch(pitch);
    if (!scale || isMidiInScale(p, scale)) return p;
    for (let d = 1; d <= 6; d++) {
        const first = clampPitch(p + d * direction);
        if (isMidiInScale(first, scale)) return first;
        const second = clampPitch(p - d * direction);
        if (isMidiInScale(second, scale)) return second;
    }
    return p;
}

/** Transpose by `semitones`; under scale lock a ±1 step walks to the next scale note. */
export function transposePitch(pitch: number, semitones: number, scale?: ScaleDefinition | null): number {
    if (semitones === 0) return pitch;
    const direction: 1 | -1 = semitones > 0 ? 1 : -1;
    if (!scale) return clampPitch(pitch + semitones);
    if (Math.abs(semitones) === 1) return clampPitch(nextScaleNote(pitch, direction, scale));
    return snapToScale(pitch + semitones, scale, direction);
}

/** Null the steps a note of `length` at `step` now covers (grid semantics). */
function clearCovered(steps: MutableSteps, step: number, length: number, keep: ReadonlySet<number>): void {
    for (let k = 1; k < length; k++) {
        const i = step + k;
        if (i >= steps.length) break;
        if (!keep.has(i)) steps[i] = null;
    }
}

/** Click / draw: an empty step gets a note, an occupied step gains a chord tone. */
export function drawNote(
    steps: Steps,
    step: number,
    pitch: number,
    opts: { length?: number; maxSteps?: number } = {},
): EditResult {
    const maxSteps = opts.maxSteps ?? MAX_ROLL_STEPS;
    if (!Number.isInteger(step) || step < 0 || step >= maxSteps) return unchanged(steps);
    const p = clampPitch(pitch);
    const existing = steps[step] ?? null;
    if (!existing) {
        const next = copySteps(steps, step + 1);
        const length = opts.length && opts.length > 0 ? opts.length : 1;
        next[step] = { note: pitchName(p), velocity: 1, length, slide: false };
        clearCovered(next, step, length, new Set([step]));
        return { steps: next, selection: [{ step, voice: 0 }], changed: true };
    }
    const pitches = stepPitches(existing);
    const at = pitches.indexOf(p);
    if (at >= 0) return unchanged(steps, [{ step, voice: at }]);
    const next = copySteps(steps);
    next[step] = { ...existing, chord: [...(existing.chord ?? []), pitchName(p)] };
    return { steps: next, selection: [{ step, voice: pitches.length }], changed: true };
}

/**
 * Draw at a (possibly fractional) grid position: the note lands on the
 * nearest step with the remainder as `microtiming`. Adding a chord tone to an
 * occupied step keeps that step's timing.
 */
export function drawNoteAt(
    steps: Steps,
    position: number,
    pitch: number,
    opts: { length?: number; maxSteps?: number } = {},
): EditResult {
    const maxSteps = opts.maxSteps ?? MAX_ROLL_STEPS;
    const clamped = Math.min(maxSteps - 1, Math.max(0, position));
    const step = Math.round(clamped);
    const mt = round6(clamped - step);
    const result = drawNote(steps, step, pitch, opts);
    if (!result.changed || mt === 0 || steps[step]) return result;
    const next = result.steps.slice() as MutableSteps;
    next[step] = { ...next[step]!, microtiming: mt };
    return { ...result, steps: next };
}

/** Delete voices. A step whose root is deleted promotes its first remaining chord tone. */
export function deleteNotes(steps: Steps, refs: readonly NoteRef[]): EditResult {
    const byStep = groupRefs(steps, refs);
    if (byStep.size === 0) return unchanged(steps);
    const next = copySteps(steps);
    for (const [step, voices] of byStep) {
        const note = next[step]!;
        const remaining = stepPitches(note).filter((_, v) => !voices.has(v));
        next[step] = remaining.length === 0 ? null : withPitches(note, remaining).note;
    }
    return { steps: next, selection: [], changed: true };
}

interface Relocation {
    from: number;
    to: number;
    note: Note;
    /** New voice index of each selected old voice. */
    selected: number[];
}

/** Apply relocations: clear every source first, then write targets (targets overwrite). */
function relocate(steps: Steps, plan: readonly Relocation[]): EditResult {
    if (plan.length === 0) return unchanged(steps);
    const maxTo = Math.max(...plan.map((r) => r.to));
    const next = copySteps(steps, maxTo + 1);
    for (const r of plan) next[r.from] = null;
    const written = new Map<number, Note>();
    const selection: NoteRef[] = [];
    for (const r of plan) {
        const prior = written.get(r.to);
        if (!prior) {
            written.set(r.to, r.note);
            next[r.to] = r.note;
            for (const voice of r.selected) selection.push({ step: r.to, voice });
            continue;
        }
        // Two moved steps landed on one step (clamped at an edge): stack them.
        const priorPitches = stepPitches(prior);
        const incoming = stepPitches(r.note);
        const merged = withPitches(prior, [...priorPitches, ...incoming]);
        written.set(r.to, merged.note);
        next[r.to] = merged.note;
        for (const voice of r.selected) {
            selection.push({ step: r.to, voice: merged.remap[priorPitches.length + voice] });
        }
    }
    return { steps: next, selection, changed: true };
}

export interface MoveOptions {
    /** Grid unit in steps; the time delta snaps to it. */
    grid?: number;
    maxSteps?: number;
    /** Scale lock: moved pitches land on scale notes. */
    scale?: ScaleDefinition | null;
}

/** Drag / arrow-key move: `dStart` steps in time (whole steps move), `dPitch` on selected voices. */
export function moveNotes(steps: Steps, refs: readonly NoteRef[], dStart: number, dPitch: number, opts: MoveOptions = {}): EditResult {
    const maxSteps = opts.maxSteps ?? MAX_ROLL_STEPS;
    const delta = snapDelta(dStart, opts.grid ?? 1);
    const byStep = groupRefs(steps, refs);
    if (byStep.size === 0 || (delta === 0 && dPitch === 0)) return unchanged(steps, [...refs]);

    const plan: Relocation[] = [];
    for (const [from, voices] of byStep) {
        const original = steps[from]!;
        const pitches = stepPitches(original).map((p, v) =>
            voices.has(v) ? transposePitch(p, dPitch, opts.scale) : p,
        );
        const repitched = withPitches(original, pitches);
        let to = from;
        let note = repitched.note;
        if (delta !== 0) {
            const start = Math.min(maxSteps - 1, Math.max(0, noteStart(from, original) + delta));
            const placed = setStart(note, start);
            note = placed.note;
            to = placed.step;
        }
        plan.push({ from, to, note, selected: [...voices].map((v) => repitched.remap[v]) });
    }
    return relocate(steps, plan);
}

export function transposeNotes(steps: Steps, refs: readonly NoteRef[], semitones: number, scale?: ScaleDefinition | null): EditResult {
    return moveNotes(steps, refs, 0, semitones, { scale });
}

/** Resize every selected step by `dLength` (snapped), clearing what the new length covers. */
export function resizeNotes(
    steps: Steps,
    refs: readonly NoteRef[],
    dLength: number,
    opts: { grid?: number; maxSteps?: number } = {},
): EditResult {
    const grid = opts.grid ?? 1;
    const maxSteps = opts.maxSteps ?? MAX_ROLL_STEPS;
    const delta = snapDelta(dLength, grid);
    const byStep = groupRefs(steps, refs);
    if (byStep.size === 0 || delta === 0) return unchanged(steps, [...refs]);
    const next = copySteps(steps);
    const resized = new Set(byStep.keys());
    let changed = false;
    for (const step of [...resized].sort((a, b) => a - b)) {
        const note = next[step];
        if (!note) continue;
        const length = round6(Math.min(maxSteps - step, Math.max(Math.min(grid, 1), noteLength(note) + delta)));
        if (length === noteLength(note)) continue;
        next[step] = { ...note, length };
        clearCovered(next, step, length, resized);
        changed = true;
    }
    return changed ? { steps: next, selection: [...refs], changed } : unchanged(steps, [...refs]);
}

/** Copy the selected steps to the right of the selection's span (Ctrl+D). */
export function duplicateNotes(steps: Steps, refs: readonly NoteRef[], opts: { maxSteps?: number } = {}): EditResult {
    const maxSteps = opts.maxSteps ?? MAX_ROLL_STEPS;
    const byStep = groupRefs(steps, refs);
    if (byStep.size === 0) return unchanged(steps, [...refs]);
    const sources = [...byStep.keys()].sort((a, b) => a - b);
    const first = sources[0];
    let end = first;
    for (const s of sources) end = Math.max(end, s + Math.ceil(noteLength(steps[s]!)));
    const offset = end - first;
    const targets = sources.map((s) => s + offset).filter((t) => t < maxSteps);
    if (targets.length === 0) return unchanged(steps, [...refs]);
    const next = copySteps(steps, Math.max(...targets) + 1);
    const selection: NoteRef[] = [];
    for (const s of sources) {
        const t = s + offset;
        if (t >= maxSteps) continue;
        next[t] = { ...steps[s]! };
        for (const voice of byStep.get(s)!) selection.push({ step: t, voice });
    }
    return { steps: next, selection, changed: true };
}

/** Pull note starts toward the grid: `strength` 1 = hard quantize, 0.5 = halfway. */
export function quantizeNotes(
    steps: Steps,
    refs: readonly NoteRef[],
    opts: { grid?: number; strength?: number; maxSteps?: number } = {},
): EditResult {
    const grid = opts.grid ?? 1;
    const strength = Math.min(1, Math.max(0, opts.strength ?? 1));
    const maxSteps = opts.maxSteps ?? MAX_ROLL_STEPS;
    const byStep = groupRefs(steps, refs);
    const plan: Relocation[] = [];
    for (const [from, voices] of byStep) {
        const original = steps[from]!;
        const start = noteStart(from, original);
        const target = Math.round(start / grid) * grid;
        const quantized = Math.min(maxSteps - 1, Math.max(0, round6(start + (target - start) * strength)));
        if (quantized === start) continue;
        const placed = setStart(original, quantized);
        plan.push({ from, to: placed.step, note: placed.note, selected: [...voices] });
    }
    return plan.length === 0 ? unchanged(steps, [...refs]) : relocate(steps, plan);
}

/** Snap the selected voices onto `scale` (nearest scale note, ties down). */
export function lockNotesToScale(steps: Steps, refs: readonly NoteRef[], scale: ScaleDefinition): EditResult {
    const byStep = groupRefs(steps, refs);
    const next = copySteps(steps);
    const selection: NoteRef[] = [];
    let changed = false;
    for (const [step, voices] of byStep) {
        const note = next[step]!;
        const pitches = stepPitches(note);
        const snapped = pitches.map((p, v) => (voices.has(v) ? snapToScale(p, scale) : p));
        if (snapped.every((p, i) => p === pitches[i])) {
            for (const v of voices) selection.push({ step, voice: v });
            continue;
        }
        const rewritten = withPitches(note, snapped);
        next[step] = rewritten.note;
        for (const v of voices) selection.push({ step, voice: rewritten.remap[v] });
        changed = true;
    }
    return changed ? { steps: next, selection, changed } : unchanged(steps, selection);
}

/** Set a lane value (shared by every voice of the step) on each of `stepIndices`. */
export function setLaneValue(steps: Steps, stepIndices: readonly number[], property: LaneProperty, value: number): EditResult {
    const v = Math.min(1, Math.max(0, value));
    const next = copySteps(steps);
    let changed = false;
    for (const step of new Set(stepIndices)) {
        const note = next[step];
        if (!note || note[property] === v) continue;
        next[step] = { ...note, [property]: v };
        changed = true;
    }
    return changed ? { steps: next, selection: [], changed } : unchanged(steps);
}

export function toggleSlide(steps: Steps, step: number): EditResult {
    const note = steps[step];
    if (!note) return unchanged(steps);
    const next = copySteps(steps);
    next[step] = { ...note, slide: !note.slide };
    return { steps: next, selection: [{ step, voice: 0 }], changed: true };
}

/**
 * The clipboard payload for a roll selection: the step range it spans, with
 * steps outside the selection left empty. Same shape the grid copies.
 */
export function copySelection(steps: Steps, refs: readonly NoteRef[]): { start: number; steps: (Note | null)[] } | null {
    const byStep = groupRefs(steps, refs);
    if (byStep.size === 0) return null;
    const keys = [...byStep.keys()];
    const start = Math.min(...keys);
    const end = Math.max(...keys);
    const out: (Note | null)[] = [];
    for (let s = start; s <= end; s++) {
        const note = steps[s];
        const voices = byStep.get(s);
        if (!note || !voices) {
            out.push(null);
            continue;
        }
        const kept = stepPitches(note).filter((_, v) => voices.has(v));
        out.push(withPitches({ ...note }, kept).note);
    }
    return { start, steps: out };
}
