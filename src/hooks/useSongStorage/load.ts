/**
 * Loading into the project (#1597 P2 split of `useSongStorage`): `SavedSongData`
 * is the import format of the project doc.
 *
 * A song is migrated (`migrate.ts`), then its bound fields are applied through
 * the store bindings inside one `load` edit: one doc transaction that is not
 * undoable and clears the undo history (inside a co-producer step it is that
 * step instead). What the doc does not hold — the background image, MIDI
 * mappings, the .rbs extras, sample audio, WAM2 plugin state, the master PCF —
 * is restored to its owner afterwards.
 */

import type { AudioEngine, Pattern, PartSequence, ResolvedTrakEvent, SavedSongData } from '@/types';
import type { SongSnapshot, TrackKey } from '@/constants/appDefaults';
import { DEFAULT_BASS2_PARAMS } from '@/constants';
import { liveProject } from '@/collab/liveProject';
import { applySongToBoundStores } from '@/collab/appBindings';
import { automationStore } from '@/stores/automationStore';
import { instrumentStore } from '@/stores/instrumentStore';
import { midiMapStore } from '@/stores/midiMapStore';
import { patternStore } from '@/stores/patternStore';
import { samplerBanksStore } from '@/stores/samplerBanksStore';
import { transportMixStore } from '@/stores/transportMixStore';
import { getWamHost } from '@/audio/wam';
import { applyPcfFilterToEffect } from '@/importers/rbs/applyImportedEngineState';
import { isE2eMode, setE2eLaneCount } from '@/e2e/probe';
import { migrateTrackStorage } from '@/utils/trackStorageUtils';
import { resolveSongMeter } from '@/utils/songMeter';
import type { RbsArrangementExtras } from '../appState/useSongModeState';
import { readBoundSong } from './save';
import { normalizeLoadedSong } from './migrate';

export interface LoadTargets {
    audioEngine: AudioEngine | null;
    setSampleBuffers: (buffers: (AudioBuffer | null)[]) => void;
    rbsExtrasRef?: { current: RbsArrangementExtras | null };
    trakEventsRef?: { current: ResolvedTrakEvent[] | null };
}

/** Decode a song's embedded banks into the engine; one buffer (or null) per bank. */
async function decodeEmbeddedSamples(
    embedded: Record<string, string>,
    audioEngine: AudioEngine,
): Promise<(AudioBuffer | null)[]> {
    const buffers = new Array<AudioBuffer | null>(8).fill(null);
    await Promise.all(Object.entries(embedded).map(async ([idx, b64]) => {
        try {
            const arrayBuf = await (await fetch(b64)).arrayBuffer();
            const audioBuf = await audioEngine.context.decodeAudioData(arrayBuf);
            const bankIdx = parseInt(idx);
            await audioEngine.loadSampleToEngine(`bank_${bankIdx}`, audioBuf);
            buffers[bankIdx] = audioBuf;
        } catch (e) {
            console.error(`Failed to load sample bank ${idx}`, e);
        }
    }));
    return buffers;
}

/** Replace the project with `song`. */
export async function loadSongData(song: SavedSongData, targets: LoadTargets): Promise<void> {
    const { audioEngine } = targets;
    const bound = normalizeLoadedSong(song, readBoundSong() as Partial<SavedSongData>);
    liveProject.edit('load', () => {
        applySongToBoundStores(bound);
        if (song.backgroundImage !== undefined) transportMixStore.setBackgroundImage(song.backgroundImage);
    });
    midiMapStore.importSongMappings(song.midiMappings);
    if (targets.rbsExtrasRef) {
        targets.rbsExtrasRef.current = {
            loopStart: song.rbsLoopStart,
            loopEnd: song.rbsLoopEnd,
            trackParamStorage: song.trackParamStorage,
            pcfFilter: song.pcfFilter,
        };
    }
    if (song.rbsTrakEvents?.length && targets.trakEventsRef) {
        targets.trakEventsRef.current = song.rbsTrakEvents;
    }
    if (song.embeddedSamples && audioEngine) {
        targets.setSampleBuffers(await decodeEmbeddedSamples(song.embeddedSamples, audioEngine));
    }
    const wamHost = getWamHost();
    if (wamHost) await wamHost.restore(song.wam2);
    applyPcfFilterToEffect(song.pcfFilter, audioEngine?.pcfEffect ?? null);
    if (isE2eMode()) setE2eLaneCount(automationStore.getState().lanes.length);
}

/** A pattern bank file: every track's 32 slots. */
export function loadBankData(trackStorage: Record<TrackKey, (PartSequence | PartSequence[] | null)[]>): void {
    samplerBanksStore.setTrackStorage(migrateTrackStorage(trackStorage));
}

/** A pattern file: the live pattern only. */
export function loadPatternData(pattern: Pattern): void {
    patternStore.set(pattern);
}

/** Recall one of the four quick song slots (an ordinary, undoable edit). */
export function loadSongSnapshot(snapshot: SongSnapshot): void {
    patternStore.set(snapshot.pattern);
    transportMixStore.setTempo(snapshot.tempo);
    transportMixStore.applyMeter(resolveSongMeter(snapshot.meter));
    transportMixStore.setAmbianceUrl(snapshot.ambianceUrl);
    transportMixStore.setBackgroundImage(snapshot.backgroundImage);
    instrumentStore.setMany({ ...snapshot.params, bass2: snapshot.params.bass2 ?? DEFAULT_BASS2_PARAMS });
}
