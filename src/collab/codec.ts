/**
 * `SavedSongData` ↔ project doc (#1597 D1).
 *
 * `writeSongToDoc` is the one way song data enters a doc: it reconciles a
 * whole song snapshot into the doc in one transaction, so writing the song the
 * doc already holds is a no-op and writing an edited song produces only the
 * edit. `readSongFromDoc` is the inverse.
 *
 * The contract is lossless over the song's JSON image: for any song `s`,
 * `JSON.stringify(readSongFromDoc(songToDoc(s))) === JSON.stringify(s)`, byte
 * for byte, also after the doc goes through its binary encoding. Key order is
 * part of that: Yjs keeps a map's insertion order through encoding, and the
 * top-level order (split across subsystem maps) is recorded in the `doc` map.
 */

import * as Y from 'yjs';
import type { SavedSongData } from '@/types';
import {
    DOC_INFO_KEYS,
    PROJECT_DOC_VERSION,
    SUBSYSTEMS,
    createProjectDoc,
    docInfoMap,
    subsystemMap,
    subsystemOf,
} from './doc';
import {
    createShapeRules,
    escapeKey,
    jsonEqual,
    readY,
    reconcileEntry,
    toJsonImage,
    unescapeKey,
    type Json,
} from './yjson';

/**
 * Where the generic representation (see `yjson.ts`) is not the right one.
 * Paths start at the song root; `*` is any key or index.
 */
export const SONG_SHAPE_RULES = createShapeRules({
    // The step grid and per-step automation are fixed slots, so two edits to
    // one step converge on one value.
    'pattern.*.steps': 'slots',
    'pattern.*.automation.*': 'slots',
    'pattern.sampler': 'slots',
    'pattern.sampler.*.steps': 'slots',
    'pattern.sampler.*.automation.*': 'slots',
    'trackStorage.*': 'slots',
    // A sampler slot is an array of 8 bank sequences; other slots are objects
    // and this rule does not apply to them.
    'trackStorage.*.*': 'slots',
    'trackStorage.*.*.steps': 'slots',
    'trackStorage.*.*.automation.*': 'slots',
    'trackStorage.*.*.*.steps': 'slots',
    'trackStorage.*.*.*.automation.*': 'slots',
    'params.sampler': 'slots',
    'trackParamStorage.*': 'slots',
    'pcfFilter.pattern': 'slots',
    // One lyric phrase per sampler bank, each typed into collaboratively.
    ttsPhrases: 'slots',
    'ttsPhrases.*': 'text',
    // Ordered collections, lists even while empty so the first concurrent
    // inserts from two peers both land.
    songStructure: 'list',
    'arrangement.clips': 'list',
    'arrangement.clips.*.lanes': 'list',
    'arrangement.clips.*.lanes.*.points': 'list',
    automationLanes: 'list',
    'automationLanes.*.points': 'list',
    'session.scenes': 'list',
    'session.columns.*.clips': 'list',
    midiMappings: 'list',
    'wam2.plugins': 'list',
    // Preserved import data, never edited: one value is cheapest.
    rbsTrakEvents: 'atom',
});

type SongJson = Record<string, Json>;

function songJson(song: SavedSongData): SongJson {
    const image = toJsonImage(song);
    if (image === null || typeof image !== 'object' || Array.isArray(image)) {
        throw new TypeError('A song must be a JSON object');
    }
    return image;
}

function setIfChanged(map: Y.Map<unknown>, key: string, value: Json): void {
    const current = map.get(key) as Json | undefined;
    if (current === undefined || !jsonEqual(current, value)) map.set(key, value);
}

/**
 * Reconcile `song` into `doc` as one transaction tagged with `origin`. Writing
 * the song the doc already holds changes nothing and emits no update.
 */
export function writeSongToDoc(doc: Y.Doc, song: SavedSongData, origin: unknown = null): void {
    const json = songJson(song);
    doc.transact(() => {
        for (const [key, value] of Object.entries(json)) {
            reconcileEntry(subsystemMap(doc, subsystemOf(key)), escapeKey(key), value, [key], SONG_SHAPE_RULES);
        }
        for (const subsystem of SUBSYSTEMS) {
            const map = subsystemMap(doc, subsystem);
            for (const stored of [...map.keys()]) {
                const key = unescapeKey(stored);
                const belongsHere = key !== null && subsystemOf(key) === subsystem;
                if (!belongsHere || !Object.prototype.hasOwnProperty.call(json, key)) map.delete(stored);
            }
        }
        const info = docInfoMap(doc);
        setIfChanged(info, DOC_INFO_KEYS.version, PROJECT_DOC_VERSION);
        setIfChanged(info, DOC_INFO_KEYS.keyOrder, Object.keys(json));
    }, origin);
}

/** The song a doc holds. An empty doc reads as `{}`. */
export function readSongFromDoc(doc: Y.Doc): SavedSongData {
    const fields = new Map<string, unknown>();
    for (const subsystem of SUBSYSTEMS) {
        for (const [stored, value] of subsystemMap(doc, subsystem).entries()) {
            const key = unescapeKey(stored);
            if (key === null || subsystemOf(key) !== subsystem) continue;
            fields.set(key, value);
        }
    }
    const order = docInfoMap(doc).get(DOC_INFO_KEYS.keyOrder);
    const ordered = Array.isArray(order) ? order.filter((key): key is string => typeof key === 'string') : [];
    const out: SongJson = {};
    for (const key of [...ordered, ...fields.keys()]) {
        if (!fields.has(key) || Object.prototype.hasOwnProperty.call(out, key)) continue;
        Object.defineProperty(out, key, {
            value: readY(fields.get(key)),
            enumerable: true,
            writable: true,
            configurable: true,
        });
    }
    return out as unknown as SavedSongData;
}

/** A new doc holding `song`. */
export function songToDoc(song: SavedSongData): Y.Doc {
    const doc = createProjectDoc();
    writeSongToDoc(doc, song);
    return doc;
}

/** Apply a sequence of Yjs updates (e.g. an update log's frames) to `doc`. */
export function applyUpdates(doc: Y.Doc, updates: readonly Uint8Array[], origin: unknown = null): void {
    if (updates.length === 0) return;
    doc.transact(() => {
        for (const update of updates) Y.applyUpdate(doc, update, origin);
    }, origin);
}
