// Pattern generation and humanization utilities.
//
// All functions are pure (no side effects, no globals). A `Rng` (random number
// generator) function can be injected for deterministic/seeded output; when
// omitted, `Math.random` is used. This keeps the functions testable and the
// sequencer replayable when a seed is stored with the song.

import type { PartSequence, Note } from '@/types';
import { SCALE_INTERVALS, NOTES, midiToNote } from '@/utils/musicTheory';

// ── Seeded RNG (mulberry32) ─────────────────────────────────────────────────

/** Simple 32-bit seeded pseudo-random number generator (mulberry32). */
export function seededRng(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s |= 0;
        s = (s + 0x6d2b79f5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
    };
}

export type Rng = () => number;

// ── Euclidean rhythm ─────────────────────────────────────────────────────────
//
// Distributes `hits` pulses as evenly as possible across `steps` positions.
// Implemented via Bresenham's line algorithm — same results as Bjorklund for
// all practical inputs and simpler to follow.
//
// Musical examples (16-step context):
//   E(16, 4)  → basic kick pattern (every beat)
//   E(16, 3)  → Afro-Cuban clave (1-0-0-0-1-0-0-1-0-0-0-0-1-0-0-0 rotated)
//   E(16, 5)  → quintuplet feel (common in folk/world music)
//   E(16, 7)  → West African bell pattern
//   E(8,  3)  → 8th-note tresillo

export function euclideanRhythm(steps: number, hits: number): boolean[] {
    if (steps <= 0) return [];
    const k = Math.max(0, Math.min(hits, steps));
    if (k === 0) return Array<boolean>(steps).fill(false);
    if (k === steps) return Array<boolean>(steps).fill(true);

    const pattern: boolean[] = [];
    let bucket = 0;
    for (let i = 0; i < steps; i++) {
        bucket += k;
        if (bucket >= steps) {
            bucket -= steps;
            pattern.push(true);
        } else {
            pattern.push(false);
        }
    }
    return pattern;
}

// ── Drum-track randomizer ─────────────────────────────────────────────────────

export interface DrumRandomizeOptions {
    /** 0–1, fraction of steps that should have a hit. Default 0.25. */
    density?: number;
    /** Prefer euclidean distribution when true (more musical). Default true. */
    euclidean?: boolean;
    /** Fixed note to use (e.g. 'C4'). Default 'C4'. */
    note?: string;
    /** Default velocity 0–1. Default 0.8. */
    velocity?: number;
    /** Velocity variation 0–1. Default 0.2. */
    velocityVariation?: number;
    rng?: Rng;
}

/**
 * Generate a random drum PartSequence.
 * Euclidean distribution produces more musical results than pure random placement.
 */
export function randomizeDrumTrack(
    steps: number,
    options: DrumRandomizeOptions = {},
): PartSequence {
    const {
        density = 0.25,
        euclidean: useEuclidean = true,
        note = 'C4',
        velocity = 0.8,
        velocityVariation = 0.2,
        rng = Math.random,
    } = options;

    const hits = Math.round(steps * Math.max(0, Math.min(1, density)));
    const hitPattern = useEuclidean
        ? euclideanRhythm(steps, hits)
        : Array.from({ length: steps }, () => rng() < density);

    const resultSteps = hitPattern.map((active): Note | null => {
        if (!active) return null;
        const v = Math.max(0.01, Math.min(1, velocity + (rng() * 2 - 1) * velocityVariation));
        return { note, velocity: v, length: 1 };
    });

    return { steps: resultSteps };
}

// ── Melodic-track randomizer ──────────────────────────────────────────────────

export interface MelodicRandomizeOptions {
    /** 0–1 fraction of steps that should have a note. Default 0.35. */
    density?: number;
    /** Root note, e.g. 'C'. Default 'C'. */
    root?: string;
    /** Scale name from SCALE_INTERVALS. Default 'Minor'. */
    scale?: string;
    /** [min, max] MIDI octave numbers. Default [3, 5]. */
    octaveRange?: [number, number];
    /** Default gate length in steps. Default 1. */
    length?: number;
    /** Add slide on consecutive steps when true. Default false. */
    addSlide?: boolean;
    /** 0–1 probability that a step repeats the previous note (adds musical coherence). */
    repeatProbability?: number;
    rng?: Rng;
}

/**
 * Generate a random melodic PartSequence using notes from a given scale.
 * `repeatProbability` creates runs of the same pitch, making patterns feel
 * more intentional rather than purely random.
 */
export function randomizeMelodicTrack(
    steps: number,
    options: MelodicRandomizeOptions = {},
): PartSequence {
    const {
        density = 0.35,
        root = 'C',
        scale = 'Minor',
        octaveRange = [3, 5],
        length = 1,
        addSlide = false,
        repeatProbability = 0.25,
        rng = Math.random,
    } = options;

    const intervals = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS['Minor'];
    const rootIndex = NOTES.indexOf(root);
    const [minOct, maxOct] = octaveRange;

    // Build the pool of MIDI notes for the given scale + octave range.
    const pool: number[] = [];
    for (let oct = minOct; oct <= maxOct; oct++) {
        for (const interval of intervals) {
            pool.push((oct + 1) * 12 + ((rootIndex + interval) % 12));
        }
    }
    if (pool.length === 0) return { steps: Array.from({ length: steps }, (): Note | null => null) };
    pool.sort((a, b) => a - b);

    const resultSteps: (Note | null)[] = [];
    let lastMidi: number | null = null;

    for (let i = 0; i < steps; i++) {
        if (rng() >= density) {
            resultSteps.push(null);
            continue;
        }

        let midi: number;
        if (lastMidi !== null && rng() < repeatProbability) {
            midi = lastMidi;
        } else {
            midi = pool[Math.floor(rng() * pool.length)]!;
        }
        lastMidi = midi;

        const prevStep = resultSteps[i - 1];
        const slide = addSlide && prevStep !== null && rng() < 0.3;

        resultSteps.push({
            note: midiToNote(midi),
            velocity: 0.7 + rng() * 0.3,
            length,
            slide,
        });
    }

    return { steps: resultSteps };
}

// ── Humanization ──────────────────────────────────────────────────────────────

export interface HumanizeOptions {
    /** 0–1 velocity scatter. Default 0.15. */
    velocityAmount?: number;
    /** 0–1 timing scatter (as fraction of step duration). Default 0.05. */
    timingAmount?: number;
    rng?: Rng;
}

/**
 * Add subtle velocity and microtiming variation to an existing PartSequence.
 * Leaves null steps untouched. Returns a new PartSequence (immutable).
 */
export function humanizePattern(
    seq: PartSequence,
    options: HumanizeOptions = {},
): PartSequence {
    const { velocityAmount = 0.15, timingAmount = 0.05, rng = Math.random } = options;

    const newSteps = seq.steps.map((step): Note | null => {
        if (!step) return null;
        const velOffset = (rng() * 2 - 1) * velocityAmount;
        const timingOffset = (rng() * 2 - 1) * timingAmount;
        return {
            ...step,
            velocity: Math.max(0.01, Math.min(1, step.velocity + velOffset)),
            ...(timingAmount > 0 ? { microtiming: (step.microtiming ?? 0) + timingOffset } : {}),
        };
    });

    return { ...seq, steps: newSteps };
}

// ── Groove templates ──────────────────────────────────────────────────────────
//
// A groove template is an array of microtiming offsets (fraction of step duration)
// and velocity multipliers, one entry per step position (wraps if pattern is longer).
// Positive timing = note plays late; negative = early.
//
// These values are grounded in well-known classic hardware grooves.

export interface GrooveStep {
    timing: number;   // fraction of step duration, typically –0.15 … +0.25
    velocity: number; // multiplier, 0.5 – 1.2
}

export interface GrooveTemplate {
    name: string;
    description: string;
    steps: GrooveStep[];   // length = groove period (usually 16)
}

/** Apply a groove template to a PartSequence, modifying microtiming and velocity. */
export function applyGrooveTemplate(seq: PartSequence, groove: GrooveTemplate): PartSequence {
    const period = groove.steps.length;
    const newSteps = seq.steps.map((step, i): Note | null => {
        if (!step) return null;
        const g = groove.steps[i % period]!;
        return {
            ...step,
            microtiming: g.timing,
            velocity: Math.max(0.01, Math.min(1, step.velocity * g.velocity)),
        };
    });
    return { ...seq, steps: newSteps };
}

// Pre-built groove templates. All use a 16-step period.

const straight: GrooveStep[] = Array.from({ length: 16 }, () => ({ timing: 0, velocity: 1 }));

// Classic 16th-note shuffle: odd steps (+1, +3, …) laid slightly back.
// Mimics the feel of MPC swing without removing beat-level timing.
const shuffleLight: GrooveStep[] = Array.from({ length: 16 }, (_, i) => ({
    timing: i % 2 === 1 ? 0.07 : 0,
    velocity: i % 2 === 1 ? 0.88 : 1,
}));

const shuffleHard: GrooveStep[] = Array.from({ length: 16 }, (_, i) => ({
    timing: i % 2 === 1 ? 0.14 : 0,
    velocity: i % 2 === 1 ? 0.80 : 1,
}));

// Funk: beats 1 and 3 (steps 0, 8) pushed, beat-2 e-and (steps 4-5) laid back.
const funk: GrooveStep[] = [
    { timing: -0.02, velocity: 1.10 },  // beat 1
    { timing:  0.06, velocity: 0.85 },
    { timing:  0.03, velocity: 0.90 },
    { timing:  0.09, velocity: 0.80 },
    { timing:  0.0,  velocity: 0.95 },  // beat 2
    { timing:  0.10, velocity: 0.78 },
    { timing:  0.04, velocity: 0.88 },
    { timing:  0.07, velocity: 0.82 },
    { timing: -0.02, velocity: 1.05 },  // beat 3
    { timing:  0.06, velocity: 0.85 },
    { timing:  0.03, velocity: 0.90 },
    { timing:  0.08, velocity: 0.82 },
    { timing:  0.01, velocity: 0.92 },  // beat 4
    { timing:  0.11, velocity: 0.76 },
    { timing:  0.05, velocity: 0.86 },
    { timing:  0.08, velocity: 0.80 },
];

// Bossa nova: laid-back on every 2nd 16th in a 2-step clave cycle.
const bossa: GrooveStep[] = [
    { timing:  0.0,  velocity: 1.0  },
    { timing:  0.12, velocity: 0.75 },
    { timing:  0.0,  velocity: 0.95 },
    { timing:  0.08, velocity: 0.80 },
    { timing: -0.03, velocity: 1.0  },
    { timing:  0.10, velocity: 0.78 },
    { timing:  0.0,  velocity: 0.92 },
    { timing:  0.09, velocity: 0.82 },
    { timing:  0.0,  velocity: 1.0  },
    { timing:  0.11, velocity: 0.76 },
    { timing:  0.0,  velocity: 0.94 },
    { timing:  0.08, velocity: 0.80 },
    { timing: -0.02, velocity: 0.98 },
    { timing:  0.12, velocity: 0.74 },
    { timing:  0.0,  velocity: 0.90 },
    { timing:  0.09, velocity: 0.81 },
];

export const GROOVE_TEMPLATES: Record<string, GrooveTemplate> = {
    straight: { name: 'Straight', description: 'Perfect 16th-note grid — no timing variation', steps: straight },
    shuffleLight: { name: 'Light Shuffle', description: 'Subtle triplet feel, offbeats ~7% late', steps: shuffleLight },
    shuffleHard: { name: 'Hard Shuffle', description: 'Strong triplet feel, offbeats ~14% late', steps: shuffleHard },
    funk: { name: 'Funk', description: 'Beat 1 pushed, offbeats laid back — classic funk pocket', steps: funk },
    bossa: { name: 'Bossa Nova', description: 'Brazilian clave-inspired lay-back feel', steps: bossa },
};
