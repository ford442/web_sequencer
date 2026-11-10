/**
 * The project document (#1597 D1): one `Y.Doc` that every editor — this tab,
 * another tab, later a remote peer or the co-producer agent — applies the same
 * operations to.
 *
 * The doc has one root `Y.Map` per subsystem. Each top-level `SavedSongData`
 * field lives in exactly one of them (`SONG_FIELD_SUBSYSTEM`), keyed by its
 * own name, so a subsystem map reads like a slice of today's song JSON:
 *
 *   patterns     pattern, trackStorage, activeTrackSlots, trackParamStorage
 *   tracks       params, noteFx
 *   mixer        tempo, swing, stepCount, timeSignature, trackLengths, ambianceUrl
 *   arrangement  arrangement, songStructure
 *   session      session
 *   automation   automationLanes, rbsTrakEvents
 *   patchBay     audioGraph, pcfFilter
 *   wam2Slots    wam2
 *   lyrics       ttsPhrases (a slot array of `Y.Text`, so two people can type at once)
 *   meta         version, midiMappings, rbsLoopStart, rbsLoopEnd
 *   assets       embeddedSamples, backgroundImage (opaque strings — see ProjectStore)
 *   extra        any field this table does not know yet (forward compatibility)
 *
 * The `doc` root map holds the document's own bookkeeping (`DOC_INFO_KEYS`).
 * How a JSON value becomes Yjs types inside a subsystem is `yjson.ts`; the
 * whole-song mapping is `codec.ts`.
 */

import * as Y from 'yjs';
import type { SavedSongData } from '@/types';

/** Version of the doc layout itself (independent of `SavedSongData.version`). */
export const PROJECT_DOC_VERSION = 1;

export const SUBSYSTEMS = [
    'patterns',
    'tracks',
    'mixer',
    'arrangement',
    'session',
    'automation',
    'patchBay',
    'wam2Slots',
    'lyrics',
    'meta',
    'assets',
    'extra',
] as const;

export type Subsystem = (typeof SUBSYSTEMS)[number];

/**
 * Where each top-level song field lives. Typed over `keyof SavedSongData`, so a
 * field added to the song type does not compile until it is given a home.
 */
export const SONG_FIELD_SUBSYSTEM: Readonly<Record<keyof SavedSongData, Exclude<Subsystem, 'extra'>>> = {
    version: 'meta',
    pattern: 'patterns',
    params: 'tracks',
    trackStorage: 'patterns',
    activeTrackSlots: 'patterns',
    songStructure: 'arrangement',
    arrangement: 'arrangement',
    tempo: 'mixer',
    timeSignature: 'mixer',
    swing: 'mixer',
    stepCount: 'mixer',
    trackLengths: 'mixer',
    ambianceUrl: 'mixer',
    backgroundImage: 'assets',
    embeddedSamples: 'assets',
    ttsPhrases: 'lyrics',
    automationLanes: 'automation',
    noteFx: 'tracks',
    rbsLoopStart: 'meta',
    rbsLoopEnd: 'meta',
    pcfFilter: 'patchBay',
    trackParamStorage: 'patterns',
    rbsTrakEvents: 'automation',
    midiMappings: 'meta',
    wam2: 'wam2Slots',
    session: 'session',
    audioGraph: 'patchBay',
};

/**
 * Transaction origins of the doc's own plumbing. P2's per-editor undo tracks
 * editor origins; none of these is one, so none of them is ever undone.
 */
export const DOC_ORIGINS = {
    /** A project save (autosave, retry) written into the doc. */
    save: 'hyphon:save',
    /** Frames read back from the project's update log. */
    log: 'hyphon:log',
    /** A doc created from a project that had no log yet. */
    seed: 'hyphon:seed',
} as const;

/** Root map for the document's own bookkeeping (not song data). */
export const DOC_INFO_MAP = 'doc';

export const DOC_INFO_KEYS = {
    /** `PROJECT_DOC_VERSION` of the last writer. */
    version: 'version',
    /** Top-level song key order of the last full write, so export keeps it. */
    keyOrder: 'keyOrder',
} as const;

/** The subsystem a top-level song key belongs to (`extra` when unknown). */
export function subsystemOf(key: string): Subsystem {
    return Object.prototype.hasOwnProperty.call(SONG_FIELD_SUBSYSTEM, key)
        ? SONG_FIELD_SUBSYSTEM[key as keyof SavedSongData]
        : 'extra';
}

export function subsystemMap(doc: Y.Doc, subsystem: Subsystem): Y.Map<unknown> {
    return doc.getMap<unknown>(subsystem);
}

export function docInfoMap(doc: Y.Doc): Y.Map<unknown> {
    return doc.getMap<unknown>(DOC_INFO_MAP);
}

/**
 * A new, empty project doc. Root types are created lazily by Yjs on first
 * access, so this only fixes options shared by every project doc.
 */
export function createProjectDoc(): Y.Doc {
    // gc stays on: undo (P2) keeps the items it needs alive by itself.
    return new Y.Doc({ gc: true });
}
