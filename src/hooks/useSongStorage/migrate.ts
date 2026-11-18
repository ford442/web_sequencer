/**
 * Loaded songs, made current (#1597 P2 split of `useSongStorage`). Pure: no
 * stores, no engine.
 *
 * `normalizeLoadedSong` turns any saved song (v1–v6, an import's output) into
 * the bound fields at the current schema, exactly as the old `loadCloudData`
 * did field by field: legacy meters resolve to 32 steps 4/4 straight, v1–v4
 * song structures become arrangements, sampler banks gain their mode and
 * nested expressiveness, track storage grows to 32 slots, the session is
 * migrated, lyrics fill to eight banks. A field the song does not carry
 * keeps the value in `current` (what the stores hold now).
 */

import type { SavedSongData, SamplerParams, UnifiedAutomationLane } from '@/types';
import type { TrackKey } from '@/constants/appDefaults';
import { DEFAULT_BASS2_PARAMS } from '@/constants';
import { convertHyphonLanes } from '@/stores/automationStore';
import { normalizeSongNoteFx } from '@/sequencer/noteFx/params';
import { normalizeArrangement, projectArrangement, songStructureToArrangement } from '@/arrangement/model';
import { audioTrackStateOf } from '@/arrangement/audioTracks';
import { migrateSavedSongSession } from '@/session/migrate';
import { resolveSongMeter } from '@/utils/songMeter';
import {
    createEmptyTrackStorage,
    defaultActiveTrackSlots,
    deriveActiveTrackSlotsFromStructure,
    migrateTrackStorage,
    SAVED_SONG_DATA_VERSION,
} from '@/utils/trackStorageUtils';

const DEFAULT_PHRASE = 'Hello World';
const BANKS = 8;

/** Sampler banks with a play mode and nested expressiveness (legacy flat fields hydrated). */
export function normalizeSamplerParams(sampler: SamplerParams): SamplerParams {
    return sampler.map((bank) => ({
        ...bank,
        mode: bank.mode || 'loop',
        // Backward-compat: hydrate nested expressiveness from legacy flat fields.
        expressiveness: bank.expressiveness ?? {
            vibratoRate: 5.5,
            vibratoDepth: bank.vibratoDepth ?? 0,
            tremoloDepth: bank.tremoloDepth ?? 0,
            breathAmount: bank.breathIntensity ?? 0,
        },
    }));
}

/** Eight phrases, one per sampler bank; missing ones are the default. */
export function normalizeTtsPhrases(phrases: unknown): string[] {
    if (Array.isArray(phrases) && phrases.length === BANKS) return phrases as string[];
    const out = Array<string>(BANKS).fill(DEFAULT_PHRASE);
    if (Array.isArray(phrases)) {
        phrases.forEach((phrase, i) => {
            if (i < BANKS) out[i] = (phrase as string) || DEFAULT_PHRASE;
        });
    }
    return out;
}

/**
 * The bound fields of a loaded song (see `collab/appBindings.ts`), migrated.
 * `current` supplies what a song without a field keeps.
 */
export function normalizeLoadedSong(song: SavedSongData, current: Partial<SavedSongData>): Partial<SavedSongData> {
    const meter = resolveSongMeter(song);
    const p = song.params;
    const params = {
        ...(current.params as SavedSongData['params']),
        ...(p?.synthA ? { synthA: p.synthA } : {}),
        ...(p?.synthB ? { synthB: p.synthB } : {}),
        ...(p?.bass2 ? { bass2: p.bass2 } : {}),
        ...(p?.kick ? { kick: p.kick } : {}),
        ...(p?.snare ? { snare: p.snare } : {}),
        ...(p?.closedHat ? { closedHat: p.closedHat } : {}),
        ...(p?.openHat ? { openHat: p.openHat } : {}),
        ...(p?.sampler ? { sampler: normalizeSamplerParams(p.sampler) } : {}),
    };
    const trackStorage = song.trackStorage
        ? migrateTrackStorage(song.trackStorage)
        : (current.trackStorage as SavedSongData['trackStorage']);
    const activeTrackSlots = song.activeTrackSlots
        ?? (song.songStructure
            ? deriveActiveTrackSlotsFromStructure(song.songStructure as Array<Partial<Record<TrackKey, number | null>>>)
            : current.activeTrackSlots);
    // v5 songs carry the arrangement; v1–v4 get one clip per Song Mode cell.
    const arrangement = normalizeArrangement(song.arrangement)
        ?? (Array.isArray(song.songStructure)
            ? songStructureToArrangement(song.songStructure as Array<Partial<Record<TrackKey, unknown>>>, meter.stepCount)
            : normalizeArrangement(current.arrangement));
    const noteFx = normalizeSongNoteFx(song.noteFx);
    // v6 (#1629): a v5 song has no audio tracks, and loads with none.
    const audio = audioTrackStateOf(song, arrangement);
    return {
        pattern: song.pattern ?? current.pattern,
        params,
        trackStorage,
        activeTrackSlots,
        ttsPhrases: normalizeTtsPhrases(song.ttsPhrases),
        tempo: song.tempo || current.tempo,
        swing: meter.swing,
        stepCount: meter.stepCount,
        timeSignature: meter.timeSignature,
        trackLengths: Object.keys(meter.trackLengths).length > 0 ? meter.trackLengths : undefined,
        ambianceUrl: song.ambianceUrl ?? current.ambianceUrl,
        ...(arrangement
            ? { arrangement, songStructure: projectArrangement(arrangement, meter.stepCount) }
            : {}),
        audioTracks: audio.tracks.length > 0 ? [...audio.tracks] : undefined,
        media: Object.keys(audio.media).length > 0 ? { ...audio.media } : undefined,
        session: migrateSavedSongSession(song.version, song.session, migrateTrackStorage(song.trackStorage ?? {})),
        // Absent clears: a loaded song replaces every lane and chain.
        automationLanes: song.automationLanes && song.automationLanes.length > 0 ? song.automationLanes : undefined,
        noteFx: Object.keys(noteFx).length > 0 ? noteFx : undefined,
        audioGraph: song.audioGraph,
    };
}

/** Storage holding only `pattern`, in slot 0 of each track (imports without an arrangement). */
function storageFromPattern(pattern: SavedSongData['pattern']): SavedSongData['trackStorage'] {
    const storage = createEmptyTrackStorage();
    storage.partA[0] = pattern.partA;
    storage.partB[0] = pattern.partB;
    storage.bass2[0] = pattern.bass2;
    storage.kick[0] = pattern.kick;
    storage.snare[0] = pattern.snare;
    storage.closedHat[0] = pattern.closedHat;
    storage.openHat[0] = pattern.openHat;
    storage.sampler[0] = pattern.sampler;
    return storage;
}

/** Sixteen measures of slot 0 (imports without an arrangement). */
function defaultStructure(): SavedSongData['songStructure'] {
    return Array(16).fill(null).map(() => ({
        partA: 0, partB: 0, bass2: 0, kick: 0,
        snare: 0, closedHat: 0, openHat: 0, sampler: null,
    }));
}

/** RBS imports carry no sampler params; these are the banks they get. */
function defaultImportSamplerBanks(): SamplerParams {
    return Array.from({ length: BANKS }, () => ({
        sampleName: 'bank_0',
        playbackSpeed: 1.0,
        volume: 1.0,
        filterCutoff: 20000,
        filterResonance: 0,
        drive: 0,
        delaySend: 0,
        mode: 'loop',
        grainSize: 4410,
        expressiveness: {
            vibratoRate: 5.5,
            vibratoDepth: 0,
            tremoloDepth: 0,
            breathAmount: 0,
        },
    })) as SamplerParams;
}

/** A ReBirth import as a saved song (its 303 knobs, arrangement and RBS extras included). */
export function rbsImportToSavedSong(song: import('@/importers/rbs').HyphonSong): SavedSongData {
    const automationLanes: UnifiedAutomationLane[] | undefined = song.automation && song.automation.length > 0
        ? convertHyphonLanes(song.automation)
        : undefined;
    // A full song arrangement when the importer produced one; else one slot.
    const arrangement = song.songArrangement;
    const songStructure = arrangement ? arrangement.songStructure : defaultStructure();
    const activeTrackSlots = arrangement?.activeTrackSlots
        ? { ...defaultActiveTrackSlots(), ...arrangement.activeTrackSlots }
        : deriveActiveTrackSlotsFromStructure(songStructure as Array<Partial<Record<TrackKey, number | null>>>);
    return {
        version: SAVED_SONG_DATA_VERSION,
        pattern: song.pattern,
        tempo: song.tempo,
        stepCount: song.stepCount,
        timeSignature: song.timeSignature,
        swing: song.swing,
        ambianceUrl: '',
        backgroundImage: '',
        params: {
            synthA: song.params.synthA,
            synthB: song.params.synthB,
            bass2: song.params.bass2 ?? DEFAULT_BASS2_PARAMS,
            kick: song.params.kick,
            snare: song.params.snare,
            closedHat: song.params.closedHat,
            openHat: song.params.openHat,
            sampler: defaultImportSamplerBanks(),
        },
        trackStorage: arrangement ? migrateTrackStorage(arrangement.trackStorage) : storageFromPattern(song.pattern),
        activeTrackSlots,
        songStructure,
        ttsPhrases: Array(BANKS).fill(DEFAULT_PHRASE),
        ...(automationLanes ? { automationLanes } : {}),
        ...(arrangement?.loopStart != null ? { rbsLoopStart: arrangement.loopStart } : {}),
        ...(arrangement?.loopEnd != null ? { rbsLoopEnd: arrangement.loopEnd } : {}),
        ...(song.pcfFilter ? { pcfFilter: song.pcfFilter } : {}),
        ...(arrangement?.trackParamStorage ? { trackParamStorage: arrangement.trackParamStorage } : {}),
    };
}

/**
 * A Standard MIDI File import as a saved song. SMF carries no Hyphon knobs,
 * so the song keeps `params` (the current patches) and replaces the pattern
 * data and (optional) CC74 automation only.
 */
export function smfImportToSavedSong(
    song: import('@/importers/smf').HyphonSmfSong,
    params: SavedSongData['params'],
): SavedSongData {
    const automationLanes: UnifiedAutomationLane[] | undefined = song.automation && song.automation.length > 0
        ? convertHyphonLanes(song.automation as unknown as Parameters<typeof convertHyphonLanes>[0])
        : undefined;
    const arrangement = song.songArrangement;
    const songStructure = arrangement ? arrangement.songStructure : defaultStructure();
    return {
        version: SAVED_SONG_DATA_VERSION,
        pattern: song.pattern,
        tempo: song.tempo,
        stepCount: song.stepCount,
        timeSignature: song.timeSignature,
        ambianceUrl: '',
        backgroundImage: '',
        params,
        trackStorage: arrangement ? migrateTrackStorage(arrangement.trackStorage) : storageFromPattern(song.pattern),
        activeTrackSlots: deriveActiveTrackSlotsFromStructure(songStructure as Array<Partial<Record<TrackKey, number | null>>>),
        songStructure,
        ttsPhrases: Array(BANKS).fill(DEFAULT_PHRASE),
        ...(automationLanes ? { automationLanes } : {}),
    };
}
