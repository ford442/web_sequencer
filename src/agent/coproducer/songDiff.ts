/**
 * What a co-producer edit changed, small enough to hand back to the model
 * instead of the song: steps per pattern slot, knobs, lanes, Song Mode rows,
 * tempo and meter. The panel uses the same diff to flash the steps that moved.
 */

import type { Note, PartSequence, SavedSongData, TrackKey } from '../../types';
import type { Arrangement } from '../../types/song';
import type { SongStructure } from '../../types/songMode';
import { TRACK_KEYS } from '../../constants';
import { normalizeArrangement, projectArrangement, songStructureToArrangement } from '../../arrangement/model';
import { resolveSongMeter } from '../../utils/songMeter';
import { AI_TRACK_TO_TRACK_KEY, AI_SONG_TRACK_NAMES } from '../../importers/ai-song/songBlock';
import type { AISongTrackName } from '../../importers/ai-song/types';

/** AI track name of each Hyphon track key (`partA` → `synthA`). */
export const TRACK_NAME: Readonly<Record<TrackKey, AISongTrackName>> = Object.fromEntries(
    AI_SONG_TRACK_NAMES.map((name) => [AI_TRACK_TO_TRACK_KEY[name], name]),
) as Record<TrackKey, AISongTrackName>;

export interface StepChange {
    step: number;
    /** `C3 v0.8 len2 accent slide`, `hit` for a drum at velocity 1, null for a rest. */
    before: string | null;
    after: string | null;
}

export interface PatternChange {
    track: AISongTrackName;
    slot: number;
    bank?: number;
    /** Every changed step, up to {@link MAX_LISTED_STEPS}; `changedSteps` counts them all. */
    steps: StepChange[];
    changedSteps: number;
}

export interface KnobChange {
    track: AISongTrackName;
    /** Set for a sampler bank or a per-slot 303 snapshot. */
    bank?: number;
    slot?: number;
    knob: string;
    from: unknown;
    to: unknown;
}

export interface SongChange {
    changed: boolean;
    patterns: PatternChange[];
    knobs: KnobChange[];
    lanes: { added: string[]; removed: string[]; changed: string[] };
    /** Measures whose row changed (0-based) and the measure count before / after. */
    measures: { changed: number[]; from: number; to: number };
    /** Arrangement clips by id (a trim inside a measure changes a clip, not a row). */
    clips: { added: string[]; removed: string[]; changed: string[] };
    globals: Array<{ field: 'tempo' | 'stepCount' | 'timeSignature' | 'swing'; from: unknown; to: unknown }>;
}

export const MAX_LISTED_STEPS = 32;

const DRUM_KEYS: ReadonlySet<TrackKey> = new Set(['kick', 'snare', 'closedHat', 'openHat']);

function describeNote(note: Note | null | undefined, drum: boolean): string | null {
    if (!note) return null;
    if (drum) return note.velocity === 1 || note.velocity === undefined ? 'hit' : `hit v${round3(note.velocity)}`;
    const parts = [note.note, `v${round3(note.velocity)}`];
    if (note.length !== undefined && note.length !== 1) parts.push(`len${round3(note.length)}`);
    if (note.timbre !== undefined && note.timbre > 0.75) parts.push('accent');
    if (note.slide) parts.push('slide');
    if (note.chord?.length) parts.push(`chord ${note.chord.join('/')}`);
    return parts.join(' ');
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

function sameJson(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function stepChanges(before: PartSequence | null | undefined, after: PartSequence | null | undefined, drum: boolean): StepChange[] {
    const a = before?.steps ?? [];
    const b = after?.steps ?? [];
    const out: StepChange[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (sameJson(a[i] ?? null, b[i] ?? null)) continue;
        out.push({ step: i, before: describeNote(a[i], drum), after: describeNote(b[i], drum) });
    }
    return out;
}

type Storage = Partial<Record<TrackKey, (PartSequence | PartSequence[] | null)[]>>;

function patternChanges(before: SavedSongData, after: SavedSongData): PatternChange[] {
    const out: PatternChange[] = [];
    const a = before.trackStorage as Storage;
    const b = after.trackStorage as Storage;
    const push = (key: TrackKey, slot: number, bank: number | undefined, x: PartSequence | null | undefined, y: PartSequence | null | undefined) => {
        const steps = stepChanges(x, y, DRUM_KEYS.has(key));
        if (steps.length === 0) return;
        out.push({
            track: TRACK_NAME[key],
            slot,
            ...(bank !== undefined ? { bank } : {}),
            steps: steps.slice(0, MAX_LISTED_STEPS),
            changedSteps: steps.length,
        });
    };
    for (const key of TRACK_KEYS) {
        const rowA = a[key] ?? [];
        const rowB = b[key] ?? [];
        for (let slot = 0; slot < Math.max(rowA.length, rowB.length); slot++) {
            const x = rowA[slot] ?? null;
            const y = rowB[slot] ?? null;
            if (x === y) continue;
            if (key === 'sampler') {
                const banksA = (x as PartSequence[] | null) ?? [];
                const banksB = (y as PartSequence[] | null) ?? [];
                for (let bank = 0; bank < Math.max(banksA.length, banksB.length); bank++) push(key, slot, bank, banksA[bank], banksB[bank]);
            } else {
                push(key, slot, undefined, x as PartSequence | null, y as PartSequence | null);
            }
        }
    }
    return out;
}

function flatKnobs(params: unknown): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!params || typeof params !== 'object') return out;
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
        if (k === 'macro' && v && typeof v === 'object') {
            for (const [mk, mv] of Object.entries(v as Record<string, unknown>)) out[`macro.${mk}`] = mv;
        } else {
            out[k] = v;
        }
    }
    return out;
}

function knobDiff(
    track: AISongTrackName,
    a: unknown,
    b: unknown,
    where: { bank?: number; slot?: number } = {},
): KnobChange[] {
    if (a === b) return [];
    const x = flatKnobs(a);
    const y = flatKnobs(b);
    const out: KnobChange[] = [];
    for (const knob of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (sameJson(x[knob], y[knob])) continue;
        out.push({ track, ...where, knob, from: x[knob] ?? null, to: y[knob] ?? null });
    }
    return out;
}

function knobChanges(before: SavedSongData, after: SavedSongData): KnobChange[] {
    const out: KnobChange[] = [];
    for (const track of ['synthA', 'synthB', 'bass2', 'kick', 'snare', 'closedHat', 'openHat'] as const) {
        out.push(...knobDiff(track, before.params[track], after.params[track]));
    }
    const banks = Math.max(before.params.sampler?.length ?? 0, after.params.sampler?.length ?? 0);
    for (let bank = 0; bank < banks; bank++) {
        out.push(...knobDiff('sampler', before.params.sampler?.[bank], after.params.sampler?.[bank], { bank }));
    }
    for (const track of ['synthA', 'synthB', 'bass2'] as const) {
        const a = before.trackParamStorage?.[track] ?? [];
        const b = after.trackParamStorage?.[track] ?? [];
        for (let slot = 0; slot < Math.max(a.length, b.length); slot++) {
            out.push(...knobDiff(track, a[slot] ?? null, b[slot] ?? null, { slot }));
        }
    }
    return out;
}

function laneChanges(before: SavedSongData, after: SavedSongData): SongChange['lanes'] {
    const byKey = (song: SavedSongData) => {
        const map = new Map<string, string>();
        for (const lane of song.automationLanes ?? []) {
            const key = `${lane.target}.${lane.parameter}`;
            const body = JSON.stringify({ points: lane.points, interpolation: lane.interpolation, enabled: lane.enabled, scope: lane.scope, timeline: lane.timeline });
            map.set(key, (map.get(key) ?? '') + body);
        }
        return map;
    };
    const a = byKey(before);
    const b = byKey(after);
    return {
        added: [...b.keys()].filter((k) => !a.has(k)),
        removed: [...a.keys()].filter((k) => !b.has(k)),
        changed: [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k)),
    };
}

/** The arrangement `song` plays (v1–v4 songs derive it from Song Mode rows, as load does). */
export function songArrangementOf(song: SavedSongData): Arrangement {
    const steps = resolveSongMeter(song).stepCount;
    return normalizeArrangement(song.arrangement)
        ?? songStructureToArrangement((song.songStructure ?? []) as Array<Partial<Record<TrackKey, unknown>>>, steps);
}

/** Song Mode rows of `song` (as the exporter reads them). */
export function songModeRows(song: SavedSongData): SongStructure {
    const arrangement = songArrangementOf(song);
    return arrangement.clips.length > 0 ? projectArrangement(arrangement, resolveSongMeter(song).stepCount) : [];
}

function measureChanges(before: SavedSongData, after: SavedSongData): SongChange['measures'] {
    if (before.arrangement === after.arrangement && before.songStructure === after.songStructure) {
        const n = songModeRows(after).length;
        return { changed: [], from: n, to: n };
    }
    const a = songModeRows(before);
    const b = songModeRows(after);
    const changed: number[] = [];
    for (let m = 0; m < Math.max(a.length, b.length); m++) {
        if (!sameJson(a[m] ?? null, b[m] ?? null)) changed.push(m);
    }
    return { changed, from: a.length, to: b.length };
}

function clipChanges(before: SavedSongData, after: SavedSongData): SongChange['clips'] {
    const none = { added: [], removed: [], changed: [] };
    if (before.arrangement === after.arrangement && before.songStructure === after.songStructure) return none;
    const byId = (song: SavedSongData) => new Map(songArrangementOf(song).clips.map((c) => [c.id, JSON.stringify(c)]));
    const a = byId(before);
    const b = byId(after);
    return {
        added: [...b.keys()].filter((id) => !a.has(id)),
        removed: [...a.keys()].filter((id) => !b.has(id)),
        changed: [...b.keys()].filter((id) => a.has(id) && a.get(id) !== b.get(id)),
    };
}

function globalChanges(before: SavedSongData, after: SavedSongData): SongChange['globals'] {
    const out: SongChange['globals'] = [];
    const ma = resolveSongMeter(before);
    const mb = resolveSongMeter(after);
    if (before.tempo !== after.tempo) out.push({ field: 'tempo', from: before.tempo, to: after.tempo });
    if (ma.stepCount !== mb.stepCount) out.push({ field: 'stepCount', from: ma.stepCount, to: mb.stepCount });
    if (!sameJson(ma.timeSignature, mb.timeSignature)) out.push({ field: 'timeSignature', from: ma.timeSignature, to: mb.timeSignature });
    if (ma.swing !== mb.swing) out.push({ field: 'swing', from: ma.swing, to: mb.swing });
    return out;
}

/** What turned `before` into `after`. */
export function diffSongs(before: SavedSongData, after: SavedSongData): SongChange {
    const patterns = patternChanges(before, after);
    const knobs = knobChanges(before, after);
    const lanes = laneChanges(before, after);
    const measures = measureChanges(before, after);
    const clips = clipChanges(before, after);
    const globals = globalChanges(before, after);
    const count = (x: { added: string[]; removed: string[]; changed: string[] }) => x.added.length + x.removed.length + x.changed.length;
    const changed = patterns.length > 0 || knobs.length > 0 || count(lanes) > 0 || count(clips) > 0
        || measures.changed.length > 0 || measures.from !== measures.to || globals.length > 0;
    return { changed, patterns, knobs, lanes, measures, clips, globals };
}
