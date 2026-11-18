/**
 * One top-level song field at a time, in and out of the project doc (#1597 P2).
 *
 * `codec.ts` moves a whole `SavedSongData` snapshot; the store bindings move a
 * single field (`pattern`, `params`, `arrangement`, ...) per edit. Both use the
 * same representation (`SONG_SHAPE_RULES`), so a doc written field by field
 * reads back through `readSongFromDoc` exactly as one written whole.
 */

import * as Y from 'yjs';
import type { SongField } from './binding';
import { subsystemMap, subsystemOf, SUBSYSTEMS, type Subsystem } from './doc';
import { SONG_SHAPE_RULES } from './codec';
import { escapeKey, readY, reconcileEntry, toJsonImage, unescapeKey } from './yjson';

/** The field's JSON value in the doc, or undefined when the doc has none. */
export function readField(doc: Y.Doc, field: SongField): unknown {
    const map = subsystemMap(doc, subsystemOf(field));
    const stored = escapeKey(field);
    return map.has(stored) ? readY(map.get(stored)) : undefined;
}

/**
 * Make the doc hold `value` for `field` with the fewest operations: unchanged
 * parts are left alone, so one painted step is one step's worth of update.
 * `undefined` removes the field. Call inside a transaction.
 */
export function writeField(doc: Y.Doc, field: SongField, value: unknown): void {
    const map = subsystemMap(doc, subsystemOf(field));
    const stored = escapeKey(field);
    if (value === undefined) {
        if (map.has(stored)) map.delete(stored);
        return;
    }
    reconcileEntry(map, stored, toJsonImage(value), [field], SONG_SHAPE_RULES);
}

/** True when the doc holds no song field at all. */
export function isEmptySong(doc: Y.Doc): boolean {
    return SUBSYSTEMS.every((subsystem) => subsystemMap(doc, subsystem).size === 0);
}

/** The subsystem root maps an undo manager tracks (every one that holds song data). */
export function songRootTypes(doc: Y.Doc): Y.Map<unknown>[] {
    return SUBSYSTEMS.map((subsystem) => subsystemMap(doc, subsystem));
}

/**
 * Top-level song fields a transaction changed, found by walking each changed
 * type up to its subsystem root map.
 */
export function changedSongFields(doc: Y.Doc, transaction: Y.Transaction): Set<SongField> {
    // Keyed by identity only, so any Yjs type will do as a key.
    const roots = new Map<object, Subsystem>();
    for (const subsystem of SUBSYSTEMS) roots.set(subsystemMap(doc, subsystem), subsystem);
    const fields = new Set<SongField>();
    const addStored = (subsystem: Subsystem, stored: string | null) => {
        if (stored === null) return;
        const key = unescapeKey(stored);
        if (key !== null && subsystemOf(key) === subsystem) fields.add(key as SongField);
    };
    transaction.changed.forEach((keys, type) => {
        const directRoot = roots.get(type);
        if (directRoot) {
            keys.forEach((key) => addStored(directRoot, key));
            return;
        }
        // Climb to the child of a root; its key in the root is the field.
        let item: Y.Item | null = type._item;
        while (item !== null) {
            const parent = item.parent as { _item?: Y.Item | null } | null;
            if (!parent || !('_item' in parent)) return;
            const root = roots.get(parent);
            if (root) {
                addStored(root, item.parentSub);
                return;
            }
            item = parent._item ?? null;
        }
    });
    return fields;
}
