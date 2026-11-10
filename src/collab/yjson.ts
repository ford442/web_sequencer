/**
 * JSON ↔ Yjs for the project document (#1597 D1).
 *
 * `createY` builds Yjs content for a JSON value, `readY` turns it back into
 * JSON, and `reconcileEntry` patches existing content in place so that a new
 * snapshot of the same value becomes the smallest set of document operations.
 * That last part is what lets an editor that only has whole snapshots (today's
 * stores, autosave, an agent tool result) be one more peer: it writes the new
 * snapshot, and only what changed reaches the other peers.
 *
 * Representation, chosen per path by `ShapeRules` when content is created:
 *
 *   object                  → `Y.Map` (each key merges on its own), or an atom
 *   array, `'list'`         → `Y.Array`: an ordered collection (clips, lanes,
 *                             points). Elements with a unique `id`/`slotId`
 *                             are matched by it, so a reorder never moves one
 *                             element's fields onto another; others by position
 *   array, `'slots'`        → `Y.Map` keyed by index plus a length register:
 *                             fixed slots (the 32 steps of a pattern). Two
 *                             edits to the same step are one register, so they
 *                             converge on one value rather than both inserting
 *   array of primitives     → an atom (time signature, chord notes), unless a
 *                             rule says otherwise
 *   string, `'text'`        → `Y.Text` (lyrics), patched by a prefix/suffix diff
 *   anything else, `'atom'` → stored as one opaque value, last writer wins
 *
 * Reading never consults the rules: every representation is self-describing,
 * so peers whose rules differ (an older build) still read each other's docs.
 */

import * as Y from 'yjs';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

type JsonObject = { [key: string]: Json };

/** Path of keys from the root; array indices are their decimal strings. */
export type JsonPath = readonly string[];

export type ShapeKind = 'auto' | 'list' | 'slots' | 'atom' | 'text';

export type ShapeRules = (path: JsonPath) => ShapeKind;

/** Keys that start with this are reserved for the representation itself. */
const RESERVED_PREFIX = '\u0001';
/** Length register of a `'slots'` map. */
const SLOTS_LENGTH_KEY = `${RESERVED_PREFIX}len`;
/** Fields that give a list element its identity, in order of preference. */
const IDENTITY_KEYS = ['id', 'slotId'] as const;

/** The JSON image of a value: exactly what `JSON.stringify` would keep. */
export function toJsonImage(value: unknown): Json {
    const text = JSON.stringify(value);
    return text === undefined ? null : (JSON.parse(text) as Json);
}

/** A data key as stored in a `Y.Map` (reserved-prefix keys are escaped). */
export function escapeKey(key: string): string {
    return key.startsWith(RESERVED_PREFIX) ? RESERVED_PREFIX + key : key;
}

/** The data key for a stored key, or null for a reserved (representation) key. */
export function unescapeKey(stored: string): string | null {
    if (!stored.startsWith(RESERVED_PREFIX)) return stored;
    return stored.startsWith(RESERVED_PREFIX + RESERVED_PREFIX) ? stored.slice(1) : null;
}

/**
 * Rules from dotted path globs; `*` matches any one key or index, e.g.
 * `'pattern.*.steps': 'slots'`. Unmatched paths are `'auto'`.
 */
export function createShapeRules(globs: Readonly<Record<string, ShapeKind>>): ShapeRules {
    const byLength = new Map<number, { segments: string[]; kind: ShapeKind }[]>();
    for (const [glob, kind] of Object.entries(globs)) {
        const segments = glob.split('.');
        const bucket = byLength.get(segments.length) ?? [];
        bucket.push({ segments, kind });
        byLength.set(segments.length, bucket);
    }
    return (path) => {
        const bucket = byLength.get(path.length);
        if (!bucket) return 'auto';
        for (const { segments, kind } of bucket) {
            if (segments.every((seg, i) => seg === '*' || seg === path[i])) return kind;
        }
        return 'auto';
    };
}

function isObject(value: Json): value is JsonObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function arrayKind(value: Json[], path: JsonPath, rules: ShapeRules): 'list' | 'slots' | 'atom' {
    const kind = rules(path);
    if (kind === 'list' || kind === 'slots' || kind === 'atom') return kind;
    const primitivesOnly = value.length > 0 && value.every((v) => v === null || typeof v !== 'object');
    return primitivesOnly ? 'atom' : 'list';
}

function childPath(path: JsonPath, key: string | number): string[] {
    return [...path, String(key)];
}

/** Fresh Yjs content (or a plain atom) for `value` at `path`. */
export function createY(value: Json, path: JsonPath, rules: ShapeRules): unknown {
    if (typeof value === 'string') {
        if (rules(path) !== 'text') return value;
        const text = new Y.Text();
        text.insert(0, value);
        return text;
    }
    if (Array.isArray(value)) {
        const kind = arrayKind(value, path, rules);
        if (kind === 'atom') return value;
        if (kind === 'slots') {
            const slots = new Y.Map<unknown>();
            slots.set(SLOTS_LENGTH_KEY, value.length);
            value.forEach((item, i) => {
                if (item !== null) slots.set(String(i), createY(item, childPath(path, i), rules));
            });
            return slots;
        }
        const list = new Y.Array<unknown>();
        list.push(value.map((item, i) => createY(item, childPath(path, i), rules)));
        return list;
    }
    if (isObject(value)) {
        if (rules(path) === 'atom') return value;
        const map = new Y.Map<unknown>();
        for (const [key, item] of Object.entries(value)) {
            map.set(escapeKey(key), createY(item, childPath(path, key), rules));
        }
        return map;
    }
    return value;
}

function cloneJson(value: Json): Json {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(cloneJson);
    const out: JsonObject = {};
    for (const [key, item] of Object.entries(value)) assignKey(out, key, cloneJson(item));
    return out;
}

/** `out[key] = value`, without `__proto__` turning into a prototype swap. */
function assignKey(out: JsonObject, key: string, value: Json): void {
    if (key === '__proto__') {
        Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
    } else {
        out[key] = value;
    }
}

/** JSON for Yjs content written by `createY` / `reconcileEntry`. */
export function readY(value: unknown): Json {
    if (value instanceof Y.Text) return value.toJSON();
    if (value instanceof Y.Array) return value.toArray().map(readY);
    if (value instanceof Y.Map) {
        const map = value as Y.Map<unknown>;
        if (map.has(SLOTS_LENGTH_KEY)) return readSlots(map);
        const out: JsonObject = {};
        for (const [stored, item] of map.entries()) {
            const key = unescapeKey(stored);
            if (key !== null) assignKey(out, key, readY(item));
        }
        return out;
    }
    if (value instanceof Y.AbstractType) return null;
    // Atoms come back by reference from Yjs; never hand out doc internals.
    return value === undefined ? null : cloneJson(value as Json);
}

function slotsLength(map: Y.Map<unknown>): number {
    const raw = map.get(SLOTS_LENGTH_KEY);
    return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

/** The slot index a stored key names, or -1 for anything else. */
function slotIndex(key: string, length: number): number {
    const index = Number(key);
    return Number.isInteger(index) && index >= 0 && index < length && String(index) === key ? index : -1;
}

function readSlots(map: Y.Map<unknown>): Json[] {
    const length = slotsLength(map);
    const out: Json[] = new Array<Json>(length).fill(null);
    for (const [key, item] of map.entries()) {
        const index = slotIndex(key, length);
        if (index >= 0) out[index] = readY(item);
    }
    return out;
}

/** Deep JSON equality (object key order does not matter). */
export function jsonEqual(a: Json, b: Json): boolean {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        return a.every((item, i) => jsonEqual(item, b[i]));
    }
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && jsonEqual(a[key], b[key]));
}

/**
 * Make `map[storedKey]` represent `value`: patched in place when the current
 * content can hold it, replaced otherwise. Writes nothing when already equal.
 */
export function reconcileEntry(
    map: Y.Map<unknown>,
    storedKey: string,
    value: Json,
    path: JsonPath,
    rules: ShapeRules,
): void {
    if (map.has(storedKey) && reconcileInPlace(map.get(storedKey), value, path, rules)) return;
    map.set(storedKey, createY(value, path, rules));
}

/** True when `current` now represents `value`; false = the caller must replace it. */
function reconcileInPlace(current: unknown, value: Json, path: JsonPath, rules: ShapeRules): boolean {
    if (current instanceof Y.Text) {
        if (typeof value !== 'string') return false;
        patchText(current, value);
        return true;
    }
    if (current instanceof Y.Array) {
        if (!Array.isArray(value)) return false;
        reconcileList(current as Y.Array<unknown>, value, path, rules);
        return true;
    }
    if (current instanceof Y.Map) {
        const map = current as Y.Map<unknown>;
        if (map.has(SLOTS_LENGTH_KEY)) {
            if (!Array.isArray(value)) return false;
            reconcileSlots(map, value, path, rules);
            return true;
        }
        if (!isObject(value)) return false;
        reconcileObject(map, value, path, rules);
        return true;
    }
    if (current instanceof Y.AbstractType) return false;
    // An atom: keep it only when it already holds this value.
    return jsonEqual(current as Json, value);
}

function reconcileObject(map: Y.Map<unknown>, value: JsonObject, path: JsonPath, rules: ShapeRules): void {
    const keep = new Set<string>();
    for (const [key, item] of Object.entries(value)) {
        const stored = escapeKey(key);
        keep.add(stored);
        reconcileEntry(map, stored, item, childPath(path, key), rules);
    }
    for (const stored of [...map.keys()]) {
        if (!keep.has(stored)) map.delete(stored);
    }
}

function reconcileSlots(map: Y.Map<unknown>, value: Json[], path: JsonPath, rules: ShapeRules): void {
    if (map.get(SLOTS_LENGTH_KEY) !== value.length) map.set(SLOTS_LENGTH_KEY, value.length);
    value.forEach((item, i) => {
        const key = String(i);
        if (item === null) {
            if (map.has(key)) map.delete(key);
        } else {
            reconcileEntry(map, key, item, childPath(path, i), rules);
        }
    });
    for (const key of [...map.keys()]) {
        if (key !== SLOTS_LENGTH_KEY && slotIndex(key, value.length) < 0) map.delete(key);
    }
}

/** Prefix/suffix diff, widened so a surrogate pair is never split. */
function patchText(text: Y.Text, next: string): void {
    const prev = text.toJSON();
    if (prev === next) return;
    let start = 0;
    while (start < prev.length && start < next.length && prev[start] === next[start]) start++;
    let endPrev = prev.length;
    let endNext = next.length;
    while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
        endPrev--;
        endNext--;
    }
    const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
    const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;
    if (start > 0 && isHigh(prev.charCodeAt(start - 1))) start--;
    if (endPrev < prev.length && isLow(prev.charCodeAt(endPrev))) {
        endPrev++;
        endNext++;
    }
    if (endPrev > start) text.delete(start, endPrev - start);
    if (endNext > start) text.insert(start, next.slice(start, endNext));
}

/** The identity field shared (uniquely) by every element on both sides, if any. */
function identityKey(current: unknown[], next: Json[]): (typeof IDENTITY_KEYS)[number] | null {
    if (current.length === 0 || next.length === 0) return null;
    for (const key of IDENTITY_KEYS) {
        const nextIds = next.map((item) => (isObject(item) ? item[key] : undefined));
        const currentIds = current.map((item) => (item instanceof Y.Map ? (item as Y.Map<unknown>).get(key) : undefined));
        const allStrings = [...nextIds, ...currentIds].every((id) => typeof id === 'string');
        if (allStrings && new Set(nextIds).size === nextIds.length && new Set(currentIds).size === currentIds.length) {
            return key;
        }
    }
    return null;
}

function reconcileList(list: Y.Array<unknown>, value: Json[], path: JsonPath, rules: ShapeRules): void {
    const current = list.toArray();
    const key = identityKey(current, value);
    if (key) {
        reconcileListById(list, current, value, key, path, rules);
    } else {
        reconcileListByPosition(list, current, value, path, rules);
    }
}

/**
 * Elements keep their Yjs identity by id: removed ids are deleted, kept ones
 * patched in place, new ones inserted. Yjs 13 has no move, so a reordered
 * element is deleted and re-inserted, and a concurrent edit to it is dropped
 * (never applied to whichever element now sits at its old index). Which ones
 * move: everything outside the largest set already in the new order, picked to
 * keep elements whose content did not change — dragging one clip past others
 * re-inserts only the dragged clip.
 */
function reconcileListById(
    list: Y.Array<unknown>,
    current: unknown[],
    value: Json[],
    key: string,
    path: JsonPath,
    rules: ShapeRules,
): void {
    const idOf = (item: unknown) => (item as Y.Map<unknown>).get(key) as string;
    const target = new Map<string, number>();
    value.forEach((item, i) => target.set((item as JsonObject)[key] as string, i));

    const live = [...current];
    const removeAt = (i: number) => {
        list.delete(i, 1);
        live.splice(i, 1);
    };
    for (let i = live.length - 1; i >= 0; i--) {
        if (!target.has(idOf(live[i]))) removeAt(i);
    }
    const order = live.map((item) => target.get(idOf(item)) as number);
    const unchanged = live.map((item, i) => jsonEqual(readY(item), value[order[i]]));
    const keep = stableSubsequence(order, unchanged);
    for (let i = live.length - 1; i >= 0; i--) {
        if (!keep.has(i)) removeAt(i);
    }

    value.forEach((item, i) => {
        const itemPath = childPath(path, i);
        if (i < live.length && idOf(live[i]) === (item as JsonObject)[key]) {
            if (reconcileInPlace(live[i], item, itemPath, rules)) return;
            // Same id, but the content can no longer be patched: replace it.
            removeAt(i);
        }
        const created = createY(item, itemPath, rules);
        list.insert(i, [created]);
        live.splice(i, 0, created);
    });
}

/**
 * Indices of the increasing subsequence of `order` that keeps the most
 * `unchanged` elements (then the most elements). O(n²); lists here are short.
 */
function stableSubsequence(order: readonly number[], unchanged: readonly boolean[]): Set<number> {
    const n = order.length;
    const heavy = n + 1;
    const best: number[] = [];
    const prev: number[] = [];
    let end = -1;
    for (let i = 0; i < n; i++) {
        const weight = unchanged[i] ? heavy : 1;
        best[i] = weight;
        prev[i] = -1;
        for (let j = 0; j < i; j++) {
            if (order[j] < order[i] && best[j] + weight > best[i]) {
                best[i] = best[j] + weight;
                prev[i] = j;
            }
        }
        if (end < 0 || best[i] > best[end]) end = i;
    }
    const keep = new Set<number>();
    for (let i = end; i >= 0; i = prev[i]) keep.add(i);
    return keep;
}

/**
 * Untouched head and tail are kept; the changed middle is patched pairwise and
 * the length difference inserted or deleted, so one insert, delete or edit in
 * the middle of a list is one operation.
 */
function reconcileListByPosition(
    list: Y.Array<unknown>,
    current: unknown[],
    value: Json[],
    path: JsonPath,
    rules: ShapeRules,
): void {
    const same = (i: number, j: number) => jsonEqual(readY(current[i]), value[j]);
    let start = 0;
    while (start < current.length && start < value.length && same(start, start)) start++;
    let endCurrent = current.length;
    let endNext = value.length;
    while (endCurrent > start && endNext > start && same(endCurrent - 1, endNext - 1)) {
        endCurrent--;
        endNext--;
    }
    const common = Math.min(endCurrent - start, endNext - start);
    for (let i = start; i < start + common; i++) {
        const itemPath = childPath(path, i);
        if (reconcileInPlace(current[i], value[i], itemPath, rules)) continue;
        list.delete(i, 1);
        list.insert(i, [createY(value[i], itemPath, rules)]);
    }
    const from = start + common;
    if (endCurrent > from) list.delete(from, endCurrent - from);
    if (endNext > from) {
        list.insert(from, value.slice(from, endNext).map((item, j) => createY(item, childPath(path, from + j), rules)));
    }
}
