/**
 * The app's stores as project doc bindings (#1597 P2). Yjs-free.
 *
 *   pattern            patternStore
 *   params             instrumentStore
 *   trackStorage, activeTrackSlots, ttsPhrases   samplerBanksStore
 *   tempo, swing, stepCount, timeSignature, trackLengths, ambianceUrl
 *                      transportMixStore (the mixer subsystem)
 *   arrangement, songStructure   arrangementStore (songStructure is its projection)
 *   audioTracks, media           audioTrackStore (#1629)
 *   session            sessionDocumentStore
 *   automationLanes    automationStore
 *   noteFx             noteFxStore
 *   audioGraph         the active PatchController (patch bay)
 *
 * Fields not bound here (embedded samples, background image, WAM2 state, the
 * RBS extras, MIDI mappings) are read from their owners at save time and
 * written with the save (`useSongStorage/save.ts`); they are not undoable.
 *
 * Optional fields follow the save format: an empty value is absent, so a doc
 * read back by the codec matches what `getSongData` always wrote.
 */

import type { Arrangement, Pattern, SavedSongData, UnifiedAutomationLane } from '@/types';
import type { SessionDocument } from '@/session/types';
import type { TrackKey } from '@/constants/appDefaults';
import { patternStore } from '@/stores/patternStore';
import { instrumentStore, type InstrumentParams } from '@/stores/instrumentStore';
import { samplerBanksStore } from '@/stores/samplerBanksStore';
import { transportMixStore } from '@/stores/transportMixStore';
import { arrangementStore, sessionDocumentStore } from '@/stores/songRecordStore';
import { audioTrackStore } from '@/stores/audioTrackStore';
import { audioTrackStateOf, type AudioTrackState } from '@/arrangement/audioTracks';
import { automationStore } from '@/stores/automationStore';
import { noteFxStore } from '@/stores/noteFxStore';
import { NOTE_FX_TRACKS } from '@/sequencer/noteFx/types';
import { normalizeArrangement, projectArrangement } from '@/arrangement/model';
import { migrateTrackStorage } from '@/utils/trackStorageUtils';
import type { TimeSignature } from '@/utils/musicTheory';
import type { TrackLengths } from '@/utils/songMeter';
import {
    DEFAULT_PRESET_ID,
    GRAPH_SCHEMA_VERSION,
    getActivePatchController,
    restorePatchFromSong,
    subscribeActivePatchController,
    type PatchController,
} from '@/audio/graph';
import type { DocBinding, SongField, SongFieldValues } from './binding';

/** `fn`'s result, recomputed only when `key` changes identity. */
function memoByKey<K, V>(fn: (key: K) => V): (key: K) => V {
    let lastKey: K | typeof UNSET = UNSET;
    let last: V;
    return (key) => {
        if (lastKey !== key) {
            lastKey = key;
            last = fn(key);
        }
        return last;
    };
}
const UNSET = Symbol('unset');

const patternBinding: DocBinding = {
    name: 'pattern',
    fields: ['pattern'],
    subscribe: patternStore.subscribe,
    version: patternStore.getSnapshot,
    read: () => ({ pattern: patternStore.getSnapshot() }),
    apply(values) {
        if (values.pattern) patternStore.set(values.pattern as Pattern);
    },
};

const paramsBinding: DocBinding = {
    name: 'params',
    fields: ['params'],
    subscribe: instrumentStore.subscribe,
    version: instrumentStore.getParams,
    read: () => ({ params: instrumentStore.getParams() }),
    apply(values) {
        if (values.params) instrumentStore.setMany(values.params as Partial<InstrumentParams>);
    },
};

const samplerBanksBinding: DocBinding = {
    name: 'samplerBanks',
    fields: ['trackStorage', 'activeTrackSlots', 'ttsPhrases'],
    subscribe: samplerBanksStore.subscribe,
    version: samplerBanksStore.getSnapshot,
    read() {
        const s = samplerBanksStore.getSnapshot();
        return { trackStorage: s.trackStorage, activeTrackSlots: s.activeTrackSlots, ttsPhrases: s.ttsPhrases };
    },
    apply(values) {
        if (values.trackStorage) {
            samplerBanksStore.setTrackStorage(migrateTrackStorage(values.trackStorage as Record<string, unknown>));
        }
        if (values.activeTrackSlots) {
            samplerBanksStore.setActiveTrackSlots(values.activeTrackSlots as Record<TrackKey, number>);
        }
        if (Array.isArray(values.ttsPhrases)) samplerBanksStore.setTtsPhrases(values.ttsPhrases as string[]);
    },
};

const mixerRead = memoByKey((s: ReturnType<typeof transportMixStore.getSnapshot>): SongFieldValues => ({
    tempo: s.tempo,
    swing: s.swing,
    stepCount: s.stepCount,
    timeSignature: s.timeSignature,
    trackLengths: Object.keys(s.trackLengths).length > 0 ? s.trackLengths : undefined,
    ambianceUrl: s.ambianceUrl,
}));

const mixerBinding: DocBinding = {
    name: 'mixer',
    fields: ['tempo', 'swing', 'stepCount', 'timeSignature', 'trackLengths', 'ambianceUrl'],
    subscribe: transportMixStore.subscribe,
    version: () => mixerRead(transportMixStore.getSnapshot()),
    read: () => mixerRead(transportMixStore.getSnapshot()),
    apply(values) {
        if (typeof values.tempo === 'number') transportMixStore.setTempo(values.tempo);
        const m = transportMixStore.getMeter();
        const meter = {
            stepCount: typeof values.stepCount === 'number' ? values.stepCount : m.stepCount,
            timeSignature: (values.timeSignature as TimeSignature | undefined) ?? m.timeSignature,
            // Absent = none; keep the current (empty) object so nothing re-renders.
            trackLengths: (values.trackLengths as TrackLengths | undefined)
                ?? (Object.keys(m.trackLengths).length === 0 ? m.trackLengths : {}),
            swing: typeof values.swing === 'number' ? values.swing : m.swing,
        };
        if (meter.stepCount !== m.stepCount || meter.timeSignature !== m.timeSignature
            || meter.trackLengths !== m.trackLengths || meter.swing !== m.swing) {
            transportMixStore.applyMeter(meter);
        }
        if (typeof values.ambianceUrl === 'string') transportMixStore.setAmbianceUrl(values.ambianceUrl);
    },
};

let arrangementCache: { arrangement: Arrangement; stepCount: number; values: SongFieldValues } | null = null;
/** Recomputed only when the arrangement or the measure length changes. */
function arrangementRead(): SongFieldValues {
    const arrangement = arrangementStore.getSnapshot();
    const stepCount = transportMixStore.meterRef.current.stepCount;
    if (arrangementCache?.arrangement !== arrangement || arrangementCache.stepCount !== stepCount) {
        arrangementCache = {
            arrangement,
            stepCount,
            // Song Mode projection, for readers that predate the arrangement.
            values: { arrangement, songStructure: projectArrangement(arrangement, stepCount) },
        };
    }
    return arrangementCache.values;
}

const arrangementBinding: DocBinding = {
    name: 'arrangement',
    fields: ['arrangement', 'songStructure'],
    subscribe(listener) {
        const offArrangement = arrangementStore.subscribe(listener);
        const offMeter = transportMixStore.subscribe(listener);
        return () => {
            offArrangement();
            offMeter();
        };
    },
    version: arrangementRead,
    read: arrangementRead,
    apply(values) {
        const arrangement = normalizeArrangement(values.arrangement);
        if (arrangement) arrangementStore.set(arrangement);
    },
};

// Empty values are absent, as the save format writes them.
const audioTracksRead = memoByKey((s: AudioTrackState): SongFieldValues => ({
    audioTracks: s.tracks.length > 0 ? s.tracks : undefined,
    media: Object.keys(s.media).length > 0 ? s.media : undefined,
}));

const audioTracksBinding: DocBinding = {
    name: 'audioTracks',
    fields: ['audioTracks', 'media'],
    subscribe: audioTrackStore.subscribe,
    version: audioTrackStore.getSnapshot,
    read: () => audioTracksRead(audioTrackStore.getSnapshot()),
    apply(values) {
        // Runs after the arrangement binding, so every audio clip's track exists.
        audioTrackStore.set(audioTrackStateOf(values, arrangementStore.getSnapshot()));
    },
};

const sessionBinding: DocBinding = {
    name: 'session',
    fields: ['session'],
    subscribe: sessionDocumentStore.subscribe,
    version: sessionDocumentStore.getSnapshot,
    read: () => ({ session: sessionDocumentStore.getSnapshot() }),
    apply(values) {
        if (values.session) sessionDocumentStore.set(values.session as SessionDocument);
    },
};

const automationLanes = () => automationStore.getState().lanes;
const automationBinding: DocBinding = {
    name: 'automation',
    fields: ['automationLanes'],
    subscribe: (listener) => automationStore.subscribe(listener),
    // Lanes change by identity; live values and the playback step do not touch them.
    version: automationLanes,
    read: () => {
        const lanes = automationLanes();
        return { automationLanes: lanes.length > 0 ? lanes : undefined };
    },
    apply(values) {
        automationStore.importLanes((values.automationLanes as UnifiedAutomationLane[] | undefined) ?? []);
    },
};

// Only note-FX tracks count (`noteFxStore.hasChains`), as the save format has always had it.
const noteFxRead = memoByKey((chains: ReturnType<typeof noteFxStore.getSnapshot>): SongFieldValues => ({
    noteFx: NOTE_FX_TRACKS.some((track) => chains[track] !== undefined) ? noteFxStore.exportChains() : undefined,
}));
const noteFxBinding: DocBinding = {
    name: 'noteFx',
    fields: ['noteFx'],
    subscribe: noteFxStore.subscribe,
    version: () => noteFxStore.getSnapshot(),
    read: () => noteFxRead(noteFxStore.getSnapshot()),
    apply(values) {
        noteFxStore.importChains(values.noteFx);
    },
};

const STOCK_GRAPH: SavedSongData['audioGraph'] = { schemaVersion: GRAPH_SCHEMA_VERSION, presetId: DEFAULT_PRESET_ID };
const patchRead = memoByKey((config: unknown): SongFieldValues => ({
    audioGraph: config === null ? STOCK_GRAPH : getActivePatchController()?.serialize() ?? STOCK_GRAPH,
}));
const patchConfig = () => getActivePatchController()?.getConfig() ?? null;

const patchBayBinding: DocBinding = {
    name: 'patchBay',
    fields: ['audioGraph'],
    subscribe(listener) {
        let controller: PatchController | null = null;
        let offController: () => void = () => {};
        const offRegistry = subscribeActivePatchController((next) => {
            if (next === controller) return;
            offController();
            controller = next;
            offController = next ? next.subscribe(() => listener()) : () => {};
            listener();
        });
        return () => {
            offRegistry();
            offController();
        };
    },
    version: patchConfig,
    read: () => patchRead(patchConfig()),
    apply(values) {
        restorePatchFromSong(values.audioGraph as SavedSongData['audioGraph']);
    },
};

/** Every app store the project doc binds, in the order the runtime seeds them. */
export function createAppBindings(): DocBinding[] {
    return [
        patternBinding,
        paramsBinding,
        samplerBanksBinding,
        mixerBinding,
        arrangementBinding,
        audioTracksBinding,
        sessionBinding,
        automationBinding,
        noteFxBinding,
        patchBayBinding,
    ];
}

let appBindings: DocBinding[] | null = null;
const bindings = () => (appBindings ??= createAppBindings());

/** Every song field a store binding owns. */
export const BOUND_SONG_FIELDS: readonly SongField[] = createAppBindings().flatMap((b) => b.fields);

/**
 * Put `song`'s bound fields into their stores through the bindings' own
 * `apply` (the same code that reads the doc back into the stores). A field
 * the song lacks is applied as absent: empty for optional fields, unchanged
 * for required ones. Run it inside `liveProject.edit('load', ...)` so the
 * writes land in the doc as one load.
 */
export function applySongToBoundStores(song: Partial<SavedSongData>): void {
    for (const binding of bindings()) {
        const values: SongFieldValues = {};
        for (const field of binding.fields) values[field] = song[field];
        binding.apply(values);
    }
}

/** The bound fields as the stores hold them (before the runtime attaches, and in tests). */
export function readBoundStores(): SongFieldValues {
    const out: SongFieldValues = {};
    for (const binding of bindings()) Object.assign(out, binding.read());
    return out;
}
