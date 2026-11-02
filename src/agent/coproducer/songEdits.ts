/**
 * The co-producer's edits as pure functions over `SavedSongData`.
 *
 * Each takes the open song and a validated tool input and returns the next
 * song (the input is never mutated; untouched parts keep their identity) or
 * the reason it refused. The host commits the result as one undo step, so
 * these never see the store, the audio engine or the transport.
 *
 * Notes are written the way the AI song importer writes them (a velocity of
 * 0.8 and accent as `timbre`), and a note longer than one step clears the
 * steps it covers, as the step grid and the piano roll do
 * (`handlePatternChange`, `rollEdits.ts`).
 */

import type {
    Bass2Params,
    Note,
    PartSequence,
    SavedSongData,
    SynthParams,
    TrackKey,
    UnifiedAutomationLane,
} from '../../types';
import {
    addClip,
    projectArrangement,
    removeClip,
    setArrangementLength,
    updateClip,
} from '../../arrangement/model';
import { resolveSongMeter } from '../../utils/songMeter';
import { songArrangementOf } from './songDiff';
import { MAX_TRACK_PATTERN_SLOTS } from '../../constants';
import { AI_TRACK_TO_TRACK_KEY } from '../../importers/ai-song/songBlock';
import {
    AI_SONG_ACCENT_TIMBRE,
    AI_SONG_DEFAULT_LENGTH,
    AI_SONG_DEFAULT_VELOCITY,
    AI_SONG_DRUM_NOTES,
    AI_SONG_PLAIN_TIMBRE,
} from '../../importers/ai-song/AISongImporter';
import { MACRO_AUTOMATION_TARGETS, macroEngineForWaveform } from '../../engines/MacroParams';
import {
    BASS2_FIELD,
    BASS2_WAVEFORMS,
    LANE_PARAMETERS,
    SYNTH_WAVEFORMS,
    isDrumTrack,
    isMacroKnob,
    isMelodicTrack,
    knobsFor,
    type CoproducerTrack,
} from './knobs';

export type EditResult =
    | { ok: true; song: SavedSongData; notes: string[] }
    | { ok: false; error: string };

const fail = (error: string): EditResult => ({ ok: false, error });

type Storage = Record<TrackKey, (PartSequence | PartSequence[] | null)[]>;

export const songSteps = (song: SavedSongData): number => resolveSongMeter(song).stepCount;

function emptySteps(n: number): (Note | null)[] {
    return Array.from({ length: n }, () => null);
}

export { songArrangementOf as songArrangement } from './songDiff';

// ---------------------------------------------------------------------------
// edit_pattern
// ---------------------------------------------------------------------------

export interface StepEdit {
    step: number;
    action: 'set' | 'update' | 'clear';
    note?: string;
    velocity?: number;
    length?: number;
    accent?: boolean;
    slide?: boolean;
}

export interface EditPatternInput {
    track: CoproducerTrack;
    slot: number;
    bank?: number;
    clear?: boolean;
    edits: StepEdit[];
}

/** A length > 1 owns the steps it covers (`handlePatternChange`). */
function clearCovered(steps: (Note | null)[], step: number, length: number): void {
    for (let k = 1; k < length && step + k < steps.length; k++) steps[step + k] = null;
}

function newNote(track: CoproducerTrack, e: StepEdit): Note {
    if (isDrumTrack(track)) {
        return { note: AI_SONG_DRUM_NOTES[track], velocity: e.velocity ?? 1, length: 1, timbre: AI_SONG_PLAIN_TIMBRE };
    }
    const note: Note = { note: e.note!, velocity: e.velocity ?? AI_SONG_DEFAULT_VELOCITY, length: e.length ?? AI_SONG_DEFAULT_LENGTH };
    if (track === 'sampler') return note;
    if (e.slide) note.slide = true;
    note.timbre = e.accent ? AI_SONG_ACCENT_TIMBRE : AI_SONG_PLAIN_TIMBRE;
    return note;
}

function updatedNote(track: CoproducerTrack, existing: Note, e: StepEdit): Note {
    const next: Note = { ...existing };
    if (e.velocity !== undefined) next.velocity = e.velocity;
    if (isDrumTrack(track)) return next;
    if (e.note !== undefined) next.note = e.note;
    if (e.length !== undefined) next.length = e.length;
    if (track === 'sampler') return next;
    if (e.accent !== undefined) next.timbre = e.accent ? AI_SONG_ACCENT_TIMBRE : AI_SONG_PLAIN_TIMBRE;
    if (e.slide !== undefined) next.slide = e.slide;
    return next;
}

/** Targeted step edits on one track's pattern slot (and the live pattern when that slot is active). */
export function editPattern(song: SavedSongData, input: EditPatternInput): EditResult {
    const { track, slot } = input;
    const key = AI_TRACK_TO_TRACK_KEY[track];
    const sampler = track === 'sampler';
    if (slot >= MAX_TRACK_PATTERN_SLOTS) return fail(`slot ${slot}: there are ${MAX_TRACK_PATTERN_SLOTS} slots (0–${MAX_TRACK_PATTERN_SLOTS - 1})`);
    if (sampler && input.bank === undefined) return fail('sampler edits need a bank (0–7)');
    if (!sampler && input.bank !== undefined) return fail(`bank is for the sampler track only, not ${track}`);
    const bank = input.bank ?? 0;
    const steps = songSteps(song);
    const notes: string[] = [];

    const storage = song.trackStorage as Storage;
    const stored = storage[key]?.[slot] ?? null;
    const current = sampler ? (stored as PartSequence[] | null)?.[bank] : (stored as PartSequence | null);
    const length = Math.max(steps, current?.steps.length ?? 0);
    const next = input.clear ? emptySteps(length) : [...(current?.steps ?? []), ...emptySteps(length - (current?.steps.length ?? 0))];

    for (const [i, e] of input.edits.entries()) {
        const at = `edits[${i}]`;
        if (e.step >= steps) return fail(`${at}.step ${e.step} is past the end of the pattern (the song has ${steps} steps per pattern)`);
        if (e.action === 'clear') {
            next[e.step] = null;
            continue;
        }
        if (isDrumTrack(track) && (e.note !== undefined || e.accent !== undefined || e.slide !== undefined || e.length !== undefined)) {
            notes.push(`${at}: drum hits take only a velocity; note / length / accent / slide ignored`);
        }
        if (track === 'sampler' && (e.accent !== undefined || e.slide !== undefined)) {
            notes.push(`${at}: sampler steps have no accent or slide; ignored`);
        }
        if (e.action === 'set') {
            if (!isDrumTrack(track) && e.note === undefined) return fail(`${at}: set on ${track} needs a note`);
            const note = newNote(track, e);
            next[e.step] = note;
            clearCovered(next, e.step, note.length ?? 1);
        } else {
            const existing = next[e.step];
            if (!existing) return fail(`${at}: no note on step ${e.step} to update (use set)`);
            const note = updatedNote(track, existing, e);
            next[e.step] = note;
            if (e.length !== undefined && !isDrumTrack(track)) clearCovered(next, e.step, e.length);
        }
    }

    const seq: PartSequence = { ...(current ?? {}), steps: next };
    let content: PartSequence | PartSequence[];
    if (sampler) {
        const banks = [...((stored as PartSequence[] | null) ?? [])];
        for (let b = 0; b < 8; b++) banks[b] ??= { steps: emptySteps(steps) };
        banks[bank] = seq;
        content = banks;
    } else {
        content = seq;
    }
    const row = [...(storage[key] ?? [])];
    while (row.length < MAX_TRACK_PATTERN_SLOTS) row.push(null);
    row[slot] = content;
    const out: SavedSongData = { ...song, trackStorage: { ...storage, [key]: row } };
    if ((song.activeTrackSlots?.[key] ?? 0) === slot) {
        out.pattern = { ...song.pattern, [key]: content } as SavedSongData['pattern'];
    }
    return { ok: true, song: out, notes };
}

// ---------------------------------------------------------------------------
// set_params
// ---------------------------------------------------------------------------

export interface LaneInput {
    parameter: string;
    steps: (number | null)[];
    interpolation?: 'step' | 'linear' | 'smooth';
}

export interface SetParamsInput {
    track?: CoproducerTrack;
    bank?: number;
    slot?: number;
    knobs?: Record<string, number | string>;
    automation?: LaneInput[];
    clear_automation?: string[];
    tempo?: number;
    swing?: number;
}

type Knobs = Record<string, number | string>;

/** `params` with `knobs` written onto it, in its own field names. */
function writeKnobs(track: CoproducerTrack, params: object, knobs: Knobs): object {
    const next: Record<string, unknown> = { ...params };
    for (const [name, value] of Object.entries(knobs)) {
        if (isMacroKnob(name)) {
            next.macro = { ...(next.macro as object | undefined), [MACRO_AUTOMATION_TARGETS[name].field]: value };
        } else if (track === 'bass2') {
            next[BASS2_FIELD[name] ?? name] = value;
        } else {
            next[name] = value;
        }
    }
    return next;
}

function checkKnobs(track: CoproducerTrack, knobs: Knobs, waveform: string | undefined): string | null {
    const macro = (track === 'synthA' || track === 'synthB') && !!macroEngineForWaveform(waveform ?? '');
    const allowed = knobsFor(track, macro);
    for (const [name, value] of Object.entries(knobs)) {
        if (name === 'waveform') {
            const list = track === 'bass2' ? BASS2_WAVEFORMS : track === 'synthA' || track === 'synthB' ? SYNTH_WAVEFORMS : [];
            if (!list.includes(value as never)) {
                return list.length ? `${track} waveform "${String(value)}" is not one of: ${list.join(', ')}` : `${track} has no waveform knob`;
            }
            continue;
        }
        const spec = allowed[name];
        if (!spec) {
            const why = isMacroKnob(name) && !macro ? ` (macro knobs need a macro-* waveform on ${track})` : '';
            return `${name} is not a ${track} knob${why}. ${track} knobs: ${Object.keys(allowed).join(', ')}`;
        }
        if (typeof value !== 'number' || !Number.isFinite(value) || value < spec.min || value > spec.max) {
            return `${track}.${name} must be ${spec.min}–${spec.max}${spec.unit ? ` ${spec.unit}` : ''}, got ${String(value)}`;
        }
    }
    return null;
}

/** The knob part of `set_params`: live params, and per-slot 303 snapshots. */
function applyKnobs(song: SavedSongData, input: SetParamsInput & { track: CoproducerTrack }, knobs: Knobs): EditResult {
    const { track } = input;
    if (track === 'sampler') {
        const bank = input.bank!;
        const sampler = [...song.params.sampler];
        sampler[bank] = writeKnobs(track, sampler[bank], knobs) as (typeof sampler)[number];
        return { ok: true, song: { ...song, params: { ...song.params, sampler } }, notes: [] };
    }
    if (!isMelodicTrack(track)) {
        return { ok: true, song: { ...song, params: { ...song.params, [track]: writeKnobs(track, song.params[track], knobs) } }, notes: [] };
    }
    const key = AI_TRACK_TO_TRACK_KEY[track];
    const live: SynthParams | Bass2Params | undefined = song.params[track];
    // `trackParamStorage` always carries all three rows; a track has per-slot knobs when one is set.
    const snapshots = song.trackParamStorage?.[track]?.some(Boolean) ? song.trackParamStorage[track] : undefined;
    if (input.slot !== undefined && !snapshots) {
        return fail(`${track} has no per-slot knobs in this song; omit slot to set the track's knobs`);
    }
    const activeSlot = song.activeTrackSlots?.[key] ?? 0;
    const touchesLive = input.slot === undefined || input.slot === activeSlot;
    const params = { ...song.params, ...(touchesLive && live ? { [track]: writeKnobs(track, live, knobs) } : {}) };
    let trackParamStorage = song.trackParamStorage;
    if (snapshots) {
        const row = snapshots.map((snap, slot) => {
            if (input.slot !== undefined) {
                return slot === input.slot ? writeKnobs(track, snap ?? live ?? {}, knobs) : snap;
            }
            return snap ? writeKnobs(track, snap, knobs) : snap;
        });
        trackParamStorage = { ...song.trackParamStorage!, [track]: row as typeof snapshots };
    }
    return {
        ok: true,
        song: { ...song, params: params as SavedSongData['params'], ...(trackParamStorage ? { trackParamStorage } : {}) },
        notes: [],
    };
}

function laneFrom(track: CoproducerTrack, lane: LaneInput): UnifiedAutomationLane | null {
    const points = lane.steps.flatMap((v, step) => (v === null ? [] : [{ step, value: v / 127 }]));
    if (points.length === 0) return null;
    return {
        id: `coproducer-${track}-${lane.parameter}`,
        target: track,
        parameter: lane.parameter,
        name: `${track} ${lane.parameter}`,
        points,
        interpolation: lane.interpolation ?? 'step',
        source: 'ai',
        scope: 'song',
        enabled: true,
        originalRange: [0, 127],
    };
}

/** Knobs and song-wide lanes of one track, and the song's tempo and swing. */
export function setParams(song: SavedSongData, input: SetParamsInput): EditResult {
    const globals: Partial<SavedSongData> = {
        ...(input.tempo !== undefined ? { tempo: input.tempo } : {}),
        ...(input.swing !== undefined ? { swing: input.swing } : {}),
    };
    if (input.track === undefined) {
        if (input.knobs || input.automation || input.clear_automation || input.bank !== undefined || input.slot !== undefined) {
            return fail('knobs, automation, bank and slot need a track');
        }
        if (Object.keys(globals).length === 0) return fail('nothing to set: give a track with knobs or automation, or tempo / swing');
        return { ok: true, song: { ...song, ...globals }, notes: [] };
    }
    return setTrackParams({ ...song, ...globals }, { ...input, track: input.track }, Object.keys(globals).length > 0);
}

function setTrackParams(song: SavedSongData, input: SetParamsInput & { track: CoproducerTrack }, hasGlobals: boolean): EditResult {
    const { track } = input;
    if (track === 'sampler' && input.bank === undefined) return fail('sampler params need a bank (0–7)');
    if (track !== 'sampler' && input.bank !== undefined) return fail(`bank is for the sampler track only, not ${track}`);
    if (input.slot !== undefined && !isMelodicTrack(track)) return fail('slot is for synthA / synthB / bass2 only');
    const knobs = input.knobs ?? {};
    const lanes = input.automation ?? [];
    const cleared = input.clear_automation ?? [];
    if (Object.keys(knobs).length + lanes.length + cleared.length === 0) {
        if (hasGlobals) return { ok: true, song, notes: [] };
        return fail('nothing to set: give knobs, automation or clear_automation');
    }

    const waveform = typeof knobs.waveform === 'string'
        ? knobs.waveform
        : track === 'synthA' || track === 'synthB' ? song.params[track].waveform : undefined;
    const knobError = checkKnobs(track, knobs, waveform);
    if (knobError) return fail(knobError);

    const steps = songSteps(song);
    const allowedLanes = LANE_PARAMETERS[track];
    for (const [i, lane] of lanes.entries()) {
        if (!allowedLanes.includes(lane.parameter)) {
            return fail(allowedLanes.length
                ? `automation[${i}]: ${track}.${lane.parameter} never plays live. ${track} lanes: ${allowedLanes.join(', ')}`
                : `automation[${i}]: the live scheduler plays no ${track} lanes`);
        }
        if (lane.steps.length !== steps) {
            return fail(`automation[${i}].steps has ${lane.steps.length} values; the song has ${steps} steps per pattern`);
        }
    }
    for (const parameter of cleared) {
        if (!allowedLanes.includes(parameter)) return fail(`clear_automation: ${track} has no ${parameter} lane parameter`);
    }

    let next = song;
    const notes: string[] = [];
    if (Object.keys(knobs).length > 0) {
        const applied = applyKnobs(song, input, knobs);
        if (!applied.ok) return applied;
        next = applied.song;
    }
    if (lanes.length > 0 || cleared.length > 0) {
        const replaced = new Set([...lanes.map((l) => l.parameter), ...cleared]);
        const kept = (song.automationLanes ?? []).filter((l) => !(l.target === track && replaced.has(l.parameter)));
        const added = lanes.map((l) => laneFrom(track, l)).filter((l): l is UnifiedAutomationLane => l !== null);
        const automationLanes = [...kept, ...added];
        next = { ...next, automationLanes };
        if (automationLanes.length === 0) delete next.automationLanes;
    }
    const laneKeys = new Set((next.automationLanes ?? []).filter((l) => l.target === track && l.enabled).map((l) => l.parameter));
    for (const name of Object.keys(knobs)) {
        if (laneKeys.has(name)) notes.push(`${track}.${name} also has an automation lane; the lane wins on the steps it has values for`);
    }
    return { ok: true, song: next, notes };
}

// ---------------------------------------------------------------------------
// arrange
// ---------------------------------------------------------------------------

export interface ArrangeOp {
    op: 'place' | 'clear' | 'trim' | 'remove_clip' | 'set_length';
    track?: CoproducerTrack;
    slot?: number;
    start_measure?: number;
    measures?: number;
    loop?: boolean;
    clip_id?: string;
    start_step?: number;
    length_steps?: number;
    offset_steps?: number;
}

export interface ArrangeInput {
    ops: ArrangeOp[];
}

function slotHasNotes(song: SavedSongData, key: TrackKey, slot: number): boolean {
    const stored = (song.trackStorage as Storage)[key]?.[slot];
    const seqs = Array.isArray(stored) ? stored : stored ? [stored] : [];
    return seqs.some((s) => s?.steps?.some(Boolean));
}

/** Place, clear, trim and remove clips; one undo step for all of `ops`. */
export function arrange(song: SavedSongData, input: ArrangeInput): EditResult {
    const spm = songSteps(song);
    let arrangement = songArrangementOf(song);
    const notes: string[] = [];
    for (const [i, op] of input.ops.entries()) {
        const at = `ops[${i}] (${op.op})`;
        const need = (...fields: (keyof ArrangeOp)[]) => fields.find((f) => op[f] === undefined);
        if (op.op === 'place' || op.op === 'clear') {
            const missing = need('track', 'start_measure', ...(op.op === 'place' ? ['slot' as const] : []));
            if (missing) return fail(`${at} needs ${missing}`);
            const key = AI_TRACK_TO_TRACK_KEY[op.track!];
            const range = { track: key, startStep: op.start_measure! * spm, lengthSteps: (op.measures ?? 1) * spm };
            if (op.op === 'place') {
                if (!slotHasNotes(song, key, op.slot!)) notes.push(`${at}: ${op.track} slot ${op.slot} is empty — those measures are silent`);
                arrangement = addClip(arrangement, { ...range, patternSlot: op.slot!, loop: op.loop ?? true }).arrangement;
            } else {
                // A clip placed over the range cuts what is under it; removing it leaves silence.
                const placed = addClip(arrangement, { ...range, patternSlot: 0, loop: true });
                arrangement = { ...removeClip(placed.arrangement, placed.id), lengthSteps: arrangement.lengthSteps };
            }
        } else if (op.op === 'trim' || op.op === 'remove_clip') {
            if (!op.clip_id) return fail(`${at} needs clip_id`);
            if (!arrangement.clips.some((c) => c.id === op.clip_id)) {
                return fail(`${at}: no clip "${op.clip_id}" (get_song lists arrangement.clips)`);
            }
            if (op.op === 'remove_clip') {
                arrangement = removeClip(arrangement, op.clip_id);
                continue;
            }
            const patch = {
                ...(op.start_step !== undefined ? { startStep: op.start_step } : {}),
                ...(op.length_steps !== undefined ? { lengthSteps: op.length_steps } : {}),
                ...(op.offset_steps !== undefined ? { offsetSteps: op.offset_steps } : {}),
                ...(op.loop !== undefined ? { loop: op.loop } : {}),
            };
            if (Object.keys(patch).length === 0) return fail(`${at} needs start_step, length_steps, offset_steps or loop`);
            arrangement = updateClip(arrangement, op.clip_id, patch);
        } else {
            if (op.measures === undefined) return fail(`${at} needs measures`);
            arrangement = setArrangementLength(arrangement, op.measures * spm);
            if (arrangement.lengthSteps > op.measures * spm) notes.push(`${at}: clips run to step ${arrangement.lengthSteps}; the loop cannot cut them`);
        }
    }
    return {
        ok: true,
        song: { ...song, arrangement, songStructure: projectArrangement(arrangement, spm) },
        notes,
    };
}
