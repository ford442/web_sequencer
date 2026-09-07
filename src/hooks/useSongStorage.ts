import { useCallback, useState } from 'react';
import type { MutableRefObject } from 'react';
import { Open303Manager } from '../engines/Open303Manager';
import type { AudioEngine, Pattern, SynthParams, KickParams, SnareParams, HatParams, SamplerParams, SamplerBankParams, PartSequence, SavedSongData, Bass2Params, DrumKitType, UnifiedAutomationLane, ResolvedTrakEvent } from '../types';
import {
  migrateTrackStorage,
  deriveActiveTrackSlotsFromStructure,
  createEmptyTrackStorage,
  defaultActiveTrackSlots,
  SAVED_SONG_DATA_VERSION,
} from '../utils/trackStorageUtils';
import type { CloudItemType } from '../services/CloudStorage';
import type { AISongData } from '../importers/ai-song';
import type { TrackKey, SongSnapshot } from '../constants/appDefaults';
import type { ScaleDefinition } from '../utils/musicTheory';
import { DEFAULT_BASS2_PARAMS } from '../constants';
import { audioBufferToWav, blobToBase64 } from '../utils/audioExport';
import { automationStore, convertHyphonLanes } from '../stores/automationStore';
import { midiMapStore } from '../stores/midiMapStore';
import { e2eTransportSnapshot, isE2eMode, setE2eLaneCount } from '../e2e/probe';
import { RbsExporter, hyphonSongFromSavedData, shouldExportRbsSongMode } from '../importers/rbs';
import { applyPcfFilterToEffect, convert303Waveform } from '../importers/rbs/applyImportedEngineState';
import type { RbsArrangementExtras } from './appState/useSongModeState';
import { migrateSavedSongSession } from '../session/migrate';
import { getWamHost } from '../audio/wam';
import {
    DEFAULT_PRESET_ID,
    GRAPH_SCHEMA_VERSION,
    getActivePatchController,
    restorePatchFromSong,
} from '../audio/graph';

// ---- Types for the hook parameters ----

export type AiImportStage = 'parsing' | 'validating' | 'converting' | 'uploading' | 'loading' | 'complete' | 'error' | null;

export interface SongStorageDeps {
    // Refs for latest values (avoid stale closures)
    patternRef: MutableRefObject<Pattern>;
    tempoRef: MutableRefObject<number>;
    synthARef: MutableRefObject<SynthParams>;
    synthBRef: MutableRefObject<SynthParams>;
    bass2Ref: MutableRefObject<Bass2Params>;
    kickRef: MutableRefObject<KickParams>;
    snareRef: MutableRefObject<SnareParams>;
    closedHatRef: MutableRefObject<HatParams>;
    openHatRef: MutableRefObject<HatParams>;
    samplerRef: MutableRefObject<SamplerParams>;
    trackStorageRef: MutableRefObject<Record<TrackKey, (PartSequence | PartSequence[] | null)[]>>;
    activeTrackSlotsRef: MutableRefObject<Record<TrackKey, number>>;
    songStructureRef: MutableRefObject<({ [key in TrackKey]: number | null })[]>;
    sessionDocumentRef?: MutableRefObject<import('../session/types').SessionDocument>;
    setSessionDocument?: (doc: import('../session/types').SessionDocument, recordUndo?: boolean) => void;

    // State values (needed as deps for serialization)
    ambianceUrl: string;
    backgroundImage: string;
    sampleBuffers: (AudioBuffer | null)[];
    ttsPhrases: string[];
    songStorage: (SongSnapshot | null)[];
    pattern: Pattern;
    tempo: number;
    trackStorage: Record<TrackKey, (PartSequence | PartSequence[] | null)[]>;

    // State setters
    setPattern: React.Dispatch<React.SetStateAction<Pattern>>;
    setTempo: React.Dispatch<React.SetStateAction<number>>;
    setAmbianceUrl: React.Dispatch<React.SetStateAction<string>>;
    setBackgroundImage: React.Dispatch<React.SetStateAction<string>>;
    setSynthA: React.Dispatch<React.SetStateAction<SynthParams>>;
    setSynthB: React.Dispatch<React.SetStateAction<SynthParams>>;
    setBass2: React.Dispatch<React.SetStateAction<Bass2Params>>;
    setKick: React.Dispatch<React.SetStateAction<KickParams>>;
    setSnare: React.Dispatch<React.SetStateAction<SnareParams>>;
    setClosedHat: React.Dispatch<React.SetStateAction<HatParams>>;
    setOpenHat: React.Dispatch<React.SetStateAction<HatParams>>;
    setSampler: React.Dispatch<React.SetStateAction<SamplerParams>>;
    setTrackStorage: React.Dispatch<React.SetStateAction<Record<TrackKey, (PartSequence | PartSequence[] | null)[]>>>;
    setActiveTrackSlots: React.Dispatch<React.SetStateAction<Record<TrackKey, number>>>;
    setSongStructure: React.Dispatch<React.SetStateAction<({ [key in TrackKey]: number | null })[]>>;
    setSampleBuffers: React.Dispatch<React.SetStateAction<(AudioBuffer | null)[]>>;
    setTtsPhrases: React.Dispatch<React.SetStateAction<string[]>>;
    setSongStorage: React.Dispatch<React.SetStateAction<(SongSnapshot | null)[]>>;
    setActiveSongSlot: React.Dispatch<React.SetStateAction<number | null>>;

    // Audio engine (may be null before init)
    audioEngine: AudioEngine | null;

    // Toast helper
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;

    // Modal setters referenced by import functions
    setIsAISongModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setIsRbsImportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;

    // Drum kit setter (optional for backwards compat)
    setDrumKit?: (kit: DrumKitType) => void;
    /** Activates song mode after a full-song RBS import. */
    setIsSongModeActive?: React.Dispatch<React.SetStateAction<boolean>>;
    /** Whether song arranger playback is currently active (RBS export mode). */
    isSongModeActive?: boolean;
    /** RBS arrangement extras persisted across import/export. */
    rbsArrangementExtrasRef?: MutableRefObject<RbsArrangementExtras | null>;
    /** Clears song-structure undo history after a full song replace (load/import). */
    clearSongUndo?: () => void;
    /** Ref populated with resolved TRAK events from the imported RBS song for sub-step automation. */
    trakEventsRef?: MutableRefObject<ResolvedTrakEvent[] | null>;
}

export interface SongStorageReturn {
    // Serialization
    getSongData: () => Promise<SavedSongData>;
    getBankData: () => { type: string; trackStorage: Record<TrackKey, (PartSequence | PartSequence[] | null)[]> };
    getPatternData: () => { type: string; pattern: Pattern };

    // File I/O
    exportSongToFile: () => Promise<void>;
    exportRbsToFile: () => Promise<void>;
    importSongFromFile: () => void;

    // Save / Load
    handleSaveSong: (slot: number) => Promise<void>;
    loadSong: (slot: number) => void;
    loadCloudData: (data: any, type: CloudItemType) => Promise<void>;

    // Importers
    handleAISongImport: (song: SavedSongData, aiData: AISongData) => Promise<void>;
    handleRbsImport: (song: import('../importers/rbs').HyphonSong) => void;

    // AI import progress state
    isImportingAISong: boolean;
    aiImportProgress: number;
    aiImportStage: AiImportStage;
    aiImportError: string | null;
    setIsImportingAISong: React.Dispatch<React.SetStateAction<boolean>>;
    setAiImportProgress: React.Dispatch<React.SetStateAction<number>>;
    setAiImportStage: React.Dispatch<React.SetStateAction<AiImportStage>>;
}

export function useSongStorage(deps: SongStorageDeps): SongStorageReturn {
    const {
        patternRef, tempoRef,
        synthARef, synthBRef, bass2Ref, kickRef, snareRef, closedHatRef, openHatRef, samplerRef,
        trackStorageRef, activeTrackSlotsRef, songStructureRef,
        sessionDocumentRef, setSessionDocument,
        ambianceUrl, backgroundImage, sampleBuffers, ttsPhrases,
        songStorage, pattern, tempo, trackStorage,
        setPattern, setTempo, setAmbianceUrl, setBackgroundImage,
        setSynthA, setSynthB, setBass2, setKick, setSnare, setClosedHat, setOpenHat, setSampler,
        setTrackStorage, setActiveTrackSlots, setSongStructure, setSampleBuffers, setTtsPhrases,
        setSongStorage, setActiveSongSlot,
        audioEngine, showToast,
        setIsAISongModalOpen, setIsRbsImportModalOpen,
        clearSongUndo,
    } = deps;

    // AI Song Import loading states
    const [isImportingAISong, setIsImportingAISong] = useState(false);
    const [aiImportProgress, setAiImportProgress] = useState(0);
    const [aiImportStage, setAiImportStage] = useState<AiImportStage>(null);
    const [aiImportError, setAiImportError] = useState<string | null>(null);

    // ---- Serialization helpers ----

    const getSongData = useCallback(async () => {
        const encodedSamples: { [k: number]: string } = {};
        await Promise.all(sampleBuffers.map(async (buf, idx) => {
            if (buf) {
                const wavBlob = await audioBufferToWav(buf);
                const b64 = await blobToBase64(wavBlob);
                encodedSamples[idx] = b64;
            }
        }));
        // automationStore is a module singleton — exportLanes() reads its current state at call time,
        // so memoization of this callback does not cause stale automation data.
        const exportedLanes = automationStore.exportLanes();
        const exportedMidi = midiMapStore.exportMappings();
        return {
            version: SAVED_SONG_DATA_VERSION,
            pattern: patternRef.current,
            tempo: tempoRef.current,
            ambianceUrl,
            backgroundImage,
            params: {
                synthA: synthARef.current,
                synthB: synthBRef.current,
                bass2: bass2Ref.current,
                kick: kickRef.current,
                snare: snareRef.current,
                closedHat: closedHatRef.current,
                openHat: openHatRef.current,
                sampler: samplerRef.current,
            },
            trackStorage: trackStorageRef.current,
            activeTrackSlots: activeTrackSlotsRef.current,
            songStructure: songStructureRef.current,
            session: sessionDocumentRef?.current,
            embeddedSamples: encodedSamples,
            ttsPhrases,
            ...(exportedLanes.length > 0 ? { automationLanes: exportedLanes } : {}),
            ...(exportedMidi.length > 0 ? { midiMappings: exportedMidi } : {}),
            ...(deps.rbsArrangementExtrasRef?.current?.loopStart != null
                ? { rbsLoopStart: deps.rbsArrangementExtrasRef.current.loopStart }
                : {}),
            ...(deps.rbsArrangementExtrasRef?.current?.loopEnd != null
                ? { rbsLoopEnd: deps.rbsArrangementExtrasRef.current.loopEnd }
                : {}),
            ...(deps.rbsArrangementExtrasRef?.current?.pcfFilter
                ? { pcfFilter: deps.rbsArrangementExtrasRef.current.pcfFilter }
                : {}),
            ...(deps.rbsArrangementExtrasRef?.current?.trackParamStorage
                ? { trackParamStorage: deps.rbsArrangementExtrasRef.current.trackParamStorage }
                : {}),
            ...(deps.trakEventsRef?.current?.length
                ? { rbsTrakEvents: deps.trakEventsRef.current }
                : {}),
            ...(() => {
                const host = getWamHost();
                if (!host) return {};
                const payload = host.exportSongState();
                return payload.plugins.length > 0 ? { wam2: payload } : {};
            })(),
            audioGraph: getActivePatchController()?.serialize() ?? {
                schemaVersion: GRAPH_SCHEMA_VERSION,
                presetId: DEFAULT_PRESET_ID,
            },
        } as SavedSongData;
    }, [ambianceUrl, backgroundImage, sampleBuffers, ttsPhrases]);

    const getBankData = useCallback(() => {
        return { type: 'bank', trackStorage };
    }, [trackStorage]);

    const getPatternData = useCallback(() => {
        return { type: 'pattern', pattern };
    }, [pattern]);

    // ---- Load helpers ----

    const loadCloudData = useCallback(async (data: unknown, type: CloudItemType) => {
        console.log("Loading Cloud Data:", type, data);
        if (type === 'song') {
            const songData = data as SavedSongData;
            if (songData.pattern) setPattern(songData.pattern);
            if (songData.tempo) setTempo(songData.tempo);
            if (songData.ambianceUrl !== undefined) setAmbianceUrl(songData.ambianceUrl);
            if (songData.backgroundImage !== undefined) setBackgroundImage(songData.backgroundImage);
            if (songData.params) {
                if (songData.params.synthA) { setSynthA(songData.params.synthA); synthARef.current = songData.params.synthA; }
                if (songData.params.synthB) { setSynthB(songData.params.synthB); synthBRef.current = songData.params.synthB; }
                if (songData.params.bass2) { setBass2(songData.params.bass2); bass2Ref.current = songData.params.bass2; }
                if (songData.params.kick) { setKick(songData.params.kick); kickRef.current = songData.params.kick; }
                if (songData.params.snare) { setSnare(songData.params.snare); snareRef.current = songData.params.snare; }
                if (songData.params.closedHat) { setClosedHat(songData.params.closedHat); closedHatRef.current = songData.params.closedHat; }
                if (songData.params.openHat) { setOpenHat(songData.params.openHat); openHatRef.current = songData.params.openHat; }
                if (songData.params.sampler) {
                    const samplerWithMode = songData.params.sampler.map(bank => ({
                        ...bank,
                        mode: (bank.mode || 'loop') as 'loop' | 'stretch' | 'wavetable',
                        // Backward-compat: hydrate nested expressiveness from legacy flat fields.
                        expressiveness: bank.expressiveness ?? {
                            vibratoRate: 5.5,
                            vibratoDepth: bank.vibratoDepth ?? 0,
                            tremoloDepth: bank.tremoloDepth ?? 0,
                            breathAmount: bank.breathIntensity ?? 0,
                        },
                    }));
                    setSampler(samplerWithMode);
                    samplerRef.current = samplerWithMode;
                }
            }
            if (songData.trackStorage) {
                const migrated = migrateTrackStorage(songData.trackStorage);
                setTrackStorage(migrated);
            }
            if (songData.activeTrackSlots) {
                setActiveTrackSlots(songData.activeTrackSlots as unknown as Record<TrackKey, number>);
            } else if (songData.songStructure) {
                setActiveTrackSlots(
                    deriveActiveTrackSlotsFromStructure(
                        songData.songStructure as Array<Partial<Record<TrackKey, number | null>>>,
                    ),
                );
            }
            if (songData.songStructure) {
                clearSongUndo?.();
                setSongStructure(songData.songStructure as unknown as ({ [key in TrackKey]: number | null })[]);
            }
            if (setSessionDocument) {
                const migrated = migrateTrackStorage(songData.trackStorage ?? {});
                setSessionDocument(
                    migrateSavedSongSession(songData.version, songData.session, migrated),
                    false,
                );
            }
            if (songData.ttsPhrases && Array.isArray(songData.ttsPhrases) && songData.ttsPhrases.length === 8) {
                setTtsPhrases(songData.ttsPhrases);
            } else if (songData.ttsPhrases && Array.isArray(songData.ttsPhrases)) {
                const normalized = Array(8).fill("Hello World");
                songData.ttsPhrases.forEach((phrase, idx) => { if (idx < 8) normalized[idx] = phrase || "Hello World"; });
                setTtsPhrases(normalized);
            } else {
                setTtsPhrases(Array(8).fill("Hello World"));
            }
            if (songData.embeddedSamples && audioEngine) {
                const loadedBuffers = new Array(8).fill(null);
                await Promise.all(Object.entries(songData.embeddedSamples).map(async ([idx, b64]) => {
                    try {
                        const fetchRes = await fetch(b64);
                        const arrayBuf = await fetchRes.arrayBuffer();
                        const audioBuf = await audioEngine.context.decodeAudioData(arrayBuf);
                        const bankIdx = parseInt(idx);
                        const bankName = `bank_${bankIdx}`;
                        await audioEngine.loadSampleToEngine(bankName, audioBuf);
                        loadedBuffers[bankIdx] = audioBuf;
                    } catch (e) {
                        console.error(`Failed to load sample bank ${idx}`, e);
                    }
                }));
                setSampleBuffers(loadedBuffers);
            }
            // Restore automation lanes — importLanes replaces all existing lanes (including clearing when empty).
            automationStore.importLanes(songData.automationLanes ?? []);
            midiMapStore.importSongMappings(songData.midiMappings);
            const wamHost = getWamHost();
            if (wamHost) {
                await wamHost.restore(songData.wam2);
            }
            restorePatchFromSong(songData.audioGraph);
            if (deps.rbsArrangementExtrasRef) {
                deps.rbsArrangementExtrasRef.current = {
                    loopStart: songData.rbsLoopStart,
                    loopEnd: songData.rbsLoopEnd,
                    trackParamStorage: songData.trackParamStorage,
                    pcfFilter: songData.pcfFilter,
                };
            }
            if (songData.rbsTrakEvents?.length && deps.trakEventsRef) {
                deps.trakEventsRef.current = songData.rbsTrakEvents;
            }
            applyPcfFilterToEffect(songData.pcfFilter, audioEngine?.pcfEffect ?? null);
            if (isE2eMode()) {
                setE2eLaneCount(automationStore.getState().lanes.length);
            }
            showToast("Song loaded!", "success");
        } else if (type === 'bank') {
            const bankData = data as { trackStorage?: Record<TrackKey, (PartSequence | PartSequence[] | null)[]> };
            if (bankData.trackStorage) {
                setTrackStorage(migrateTrackStorage(bankData.trackStorage));
                showToast("Pattern Bank loaded!", "success");
            }
        } else if (type === 'pattern') {
            const patternData = data as { pattern?: Pattern };
            if (patternData.pattern) {
                setPattern(patternData.pattern);
                showToast("Pattern loaded!", "success");
            }
        }
    }, [audioEngine, sampleBuffers, showToast]);

    const handleSaveSong = useCallback(async (slot: number) => {
        const encodedSamples: { [k: number]: string } = {};
        await Promise.all(sampleBuffers.map(async (buf, idx) => {
            if (buf) {
                const wavBlob = await audioBufferToWav(buf);
                const b64 = await blobToBase64(wavBlob);
                encodedSamples[idx] = b64;
            }
        }));
        const snapshot: SongSnapshot = {
            pattern,
            tempo,
            ambianceUrl,
            backgroundImage,
            params: {
                synthA: synthARef.current,
                synthB: synthBRef.current,
                bass2: bass2Ref.current,
                kick: kickRef.current,
                snare: snareRef.current,
                closedHat: closedHatRef.current,
                openHat: openHatRef.current,
                sampler: samplerRef.current,
            },
        };
        setSongStorage(prev => { const copy = [...prev]; copy[slot] = snapshot; return copy; });
        setActiveSongSlot(slot);
    }, [sampleBuffers, pattern, tempo, ambianceUrl, backgroundImage]);

    const loadSong = useCallback((slot: number) => {
        const snapshot = songStorage[slot];
        if (!snapshot) return;
        setPattern(snapshot.pattern);
        setTempo(snapshot.tempo);
        setAmbianceUrl(snapshot.ambianceUrl);
        setBackgroundImage(snapshot.backgroundImage);
        setSynthA(snapshot.params.synthA);
        setSynthB(snapshot.params.synthB);
        setBass2(snapshot.params.bass2 ?? DEFAULT_BASS2_PARAMS);
        setKick(snapshot.params.kick);
        setSnare(snapshot.params.snare);
        setClosedHat(snapshot.params.closedHat);
        setOpenHat(snapshot.params.openHat);
        setSampler(snapshot.params.sampler);
        setActiveSongSlot(slot);
        synthARef.current = snapshot.params.synthA;
        synthBRef.current = snapshot.params.synthB;
        bass2Ref.current = snapshot.params.bass2 ?? DEFAULT_BASS2_PARAMS;
        kickRef.current = snapshot.params.kick;
        snareRef.current = snapshot.params.snare;
        closedHatRef.current = snapshot.params.closedHat;
        openHatRef.current = snapshot.params.openHat;
        samplerRef.current = snapshot.params.sampler;
    }, [songStorage]);

    // ---- File I/O ----

    const exportSongToFile = useCallback(async () => {
        const songData = await getSongData();
        const jsonStr = JSON.stringify(songData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `hyphon-song-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [getSongData]);

    const exportRbsToFile = useCallback(async () => {
        try {
            const songData = await getSongData();
            const exporter = new RbsExporter();
            const song = hyphonSongFromSavedData(songData, {
                trakEvents: deps.trakEventsRef?.current,
                isSongModeActive: deps.isSongModeActive,
            });
            const exportMode = shouldExportRbsSongMode(songData, deps.isSongModeActive)
                ? 'song'
                : 'pattern';
            const result = exporter.exportToBlob(song, {
                songName: song.metadata.name,
                mode: exportMode,
            });
            if (!result.success || !result.blob) {
                showToast(result.error ?? 'RBS export failed', 'error');
                return;
            }
            if (result.warnings.length > 0) {
                console.warn('[RBS Export warnings]', result.warnings);
            }
            const url = URL.createObjectURL(result.blob);
            const a = document.createElement('a');
            a.href = url;
            const safeName = (song.metadata.name || 'hyphon-song').replace(/[^\w.-]+/g, '_');
            a.download = `${safeName}.rbs`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast(
                result.warnings.length > 0
                    ? `Exported .rbs (${result.warnings.length} compatibility warnings)`
                    : 'Exported ReBirth .rbs file!',
                result.warnings.length > 0 ? 'info' : 'success',
            );
        } catch (err) {
            console.error('RBS export failed:', err);
            showToast('Failed to export .rbs file', 'error');
        }
    }, [getSongData, showToast]);

    const importSongFromFile = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const songData: unknown = JSON.parse(text);
                await loadCloudData(songData, 'song');
            } catch (err) {
                console.error('Failed to load song:', err);
                showToast("Failed to load song file.", "error");
            }
        };
        input.click();
    }, [loadCloudData, showToast]);

    // ---- AI Song Import ----

    const handleAISongImport = useCallback(async (song: SavedSongData, aiData: AISongData) => {
        setIsImportingAISong(true);
        setAiImportProgress(0);
        setAiImportError(null);

        try {
            // Stage 1: Parsing (handled in modal, but show in overlay)
            setAiImportStage('parsing');
            setAiImportProgress(10);
            await new Promise(resolve => setTimeout(resolve, 100));

            // Stage 2: Validating
            setAiImportStage('validating');
            setAiImportProgress(25);
            await new Promise(resolve => setTimeout(resolve, 150));

            // Stage 3: Converting
            setAiImportStage('converting');
            setAiImportProgress(40);
            await new Promise(resolve => setTimeout(resolve, 150));

            // Stage 4: Attempt cloud upload (optional, can fail gracefully)
            setAiImportStage('uploading');
            setAiImportProgress(60);

            // Try to save to cloud storage if available
            try {
                const { CloudStorage } = await import('../services/CloudStorage');
                const cloud = CloudStorage;
                await cloud.uploadItem({
                    name: aiData.meta.title,
                    data: song,
                    type: 'song',
                    author: aiData.meta.author,
                    description: `Generated by ${aiData.meta.generator}`,
                });
                setAiImportProgress(80);
            } catch (cloudError) {
                // Cloud upload failed but we'll continue with local import
                console.warn('Cloud upload failed:', cloudError);
                showToast('Song imported locally (cloud upload failed)', 'info');
                setAiImportProgress(80);
            }

            // Stage 5: Loading into sequencer
            setAiImportStage('loading');
            setAiImportProgress(90);
            await new Promise(resolve => setTimeout(resolve, 200));

            // Load the song data using existing loadCloudData logic
            await loadCloudData(song, 'song');

            // Complete
            setAiImportProgress(100);
            setAiImportStage('complete');

            showToast(`✨ Imported "${aiData.meta.title}" by ${aiData.meta.author}`, 'success');

            // Close modal after brief delay on success
            setTimeout(() => {
                setIsAISongModalOpen(false);
                setIsImportingAISong(false);
                setAiImportStage(null);
                setAiImportProgress(0);
            }, 1500);
        } catch (error) {
            console.error('AI Song Import Error:', error);
            setAiImportStage('error');

            // Provide specific error messages based on error type
            let errorMessage = 'Import failed: Unknown error';
            if (error instanceof Error) {
                if (error.message.includes('JSON') || error.message.includes('parse')) {
                    errorMessage = `Invalid JSON syntax: ${error.message}`;
                } else if (error.message.includes('validation') || error.message.includes('required')) {
                    errorMessage = `Song validation failed: ${error.message}`;
                } else if (error.message.includes('network') || error.message.includes('fetch')) {
                    errorMessage = 'Network error - song saved locally';
                } else {
                    errorMessage = `Import failed: ${error.message}`;
                }
            }

            setAiImportError(errorMessage);
            showToast(errorMessage, 'error');

            // Keep overlay visible for a moment so user can see error
            setTimeout(() => {
                setIsImportingAISong(false);
                setAiImportStage(null);
                setAiImportError(null);
            }, 3000);

            // Re-throw so modal can handle retry if needed
            throw error;
        }
    }, [loadCloudData, showToast]);

    // ---- RBS Import ----
    const handleRbsImport = useCallback((song: import('../importers/rbs').HyphonSong) => {
        // Convert HyphonSong automation lanes using the centralized automationStore converter
        const automationLanes: UnifiedAutomationLane[] | undefined = song.automation && song.automation.length > 0
            ? convertHyphonLanes(song.automation)
            : undefined;

        // Convert HyphonSong to SavedSongData format
        // When the importer produced a full song arrangement, use it; otherwise
        // fall back to a single-slot arrangement from the primary pattern.
        const arrangement = song.songArrangement;

        const trackStorage: SavedSongData['trackStorage'] = arrangement
            ? migrateTrackStorage(arrangement.trackStorage)
            : (() => {
                const storage = createEmptyTrackStorage();
                storage.partA[0] = song.pattern.partA;
                storage.partB[0] = song.pattern.partB;
                storage.bass2[0] = song.pattern.bass2;
                storage.kick[0] = song.pattern.kick;
                storage.snare[0] = song.pattern.snare;
                storage.closedHat[0] = song.pattern.closedHat;
                storage.openHat[0] = song.pattern.openHat;
                storage.sampler[0] = song.pattern.sampler;
                return storage;
            })();

        const songStructure: SavedSongData['songStructure'] = arrangement
            ? arrangement.songStructure
            : Array(16).fill(null).map(() => ({
                partA: 0, partB: 0, bass2: 0, kick: 0,
                snare: 0, closedHat: 0, openHat: 0, sampler: null,
            }));

        const activeTrackSlots = arrangement?.activeTrackSlots
            ? { ...defaultActiveTrackSlots(), ...arrangement.activeTrackSlots }
            : deriveActiveTrackSlotsFromStructure(
                songStructure as Array<Partial<Record<TrackKey, number | null>>>,
            );

        const savedSong: SavedSongData = {
            version: SAVED_SONG_DATA_VERSION,
            pattern: song.pattern,
            tempo: song.tempo,
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
                // RBS imports carry no sampler params; seed default banks.
                sampler: Array.from({ length: 8 }, () => ({
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
                })),
            },
            trackStorage,
            activeTrackSlots,
            songStructure,
            ttsPhrases: Array(8).fill('Hello World'),
            ...(automationLanes ? { automationLanes } : {}),
            ...(arrangement?.loopStart != null ? { rbsLoopStart: arrangement.loopStart } : {}),
            ...(arrangement?.loopEnd != null ? { rbsLoopEnd: arrangement.loopEnd } : {}),
            ...(song.pcfFilter ? { pcfFilter: song.pcfFilter } : {}),
            ...(arrangement?.trackParamStorage ? { trackParamStorage: arrangement.trackParamStorage } : {}),
        };

        // Also set bass2 params if they exist
        if (song.params.bass2) {
            setBass2(song.params.bass2);
            bass2Ref.current = song.params.bass2;
        }

        // Set drum kit type from imported song
        if (song.params.drumKit && deps.setDrumKit) {
            deps.setDrumKit(song.params.drumKit);
        }

        void loadCloudData(savedSong, 'song');

        // Activate song mode when the imported RBS song has a full arrangement.
        if (arrangement?.mode === 'song') {
            deps.setIsSongModeActive?.(true);
        }

        // Convert param-only TRAK events for sub-step automation scheduling.
        const paramEvents = arrangement?.trakParamEvents ?? arrangement?.trakEvents;
        if (paramEvents?.length && deps.trakEventsRef) {
            deps.trakEventsRef.current = paramEvents.map(ev => ({
                tick: ev.absoluteTicks,
                trackIndex: ev.trackIndex,
                ctrlId: ev.controllerId,
                value: ev.value,
                eventKind: ev.eventKind,
            }));
        }

        // Wire imported 303 params to Open303Manager instances.
        // partB → bass1 (SYNTH B), partA → lead303 (SYNTH A LEAD), bass2 → bass2 instance.
        const open303Engine = audioEngine?.open303Engine;
        if (open303Engine instanceof Open303Manager) {
            const synthB = song.params.synthB;
            if (synthB) {
                open303Engine.applyBass1Params({
                    filterCutoff: synthB.filterCutoff,
                    filterResonance: synthB.filterResonance,
                    filterMode: synthB.filterMode ?? 0,
                    decay: synthB.decay,
                    volume: synthB.volume,
                    pan: synthB.pan,
                }, convert303Waveform(synthB.waveform ?? ''));
            }

            const synthA = song.params.synthA;
            if (synthA) {
                open303Engine.applyLead303Params({
                    filterCutoff: synthA.filterCutoff,
                    filterResonance: synthA.filterResonance,
                    filterMode: synthA.filterMode ?? 0,
                    decay: synthA.decay,
                    volume: synthA.volume,
                    pan: synthA.pan,
                }, convert303Waveform(synthA.waveform ?? ''));
            }

            if (song.params.bass2) {
                open303Engine.applyBass2Params(song.params.bass2);
            }
        }

        applyPcfFilterToEffect(song.pcfFilter, audioEngine?.pcfEffect ?? null);

        // Keep the import modal open so ImportReportPanel stays visible until the user clicks Done.
    }, [loadCloudData, audioEngine, deps]);

    return {
        getSongData,
        getBankData,
        getPatternData,
        exportSongToFile,
        exportRbsToFile,
        importSongFromFile,
        handleSaveSong,
        loadSong,
        loadCloudData,
        handleAISongImport,
        handleRbsImport,
        isImportingAISong,
        aiImportProgress,
        aiImportStage,
        aiImportError,
        setIsImportingAISong,
        setAiImportProgress,
        setAiImportStage,
    };
}
