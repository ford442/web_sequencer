/**
 * The note FX chain as pure functions: steps → events.
 *
 * `renderNoteFx` is the only producer of FX notes. The step handler buckets
 * its output per step and schedules each event at its sub-step time; the
 * offline renderers schedule the same list at `start × stepDuration`. Every
 * random choice (arp `random`, humanize, per-step probability) draws from one
 * RNG seeded by (chain seed, loop iteration, salt) in a fixed order, so live
 * and offline produce the same events — `noteFxParity.test.ts` pins it.
 */
import type { Note } from '@/types';
import { noteToMidi } from '@/utils/musicTheory';
import { euclideanRhythm, seededRng, type Rng } from '@/utils/patternRandomizer';
import { resolveChainAtStep, type NoteFxParamLookup } from './params';
import type { FxNoteEvent, NoteFxChain } from './types';

const EPS = 1e-9;
const round9 = (x: number): number => Math.round(x * 1e9) / 1e9;
const clampPitch = (p: number): number => Math.min(127, Math.max(0, Math.round(p)));

export interface NoteFxRenderOptions {
    /** The track's loop length: steps at or past it never play. */
    loopLength: number;
    /** Loop iteration since PLAY (seeds the randomness; 0 for a one-pass render). */
    iteration?: number;
    /** Distinguishes chains that share a seed (sampler banks). */
    salt?: number;
    /** Automation of chain parameters per source step. */
    lookup?: NoteFxParamLookup;
}

/** Mix seed parts into one 32-bit seed (FNV-1a over the words). */
export function mixSeed(...parts: number[]): number {
    let h = 0x811c9dc5;
    for (const p of parts) {
        let v = Math.floor(p) | 0;
        for (let i = 0; i < 4; i++) {
            h ^= v & 0xff;
            h = Math.imul(h, 0x01000193);
            v >>>= 8;
        }
    }
    return h >>> 0;
}

/** Events straight from the steps (root + chord tones), after per-step probability. */
export function stepsToFxEvents(steps: readonly (Note | null)[], loopLength: number, rng: Rng): FxNoteEvent[] {
    const out: FxNoteEvent[] = [];
    const end = Math.min(steps.length, Math.max(0, Math.floor(loopLength)));
    for (let step = 0; step < end; step++) {
        const note = steps[step];
        if (!note) continue;
        if (note.probability !== undefined && note.probability < 1 && rng() > note.probability) continue;
        const mt = typeof note.microtiming === 'number' && Number.isFinite(note.microtiming) ? note.microtiming : 0;
        const start = Math.max(0, step + mt);
        const length = typeof note.length === 'number' && note.length > 0 ? note.length : 1;
        const velocity = typeof note.velocity === 'number' ? Math.min(1, Math.max(0, note.velocity)) : 1;
        const pitches = [noteToMidi(note.note), ...(note.chord ?? []).map(noteToMidi)];
        for (const pitch of pitches) {
            out.push({ start, length, pitch: clampPitch(pitch), velocity, sourceStep: step, slide: !!note.slide });
        }
    }
    return out;
}

type ChainAt = (step: number) => NoteFxChain;

function chordFx(events: FxNoteEvent[], at: ChainAt): FxNoteEvent[] {
    const out: FxNoteEvent[] = [];
    const seen = new Set<string>();
    const key = (e: FxNoteEvent) => `${e.sourceStep}:${e.start}:${e.pitch}`;
    for (const e of events) {
        if (seen.has(key(e))) continue;
        seen.add(key(e));
        out.push(e);
    }
    for (const e of events) {
        const p = at(e.sourceStep).chord;
        if (!p.enabled) continue;
        for (const interval of p.intervals) {
            if (interval === 0) continue;
            const pitch = e.pitch + interval;
            if (pitch < 0 || pitch > 127) continue;
            const added = { ...e, pitch };
            if (seen.has(key(added))) continue;
            seen.add(key(added));
            out.push(added);
        }
    }
    return out;
}

/** The arp's note order for one held chord. */
export function arpSequence(played: readonly number[], mode: NoteFxChain['arp']['mode'], octaves: number): number[] {
    const expanded: number[] = [];
    for (let o = 0; o < Math.max(1, octaves); o++) {
        for (const p of played) {
            const pitch = p + 12 * o;
            if (pitch <= 127 && !expanded.includes(pitch)) expanded.push(pitch);
        }
    }
    if (mode === 'played' || mode === 'random') return expanded;
    const up = [...expanded].sort((a, b) => a - b);
    if (mode === 'up') return up;
    const down = [...up].reverse();
    if (mode === 'down') return down;
    // updown: ping-pong without repeating the turnaround notes.
    return up.length > 2 ? up.concat(down.slice(1, -1)) : up;
}

function arpFx(events: FxNoteEvent[], at: ChainAt, rng: Rng): FxNoteEvent[] {
    const groups = new Map<number, FxNoteEvent[]>();
    for (const e of events) {
        const g = groups.get(e.sourceStep);
        if (g) g.push(e);
        else groups.set(e.sourceStep, [e]);
    }
    const out: FxNoteEvent[] = [];
    for (const [sourceStep, held] of groups) {
        const p = at(sourceStep).arp;
        if (!p.enabled) {
            out.push(...held);
            continue;
        }
        const start = Math.min(...held.map((e) => e.start));
        const end = Math.max(...held.map((e) => e.start + e.length));
        const velocity = Math.max(...held.map((e) => e.velocity));
        const order = arpSequence(held.map((e) => e.pitch), p.mode, p.octaves);
        const count = Math.max(1, Math.round((end - start) / p.rate));
        for (let k = 0; k < count; k++) {
            const noteStart = start + k * p.rate;
            const pitch = p.mode === 'random' ? order[Math.floor(rng() * order.length) % order.length] : order[k % order.length];
            const length = Math.max(0.05, Math.min(p.rate * p.gate, end - noteStart));
            out.push({ start: noteStart, length, pitch, velocity, sourceStep, slide: k === 0 && held[0].slide });
        }
    }
    return out;
}

function ratchetFx(events: FxNoteEvent[], at: ChainAt): FxNoteEvent[] {
    const out: FxNoteEvent[] = [];
    for (const e of events) {
        const p = at(e.sourceStep).ratchet;
        if (!p.enabled || p.count <= 1) {
            out.push(e);
            continue;
        }
        const slot = e.length / p.count;
        for (let r = 0; r < p.count; r++) {
            out.push({
                ...e,
                start: e.start + r * slot,
                length: Math.max(0.02, slot * p.gate),
                velocity: e.velocity * Math.pow(p.decay, r),
                slide: r === 0 && e.slide,
            });
        }
    }
    return out;
}

function euclidFx(events: FxNoteEvent[], at: ChainAt): FxNoteEvent[] {
    const patterns = new Map<string, boolean[]>();
    return events.filter((e) => {
        const p = at(e.sourceStep).euclid;
        if (!p.enabled) return true;
        const key = `${p.steps}:${p.pulses}`;
        let pattern = patterns.get(key);
        if (!pattern) {
            pattern = euclideanRhythm(p.steps, p.pulses);
            patterns.set(key, pattern);
        }
        if (pattern.length === 0) return false;
        const pos = Math.floor(e.start + EPS);
        const idx = (((pos - p.rotation) % p.steps) + p.steps) % p.steps;
        return pattern[idx];
    });
}

function humanizeFx(events: FxNoteEvent[], at: ChainAt, rng: Rng): FxNoteEvent[] {
    return events.map((e) => {
        const p = at(e.sourceStep).humanize;
        if (!p.enabled) return e;
        const dt = (rng() * 2 - 1) * p.timing;
        const dv = (rng() * 2 - 1) * p.velocity;
        return {
            ...e,
            start: Math.max(0, e.start + dt),
            velocity: Math.min(1, Math.max(0.05, e.velocity + dv)),
        };
    });
}

function byTime(a: FxNoteEvent, b: FxNoteEvent): number {
    return a.start - b.start || a.sourceStep - b.sourceStep || a.pitch - b.pitch;
}

/** Run the chain over one pass of the track's loop. */
export function renderNoteFx(steps: readonly (Note | null)[], chain: NoteFxChain, opts: NoteFxRenderOptions): FxNoteEvent[] {
    const loopLength = Math.max(0, Math.floor(opts.loopLength));
    const rng = seededRng(mixSeed(chain.seed, opts.iteration ?? 0, opts.salt ?? 0));
    const resolved = new Map<number, NoteFxChain>();
    const at: ChainAt = (step) => {
        let c = resolved.get(step);
        if (!c) {
            c = resolveChainAtStep(chain, step, opts.lookup);
            resolved.set(step, c);
        }
        return c;
    };

    let events = stepsToFxEvents(steps, loopLength, rng).sort(byTime);
    events = chordFx(events, at).sort(byTime);
    events = arpFx(events, at, rng).sort(byTime);
    events = ratchetFx(events, at).sort(byTime);
    events = euclidFx(events, at);
    events = humanizeFx(events, at, rng);

    const out: FxNoteEvent[] = [];
    for (const e of events) {
        const start = round9(e.start);
        if (start < 0 || start >= loopLength - EPS || e.length <= 0) continue;
        out.push({ ...e, start, length: round9(e.length), velocity: round9(e.velocity) });
    }
    return out.sort(byTime);
}

/**
 * The chain over a long, tiled sequence (stem export, song mode): one
 * `renderNoteFx` per loop pass, iteration = pass index — the same seeding the
 * live clock uses (`floor(absStep / loopLength)`). Passes start every
 * `loopLength` steps, or at `passStarts` when the timeline re-anchors the
 * loop (Song Mode restarts it at each measure).
 */
export function renderNoteFxTimeline(
    steps: readonly (Note | null)[],
    chain: NoteFxChain,
    opts: Omit<NoteFxRenderOptions, 'iteration'> & { passStarts?: readonly number[] },
): FxNoteEvent[] {
    const loop = Math.max(1, Math.floor(opts.loopLength));
    const starts = opts.passStarts?.length
        ? [...opts.passStarts].filter((s) => s >= 0 && s < steps.length).sort((a, b) => a - b)
        : Array.from({ length: Math.max(1, Math.ceil(steps.length / loop)) }, (_, i) => i * loop);
    const out: FxNoteEvent[] = [];
    starts.forEach((from, i) => {
        const to = Math.min(steps.length, starts[i + 1] ?? steps.length, from + loop);
        const chunk = steps.slice(from, to);
        for (const e of renderNoteFx(chunk, chain, { ...opts, loopLength: to - from, iteration: i })) {
            out.push({ ...e, start: round9(e.start + from), sourceStep: e.sourceStep + from });
        }
    });
    return out;
}

/** Loop-pass starts for a timeline of measures whose loops restart at each measure. */
export function measurePassStarts(measureStepCounts: readonly number[], loopLength: number): number[] {
    const loop = Math.max(1, Math.floor(loopLength));
    const out: number[] = [];
    let measureStart = 0;
    for (const count of measureStepCounts) {
        for (let s = 0; s < count; s += loop) out.push(measureStart + s);
        measureStart += count;
    }
    return out;
}

/** Events grouped by the step whose tick schedules them: `start ∈ [step, step + 1)`. */
export function bucketByStep(events: readonly FxNoteEvent[], loopLength: number): FxNoteEvent[][] {
    const buckets: FxNoteEvent[][] = Array.from({ length: Math.max(0, Math.floor(loopLength)) }, () => []);
    for (const e of events) {
        const step = Math.floor(e.start + EPS);
        if (step >= 0 && step < buckets.length) buckets[step].push(e);
    }
    return buckets;
}

/**
 * Events of one bucket grouped into simultaneous notes (same start, length,
 * velocity, source step) — one `playSynth` call each, so a chord stays a
 * chord on a polyphonic voice and a mono 303 gets one note-on.
 */
export function groupSimultaneous(events: readonly FxNoteEvent[]): FxNoteEvent[][] {
    const groups: FxNoteEvent[][] = [];
    for (const e of events) {
        const last = groups[groups.length - 1];
        const head = last?.[0];
        if (head && Math.abs(head.start - e.start) < EPS && head.length === e.length && head.velocity === e.velocity && head.sourceStep === e.sourceStep) {
            last.push(e);
        } else {
            groups.push([e]);
        }
    }
    return groups;
}
