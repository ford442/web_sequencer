/**
 * "Freeze FX to pattern": write a chain's output back into steps.
 *
 * The step model holds one note-start per step (Phase 3's free-time events
 * would lift that), so the projection is lossy where the chain is denser
 * than the grid, and says so instead of dropping notes silently:
 *
 * - events that start together on a step become that step's root + `chord`;
 * - evenly spaced repeats of the same notes inside one step (a ratchet, a
 *   fast arp on one pitch) become `retrigger` — the field playback already
 *   splits a note with;
 * - anything else past the first note-start of a step is counted in
 *   `dropped`.
 *
 * Per-step fields the chain does not generate (timbre, sends, formant, …)
 * carry over from the source step.
 */
import type { Note } from '@/types';
import { midiToNote } from '@/utils/musicTheory';
import { renderNoteFx, type NoteFxRenderOptions } from './chain';
import type { FxNoteEvent, NoteFxChain } from './types';

const EPS = 1e-6;
const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

export interface FreezeResult {
    steps: (Note | null)[];
    /** Events the step model could not hold. */
    dropped: number;
}

function sameSet(a: readonly number[], b: readonly number[]): boolean {
    if (a.length !== b.length) return false;
    const sa = [...a].sort((x, y) => x - y);
    const sb = [...b].sort((x, y) => x - y);
    return sa.every((p, i) => p === sb[i]);
}

/** Project `events` (sorted, one loop pass) onto `length` steps. */
export function freezeEventsToSteps(
    events: readonly FxNoteEvent[],
    source: readonly (Note | null)[],
    length: number,
): FreezeResult {
    const steps: (Note | null)[] = Array.from({ length }, () => null);
    // Bucket like the live clock does — start ∈ [step, step + 1) — so a
    // ratchet's repeats stay with the note they split.
    const byTick = new Map<number, FxNoteEvent[]>();
    for (const e of events) {
        const tick = Math.floor(e.start + EPS);
        if (tick < 0 || tick >= length) continue;
        const list = byTick.get(tick);
        if (list) list.push(e);
        else byTick.set(tick, [e]);
    }

    let dropped = 0;
    for (const [tick, list] of [...byTick].sort((a, b) => a[0] - b[0])) {
        // Distinct start times in this tick, earliest first.
        const starts: number[] = [];
        for (const e of list) if (!starts.some((s) => Math.abs(s - e.start) < EPS)) starts.push(e.start);
        starts.sort((a, b) => a - b);
        // The note lands on its nearest step; past the half step that is the
        // next one, with a negative microtiming (−0.5 < mt ≤ 0.5).
        const step = starts[0] - tick > 0.5 + EPS ? tick + 1 : tick;
        if (step >= length || steps[step]) {
            dropped += list.length;
            continue;
        }
        const at = (s: number) => list.filter((e) => Math.abs(e.start - s) < EPS);
        const first = at(starts[0]);
        const pitches = first.map((e) => e.pitch);

        let retrigger = 1;
        let noteLength = Math.max(...first.map((e) => e.length));
        if (starts.length > 1) {
            const slot = starts[1] - starts[0];
            const even = starts.every((s, i) => Math.abs(s - (starts[0] + i * slot)) < EPS);
            const samePitches = starts.every((s) => sameSet(at(s).map((e) => e.pitch), pitches));
            if (even && samePitches && slot > EPS) {
                retrigger = starts.length;
                noteLength = round6(slot * starts.length);
            } else {
                dropped += list.length - first.length;
            }
        }

        const src = source[first[0].sourceStep] ?? null;
        // Root: the source root if the chain kept it, else the lowest pitch.
        const sorted = [...new Set(pitches)].sort((a, b) => a - b);
        const sourceRoot = src ? sorted.find((p) => midiToNote(p) === src.note) : undefined;
        const root = sourceRoot ?? sorted[0];
        const rest = sorted.filter((p) => p !== root);

        const note: Note = { ...(src ?? { note: '', velocity: 1 }) };
        note.note = midiToNote(root);
        note.velocity = round6(Math.max(...first.map((e) => e.velocity)));
        note.length = round6(noteLength);
        note.slide = first.some((e) => e.slide);
        const mt = round6(starts[0] - step);
        if (mt !== 0) note.microtiming = mt;
        else delete note.microtiming;
        if (rest.length > 0) note.chord = rest.map(midiToNote);
        else delete note.chord;
        if (retrigger > 1) note.retrigger = retrigger;
        else delete note.retrigger;
        // Probability was rolled when the chain ran; the frozen note always plays.
        delete note.probability;
        steps[step] = note;
    }
    return { steps, dropped };
}

/**
 * Freeze one track: the chain's first loop pass written over the loop's
 * steps; steps past the loop (a pattern longer than this track's loop) stay.
 */
export function freezeNoteFx(
    steps: readonly (Note | null)[],
    chain: NoteFxChain,
    opts: Omit<NoteFxRenderOptions, 'iteration'>,
): FreezeResult & { notes: number } {
    const loop = Math.max(1, Math.floor(opts.loopLength));
    const events = renderNoteFx(steps, chain, { ...opts, iteration: 0 });
    const frozen = freezeEventsToSteps(events, steps, loop);
    const merged = [...frozen.steps, ...steps.slice(loop)];
    return { steps: merged, dropped: frozen.dropped, notes: events.length };
}
