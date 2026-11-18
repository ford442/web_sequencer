/**
 * Saving the project (#1597 P2 split of `useSongStorage`): `SavedSongData` is
 * the export format of the project doc.
 *
 * Every bound field (pattern, knobs, mixer, track storage, arrangement,
 * session, automation, note FX, patch bay, lyrics) is read from the doc
 * through the codec — the doc is the source of truth. Before the runtime has
 * attached (the first moments after boot, unit tests without it) the stores
 * hold the same values and are read instead. What the doc does not hold —
 * audio, the background image, WAM2 plugin state, MIDI mappings, the .rbs
 * extras — is read from its owner here.
 *
 * Key order is the order `getSongData` has always written, so a saved file
 * diffs cleanly against one saved before the doc existed.
 */

import type { ResolvedTrakEvent, SavedSongData } from '@/types';
import type { SongSnapshot } from '@/constants/appDefaults';
import { liveProject } from '@/collab/liveProject';
import { BOUND_SONG_FIELDS, readBoundStores } from '@/collab/appBindings';
import type { SongFieldValues } from '@/collab/binding';
import { audioBufferToWav, blobToBase64 } from '@/utils/audioExport';
import { SAVED_SONG_DATA_VERSION } from '@/utils/trackStorageUtils';
import { midiMapStore } from '@/stores/midiMapStore';
import { transportMixStore } from '@/stores/transportMixStore';
import { instrumentStore } from '@/stores/instrumentStore';
import { patternStore } from '@/stores/patternStore';
import { getMasterPcf, pcfFilterForSave } from '@/audio/pcf/masterPcf';
import { getWamHost } from '@/audio/wam';
import type { RbsArrangementExtras } from '../appState/useSongModeState';

/** What a save needs beyond the doc and the stores. */
export interface SaveSources {
    sampleBuffers: readonly (AudioBuffer | null)[];
    rbsExtras: RbsArrangementExtras | null | undefined;
    trakEvents: ResolvedTrakEvent[] | null | undefined;
}

/** Sample banks as base64 WAV data URLs, keyed by bank. */
export async function encodeSampleBuffers(buffers: readonly (AudioBuffer | null)[]): Promise<Record<number, string>> {
    const encoded: Record<number, string> = {};
    await Promise.all(buffers.map(async (buf, idx) => {
        if (!buf) return;
        encoded[idx] = await blobToBase64(await audioBufferToWav(buf));
    }));
    return encoded;
}

/** The bound fields: from the doc when the runtime is attached, else from the stores. */
export function readBoundSong(): SongFieldValues {
    const song = liveProject.readSong();
    if (!song) return readBoundStores();
    const out: SongFieldValues = {};
    for (const field of BOUND_SONG_FIELDS) out[field] = song[field];
    return out;
}

/** The whole project as `SavedSongData`, audio included. */
export async function buildSongData(sources: SaveSources): Promise<SavedSongData> {
    const embeddedSamples = await encodeSampleBuffers(sources.sampleBuffers);
    const bound = readBoundSong();
    const extras = sources.rbsExtras;
    const exportedMidi = midiMapStore.exportMappings();
    // A master PCF changed by hand in the patch bay overrides the song's own.
    const savedPcfFilter = pcfFilterForSave(extras?.pcfFilter, getMasterPcf());
    const wam2 = (() => {
        const host = getWamHost();
        if (!host) return undefined;
        const payload = host.exportSongState();
        return payload.plugins.length > 0 ? payload : undefined;
    })();
    const optional = <K extends keyof SavedSongData>(key: K, value: SavedSongData[K] | undefined) =>
        (value === undefined ? {} : { [key]: value }) as Partial<SavedSongData>;
    return {
        version: SAVED_SONG_DATA_VERSION,
        pattern: bound.pattern,
        tempo: bound.tempo,
        stepCount: bound.stepCount,
        timeSignature: bound.timeSignature,
        swing: bound.swing,
        ...optional('trackLengths', bound.trackLengths as SavedSongData['trackLengths']),
        ambianceUrl: bound.ambianceUrl,
        backgroundImage: transportMixStore.getSnapshot().backgroundImage,
        params: bound.params,
        trackStorage: bound.trackStorage,
        activeTrackSlots: bound.activeTrackSlots,
        arrangement: bound.arrangement,
        // Song Mode projection for readers that predate the arrangement.
        songStructure: bound.songStructure,
        session: bound.session,
        embeddedSamples,
        ttsPhrases: bound.ttsPhrases,
        ...optional('automationLanes', bound.automationLanes as SavedSongData['automationLanes']),
        ...optional('noteFx', bound.noteFx as SavedSongData['noteFx']),
        ...optional('midiMappings', exportedMidi.length > 0 ? exportedMidi : undefined),
        ...optional('rbsLoopStart', extras?.loopStart ?? undefined),
        ...optional('rbsLoopEnd', extras?.loopEnd ?? undefined),
        ...optional('pcfFilter', savedPcfFilter ?? undefined),
        ...optional('trackParamStorage', extras?.trackParamStorage),
        ...optional('rbsTrakEvents', sources.trakEvents?.length ? sources.trakEvents : undefined),
        ...optional('wam2', wam2),
        audioGraph: bound.audioGraph,
    } as SavedSongData;
}

/** One of the four quick song slots (pattern, tempo, meter and patches). */
export function buildSongSnapshot(): SongSnapshot {
    const mix = transportMixStore.getSnapshot();
    return {
        pattern: patternStore.getSnapshot(),
        tempo: mix.tempo,
        meter: transportMixStore.getMeter(),
        ambianceUrl: mix.ambianceUrl,
        backgroundImage: mix.backgroundImage,
        params: { ...instrumentStore.getParams() },
    };
}
