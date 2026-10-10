/**
 * Song meter: pattern length, time signature, per-track loop lengths, swing.
 *
 * The meter is song-wide — every pattern and every Song Mode measure share
 * `stepCount` and `timeSignature`. Per-track loop lengths let a track cycle
 * against the master loop (polyrhythm). See docs/audio-engine/pattern-length-meter.md.
 */

import { NUM_STEPS } from '@/constants';
import type { PartSequence, TrackKey } from '@/types/pattern';
import {
    DEFAULT_TIME_SIGNATURE,
    stepsPerBar,
    stepsPerBeat,
    type TimeSignature,
} from '@/utils/musicTheory';

export const MIN_STEPS = 1;
export const MAX_STEPS = 64;

/** Song swing (MPC percent) that plays straight. */
export const STRAIGHT_SWING = 50;
export const MAX_SWING = 75;

export type TrackLengths = Partial<Record<TrackKey, number>>;

export interface SongMeter {
    stepCount: number;
    timeSignature: TimeSignature;
    trackLengths: TrackLengths;
    /** MPC-style percent: 50 = straight, 75 = hardest. */
    swing: number;
}

export const DEFAULT_SONG_METER: SongMeter = {
    stepCount: NUM_STEPS,
    timeSignature: DEFAULT_TIME_SIGNATURE,
    trackLengths: {},
    swing: STRAIGHT_SWING,
};

/** Meters offered by the transport METER selector. */
export const METER_PRESETS: readonly TimeSignature[] = [
    [2, 4], [3, 4], [4, 4], [5, 4], [6, 8], [7, 8], [12, 8],
];

const BASE_LENGTH_PRESETS = [8, 12, 16, 24, 32, 48, 64];

const TRACK_KEYS: readonly TrackKey[] = [
    'partA', 'partB', 'bass2', 'kick', 'snare', 'closedHat', 'openHat', 'sampler',
];

export const isValidStepCount = (n: unknown): n is number =>
    typeof n === 'number' && Number.isInteger(n) && n >= MIN_STEPS && n <= MAX_STEPS;

export const isRepresentableTimeSignature = (ts: unknown): ts is TimeSignature =>
    Array.isArray(ts) &&
    ts.length === 2 &&
    typeof ts[0] === 'number' &&
    typeof ts[1] === 'number' &&
    stepsPerBar([ts[0], ts[1]]) !== null;

/** Length choices for a meter: the stock set plus 1–4 whole bars, sorted. */
export function lengthPresets(ts: TimeSignature): number[] {
    const bar = stepsPerBar(ts);
    const set = new Set(BASE_LENGTH_PRESETS);
    if (bar) {
        for (let bars = 1; bars <= 4 && bar * bars <= MAX_STEPS; bars++) set.add(bar * bars);
    }
    return [...set].sort((a, b) => a - b);
}

/** Next preset above/below `current` (clamped at the ends). */
export function stepLengthPreset(current: number, direction: 1 | -1, ts: TimeSignature): number {
    const presets = lengthPresets(ts);
    if (direction > 0) return presets.find((p) => p > current) ?? presets[presets.length - 1];
    for (let i = presets.length - 1; i >= 0; i--) {
        if (presets[i] < current) return presets[i];
    }
    return presets[0];
}

/** Next loop length in the cycle; `null` means "follow the pattern length". */
export function cycleTrackLength(current: number | null, direction: 1 | -1, ts: TimeSignature): number | null {
    const options: (number | null)[] = [null, ...lengthPresets(ts)];
    let idx = options.indexOf(current);
    if (idx === -1) {
        // A loaded length outside the presets: step from its sorted position.
        const above = options.findIndex((o) => o !== null && o > (current ?? 0));
        idx = above === -1 ? options.length : above;
        if (direction > 0) idx -= 1;
    }
    const n = options.length;
    return options[(((idx + direction) % n) + n) % n];
}

/**
 * Validate the meter fields of a saved song. Songs saved before v4 (or with
 * garbage in these fields) resolve to 32 steps, 4/4, straight.
 */
export function resolveSongMeter(data: {
    stepCount?: unknown;
    timeSignature?: unknown;
    trackLengths?: unknown;
    swing?: unknown;
} | null | undefined): SongMeter {
    if (!data) return { ...DEFAULT_SONG_METER, trackLengths: {} };
    const trackLengths: TrackLengths = {};
    if (data.trackLengths && typeof data.trackLengths === 'object') {
        const raw = data.trackLengths as Record<string, unknown>;
        for (const key of TRACK_KEYS) {
            if (isValidStepCount(raw[key])) trackLengths[key] = raw[key];
        }
    }
    const swing = typeof data.swing === 'number' && Number.isFinite(data.swing)
        ? Math.max(0, Math.min(100, data.swing))
        : STRAIGHT_SWING;
    return {
        stepCount: isValidStepCount(data.stepCount) ? data.stepCount : NUM_STEPS,
        timeSignature: isRepresentableTimeSignature(data.timeSignature)
            ? [data.timeSignature[0], data.timeSignature[1]]
            : DEFAULT_TIME_SIGNATURE,
        trackLengths,
        swing,
    };
}

/** Clock geometry handed to the session launcher. */
export interface TransportGrid {
    patternSteps: number;
    stepsPerBeat: number;
    stepsPerBar: number;
}

export function transportGrid(meter: Pick<SongMeter, 'stepCount' | 'timeSignature'>): TransportGrid {
    return {
        patternSteps: meter.stepCount,
        stepsPerBeat: stepsPerBeat(meter.timeSignature),
        stepsPerBar: stepsPerBar(meter.timeSignature) ?? 16,
    };
}

/** Loop length for a track: its own override, else the pattern length. */
export function trackLoopLength(meter: Pick<SongMeter, 'stepCount' | 'trackLengths'>, key: TrackKey): number {
    return meter.trackLengths[key] ?? meter.stepCount;
}

/**
 * Step a track reads on this clock tick.
 *
 * - No override: the clock step (the clock already wraps at `stepCount`).
 * - Pattern/session mode: free-running — absolute steps since PLAY modulo the
 *   track's own length, so 12 against 16 phases and realigns every 48 steps.
 * - Song Mode: re-anchored at each measure, because the measure may swap slots.
 */
export function trackStepFor(
    meter: Pick<SongMeter, 'trackLengths'>,
    key: TrackKey,
    step: number,
    absStep: number,
    songMode: boolean,
): number {
    const len = meter.trackLengths[key];
    if (!len) return step;
    const phase = songMode ? step : absStep;
    return ((phase % len) + len) % len;
}

/** Grid columns the sequencer draws: the longest of the pattern and every track loop. */
export function gridColumns(meter: Pick<SongMeter, 'stepCount' | 'trackLengths'>): number {
    let cols = meter.stepCount;
    for (const len of Object.values(meter.trackLengths)) {
        if (len && len > cols) cols = len;
    }
    return cols;
}

/** Grow `steps` to at least `n` entries with `null`. Never truncates; returns the same array when long enough. */
export function padSteps<T>(steps: (T | null)[], n: number): (T | null)[] {
    if (steps.length >= n) return steps;
    const out = steps.slice();
    for (let i = steps.length; i < n; i++) out[i] = null;
    return out;
}

/**
 * Fill exactly `length` steps for one measure by looping `seq` at `loopLength`.
 * Used by offline paths (song timeline, XM) so exports match live polyrhythm.
 */
export function tileSteps<T>(steps: readonly (T | null | undefined)[] | undefined, length: number, loopLength: number): (T | null)[] {
    const out = new Array<T | null>(length);
    const len = loopLength > 0 ? loopLength : length;
    for (let i = 0; i < length; i++) out[i] = steps?.[i % len] ?? null;
    return out;
}

/** `tileSteps` for a whole `PartSequence`, including its per-step automation arrays. */
export function tilePartSequence(seq: PartSequence | null | undefined, length: number, loopLength: number): PartSequence {
    const out: PartSequence = { steps: tileSteps(seq?.steps, length, loopLength) };
    if (seq?.automation) {
        out.automation = {};
        for (const [param, values] of Object.entries(seq.automation)) {
            out.automation[param] = tileSteps(values, length, loopLength);
        }
    }
    return out;
}
