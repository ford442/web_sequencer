/**
 * How a store joins the project doc (#1597 P2). Yjs-free, so stores and the
 * entry chunk can describe their bindings without pulling in the CRDT.
 *
 * A binding names the top-level song fields its store owns and moves them
 * both ways:
 *
 *   store → doc   the runtime subscribes; when `version()` changes it reads the
 *                 fields and writes the ones whose value changed, as one edit of
 *                 the current editor (human, agent, load, playback).
 *   doc → store   when a transaction it did not make itself changes one of the
 *                 fields (a peer, an undo, a co-producer write), the runtime
 *                 reads the fields from the doc and calls `apply`.
 *
 * Stores are immutable-update stores: a field's value is a new reference when,
 * and only when, it changed. That is what lets the runtime skip unchanged
 * fields by identity instead of diffing the song on every notification.
 */

import type { SavedSongData } from '@/types';

export type SongField = keyof SavedSongData;

export type SongFieldValues = Partial<Record<SongField, unknown>>;

export interface DocBinding {
    /** For diagnostics and tests. */
    readonly name: string;
    readonly fields: readonly SongField[];
    /** Called on every store change; must be cheap. */
    subscribe(listener: () => void): () => void;
    /**
     * Changes (by identity) when, and only when, `read()` may return
     * something new. A store that notifies for unrelated state (live
     * automation values, playback position) keeps it still.
     */
    version(): unknown;
    /** The store's current value of each field; `undefined` = the song has none. */
    read(): SongFieldValues;
    /**
     * Put the doc's values into the store. A field the doc does not hold is
     * `undefined`; the binding decides what absent means (usually "empty").
     */
    apply(values: SongFieldValues): void;
}
