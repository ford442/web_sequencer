/**
 * Labels for the history panel (#1597 P2): what one undo step did, from the
 * song fields before its first change and after its last.
 *
 * A step coalesces every write of one gesture (all the cells of a paint drag,
 * every pointer move of a knob drag), so a label compares the step's earliest
 * "before" with its latest "after": "paint 8 steps", "Synth A: Cutoff 0.42 →
 * 0.71", "move clip". Pure, Yjs-free, and allowed to be approximate — it only
 * names a step, it never decides what the step undoes.
 */

import type { SongField, SongFieldValues } from './binding';

type Json = unknown;
type Obj = Record<string, unknown>;

const isObj = (v: Json): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

const TRACK_NAMES: Record<string, string> = {
    partA: 'Synth A',
    partB: 'Synth B',
    bass2: 'Bass 2',
    kick: 'Kick',
    snare: 'Snare',
    closedHat: 'Closed hat',
    openHat: 'Open hat',
    sampler: 'Sampler',
};

const INSTRUMENT_NAMES: Record<string, string> = {
    synthA: 'Synth A',
    synthB: 'Synth B',
    bass2: 'Bass 2',
    kick: 'Kick',
    snare: 'Snare',
    closedHat: 'Closed hat',
    openHat: 'Open hat',
    sampler: 'Sampler',
};

const PARAM_NAMES: Record<string, string> = {
    filterCutoff: 'Cutoff',
    filterResonance: 'Resonance',
    cutoff: 'Cutoff',
    resonance: 'Resonance',
    envMod: 'Env mod',
};

const MIXER_NAMES: Partial<Record<SongField, string>> = {
    tempo: 'Tempo',
    swing: 'Swing',
    stepCount: 'Pattern length',
    timeSignature: 'Time signature',
    trackLengths: 'Track lengths',
    ambianceUrl: 'Ambiance',
};

/** `filterEnvAmount` → `Filter env amount`. */
export function humanizeKey(key: string): string {
    if (PARAM_NAMES[key]) return PARAM_NAMES[key];
    const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatValue(value: Json): string {
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) return String(value);
        if (Number.isInteger(value) || Math.abs(value) >= 100) return String(Math.round(value));
        return String(Math.round(value * 100) / 100);
    }
    if (typeof value === 'boolean') return value ? 'on' : 'off';
    if (typeof value === 'string') return value.length > 16 ? `${value.slice(0, 15)}…` : value;
    if (value === undefined || value === null) return '—';
    return '…';
}

const same = (a: Json, b: Json): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Every `{ steps }` sequence of a pattern, keyed `track` or `sampler.N`. */
function sequences(pattern: Json): Map<string, Obj> {
    const out = new Map<string, Obj>();
    if (!isObj(pattern)) return out;
    for (const [key, value] of Object.entries(pattern)) {
        if (key === 'sampler' && Array.isArray(value)) {
            value.forEach((bank, i) => {
                if (isObj(bank)) out.set(`sampler.${i}`, bank);
            });
        } else if (isObj(value)) {
            out.set(key, value);
        }
    }
    return out;
}

function trackLabel(key: string): string {
    if (key.startsWith('sampler.')) return `Sampler bank ${Number(key.slice(8)) + 1}`;
    return TRACK_NAMES[key] ?? key;
}

function describePattern(before: Json, after: Json): string | null {
    const a = sequences(before);
    const b = sequences(after);
    let painted = 0;
    let cleared = 0;
    let edited = 0;
    let automation = false;
    const tracks = new Set<string>();
    for (const [key, next] of b) {
        const prev = a.get(key);
        if (prev === next) continue;
        const prevSteps = Array.isArray(prev?.steps) ? (prev.steps as unknown[]) : [];
        const nextSteps = Array.isArray(next.steps) ? (next.steps as unknown[]) : [];
        const length = Math.max(prevSteps.length, nextSteps.length);
        for (let i = 0; i < length; i++) {
            const p = prevSteps[i] ?? null;
            const n = nextSteps[i] ?? null;
            if (p === n) continue;
            if (p === null && n !== null) painted++;
            else if (p !== null && n === null) cleared++;
            else if (!same(p, n)) edited++;
            else continue;
            tracks.add(key);
        }
        if (!same(prev?.automation, next.automation)) {
            automation = true;
            tracks.add(key);
        }
    }
    const where = tracks.size === 1 ? ` (${trackLabel([...tracks][0])})` : '';
    const total = painted + cleared + edited;
    if (total === 0) return automation ? `draw automation${where}` : null;
    if (painted === total) return `paint ${plural(painted, 'step')}${where}`;
    if (cleared === total) return `clear ${plural(cleared, 'step')}${where}`;
    return `edit ${plural(total, 'step')}${where}`;
}

/** Knob changes as `[instrument, key, before, after]`. */
function paramChanges(before: Json, after: Json): Array<[string, string, Json, Json]> {
    const out: Array<[string, string, Json, Json]> = [];
    if (!isObj(before) || !isObj(after)) return out;
    const compare = (instrument: string, a: Json, b: Json) => {
        if (a === b) return;
        if (!isObj(a) || !isObj(b)) {
            if (!same(a, b)) out.push([instrument, '', a, b]);
            return;
        }
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
            if (a[key] === b[key]) continue;
            if (isObj(a[key]) && isObj(b[key])) {
                const inner = { a: a[key], b: b[key] };
                for (const sub of new Set([...Object.keys(inner.a), ...Object.keys(inner.b)])) {
                    const x = inner.a[sub];
                    const y = inner.b[sub];
                    if (!same(x, y)) out.push([instrument, sub, x, y]);
                }
            } else if (!same(a[key], b[key])) {
                out.push([instrument, key, a[key], b[key]]);
            }
        }
    };
    for (const instrument of new Set([...Object.keys(before), ...Object.keys(after)])) {
        const a = before[instrument];
        const b = after[instrument];
        if (Array.isArray(a) && Array.isArray(b)) {
            b.forEach((bank, i) => compare(`${instrument} ${i + 1}`, a[i], bank));
        } else {
            compare(instrument, a, b);
        }
    }
    return out;
}

function instrumentLabel(instrument: string): string {
    const [base, bank] = instrument.split(' ');
    const name = INSTRUMENT_NAMES[base] ?? base;
    return bank ? `${name} bank ${bank}` : name;
}

function describeParams(before: Json, after: Json): string | null {
    const changes = paramChanges(before, after);
    if (changes.length === 0) return null;
    if (changes.length === 1) {
        const [instrument, key, from, to] = changes[0];
        const what = key ? humanizeKey(key) : 'patch';
        return `${instrumentLabel(instrument)}: ${what} ${formatValue(from)} → ${formatValue(to)}`;
    }
    const instruments = new Set(changes.map(([instrument]) => instrument));
    if (instruments.size === 1) return `${instrumentLabel([...instruments][0])}: ${plural(changes.length, 'param')}`;
    return `${plural(changes.length, 'param')} on ${plural(instruments.size, 'instrument')}`;
}

function clipsById(arrangement: Json): Map<string, Obj> {
    const out = new Map<string, Obj>();
    const clips = isObj(arrangement) && Array.isArray(arrangement.clips) ? arrangement.clips : [];
    for (const clip of clips) if (isObj(clip) && typeof clip.id === 'string') out.set(clip.id, clip);
    return out;
}

/** The one key `prev` and `next` differ in, as `[key, from, to]`; null when none or several. */
function soleChange(prev: Obj, next: Obj): [string, Json, Json] | null {
    const keys = [...new Set([...Object.keys(prev), ...Object.keys(next)])].filter((key) => !same(prev[key], next[key]));
    return keys.length === 1 ? [keys[0], prev[keys[0]], next[keys[0]]] : null;
}

const dB = (value: Json) => `${formatValue(value)} dB`;

function describeClipEdit(prev: Obj, next: Obj): string {
    const change = soleChange(prev, next);
    if (change?.[0] === 'gainDb') return `Clip gain ${dB(change[1])} → ${dB(change[2])}`;
    if (change?.[0] === 'fadeInFrames') return 'fade in clip';
    if (change?.[0] === 'fadeOutFrames') return 'fade out clip';
    if (change?.[0] === 'offsetFrames') return 'slip clip';
    return 'edit clip';
}

const clipEnd = (clip: Obj) => Number(clip.startStep) + Number(clip.lengthSteps);

function describeArrangement(before: Json, after: Json): string | null {
    const a = clipsById(before);
    const b = clipsById(after);
    const added = [...b.keys()].filter((id) => !a.has(id));
    const removed = [...a.keys()].filter((id) => !b.has(id)).length;
    const moved: string[] = [];
    const resized: string[] = [];
    const edited: string[] = [];
    for (const [id, next] of b) {
        const prev = a.get(id);
        if (!prev || prev === next || same(prev, next)) continue;
        // A head trim moves the start too, but keeps the end: it is a resize.
        if (prev.track !== next.track || (prev.startStep !== next.startStep && prev.lengthSteps === next.lengthSteps)) moved.push(id);
        else if (prev.startStep !== next.startStep || prev.lengthSteps !== next.lengthSteps || prev.offsetSteps !== next.offsetSteps) resized.push(id);
        else edited.push(id);
    }
    const counts = [added.length, removed, moved.length, resized.length, edited.length];
    const kinds = counts.filter((n) => n > 0).length;
    if (kinds === 0) return same(before, after) ? null : 'edit arrangement';
    if (kinds === 2 && added.length === 1 && resized.length === 1) {
        // A split: the left part is shortened and the right part starts where it now ends.
        const left = b.get(resized[0])!;
        const right = b.get(added[0])!;
        if (left.track === right.track && clipEnd(left) === right.startStep) return 'split clip';
    }
    if (kinds > 1) return `edit ${plural(counts.reduce((sum, n) => sum + n, 0), 'clip')}`;
    if (added.length) return added.length === 1 ? 'add clip' : `add ${added.length} clips`;
    if (removed) return removed === 1 ? 'delete clip' : `delete ${removed} clips`;
    if (moved.length) return moved.length === 1 ? 'move clip' : `move ${moved.length} clips`;
    if (resized.length) return resized.length === 1 ? 'resize clip' : `resize ${resized.length} clips`;
    return edited.length === 1 ? describeClipEdit(a.get(edited[0])!, b.get(edited[0])!) : `edit ${edited.length} clips`;
}

function tracksById(tracks: Json): Map<string, Obj> {
    const out = new Map<string, Obj>();
    for (const track of Array.isArray(tracks) ? tracks : []) if (isObj(track) && typeof track.id === 'string') out.set(track.id, track);
    return out;
}

const trackName = (track: Obj) => (typeof track.name === 'string' && track.name ? track.name : String(track.id));

const AUDIO_STRIP_NAMES: Record<string, string> = { gainDb: 'Fader', pan: 'Pan' };

/** Audio tracks (#1629): "add Audio 1", "Audio 1: Fader 0 dB → -6 dB", "rename Audio 1 → Vox". */
function describeAudioTracks(before: Json, after: Json): string | null {
    const a = tracksById(before);
    const b = tracksById(after);
    const added = [...b.values()].filter((t) => !a.has(t.id as string));
    const removed = [...a.values()].filter((t) => !b.has(t.id as string));
    const changed = [...b.values()].filter((t) => a.has(t.id as string) && !same(a.get(t.id as string), t));
    const total = added.length + removed.length + changed.length;
    if (total === 0) return null;
    if (total > 1) {
        if (added.length === total) return `add ${added.length} audio tracks`;
        if (removed.length === total) return `remove ${removed.length} audio tracks`;
        return `edit ${plural(total, 'audio track')}`;
    }
    if (added.length) return `add ${trackName(added[0])}`;
    if (removed.length) return `remove ${trackName(removed[0])}`;
    const next = changed[0];
    const prev = a.get(next.id as string)!;
    const change = soleChange(prev, next);
    if (!change) return `edit ${trackName(next)}`;
    const [key, from, to] = change;
    if (key === 'name') return `rename ${trackName(prev)} → ${trackName(next)}`;
    const value = key === 'gainDb' ? dB : formatValue;
    return `${trackName(next)}: ${AUDIO_STRIP_NAMES[key] ?? humanizeKey(key)} ${value(from)} → ${value(to)}`;
}

/** Field order of precedence: the first one that changed names the step. */
const DESCRIBERS: Array<[SongField, (before: Json, after: Json) => string | null]> = [
    ['pattern', describePattern],
    ['params', describeParams],
    ['arrangement', describeArrangement],
    ['audioTracks', describeAudioTracks],
    ['automationLanes', (a, b) => (same(a ?? [], b ?? []) ? null : 'edit automation')],
    ['session', (a, b) => (same(a, b) ? null : 'edit session')],
    ['audioGraph', (a, b) => (same(a, b) ? null : 'edit patch')],
    ['noteFx', (a, b) => (same(a ?? {}, b ?? {}) ? null : 'edit note FX')],
    ['ttsPhrases', (a, b) => (same(a, b) ? null : 'edit lyrics')],
    ['trackStorage', (a, b) => (same(a, b) ? null : 'edit pattern bank')],
    ['activeTrackSlots', (a, b) => (same(a, b) ? null : 'switch pattern slot')],
];

/** Fields in the order they name a step; also what makes two edits "the same kind". */
export const FIELD_PRECEDENCE: readonly SongField[] = [
    ...DESCRIBERS.map(([field]) => field),
    ...(Object.keys(MIXER_NAMES) as SongField[]),
];

/** The field that names an edit touching `fields` (the kind of edit it is). */
export function primaryField(fields: readonly SongField[]): SongField | undefined {
    return FIELD_PRECEDENCE.find((field) => fields.includes(field)) ?? fields[0];
}

/** A short name for the edit that took `before` to `after` (fields absent from both are ignored). */
export function describeEdit(before: SongFieldValues, after: SongFieldValues): string {
    const changed = (field: SongField) => (field in before || field in after) && !same(before[field], after[field]);
    for (const [field, describe] of DESCRIBERS) {
        if (!changed(field)) continue;
        const label = describe(before[field], after[field]);
        if (label) return label;
    }
    for (const [field, name] of Object.entries(MIXER_NAMES) as Array<[SongField, string]>) {
        if (changed(field)) return `${name} ${formatValue(before[field])} → ${formatValue(after[field])}`;
    }
    const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((f) => changed(f as SongField));
    return fields.length > 0 ? `edit ${fields.join(', ')}` : 'edit';
}
