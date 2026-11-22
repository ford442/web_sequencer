/**
 * Save, load, import and export of the project, wired to the app (#1597 P2).
 *
 * The work is plain functions over the project doc and the stores:
 *
 *   useSongStorage/save.ts     the doc → `SavedSongData` (+ audio and extras)
 *   useSongStorage/load.ts     `SavedSongData` → the doc, as one load
 *   useSongStorage/migrate.ts  legacy songs and imports made current (pure)
 *   useSongStorage/export.ts   song JSON, .rbs and .mid files
 *
 * This hook only binds them to what lives in React: the engine, toasts, the
 * import modals and the AI import's progress overlay.
 */

import { useCallback, useState } from 'react';
import type { MutableRefObject } from 'react';
import { Open303Manager } from '../engines/Open303Manager';
import type { AudioEngine, Pattern, PartSequence, SavedSongData, DrumKitType, ResolvedTrakEvent } from '../types';
import { CloudStorage } from '../services/CloudStorage';
import type { CloudItemType } from '../services/CloudStorage';
import type { AISongData } from '../importers/ai-song';
import type { TrackKey } from '../constants/appDefaults';
import { applyPcfFilterToEffect, convert303Waveform } from '../importers/rbs/applyImportedEngineState';
import { instrumentStore } from '../stores/instrumentStore';
import { patternStore } from '../stores/patternStore';
import { samplerBanksStore } from '../stores/samplerBanksStore';
import type { RbsArrangementExtras } from './appState/useSongModeState';
import { buildSongData, buildSongSnapshot } from './useSongStorage/save';
import { loadBankData, loadPatternData, loadSongData, loadSongSnapshot } from './useSongStorage/load';
import { rbsImportToSavedSong, smfImportToSavedSong } from './useSongStorage/migrate';
import { buildRbsFile, buildSmfFile, downloadFile, songJsonFile, type FileExportResult } from './useSongStorage/export';

export type { FileExportResult };

export type AiImportStage = 'parsing' | 'validating' | 'converting' | 'uploading' | 'loading' | 'complete' | 'error' | null;

export interface SongStorageDeps {
    /** Audio engine (null before init): sample decoding and imported 303 knobs. */
    audioEngine: AudioEngine | null;
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;
    setIsAISongModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setIsRbsImportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setIsSmfImportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
    /** Drum kit switch (kit params + engine), for an imported .rbs. */
    setDrumKit?: (kit: DrumKitType) => void;
    /** Activates song mode after a full-song import. */
    setIsSongModeActive?: React.Dispatch<React.SetStateAction<boolean>>;
    /** Whether song arranger playback is active (RBS / SMF export mode). */
    isSongModeActive?: boolean;
    /** RBS arrangement extras persisted across import/export. */
    rbsArrangementExtrasRef?: MutableRefObject<RbsArrangementExtras | null>;
    /** Resolved TRAK events of an imported .rbs, for sub-step automation. */
    trakEventsRef?: MutableRefObject<ResolvedTrakEvent[] | null>;
}

export interface SongStorageReturn {
    getSongData: () => Promise<SavedSongData>;
    getBankData: () => { type: string; trackStorage: Record<TrackKey, (PartSequence | PartSequence[] | null)[]> };
    getPatternData: () => { type: string; pattern: Pattern };
    exportSongToFile: () => Promise<void>;
    exportRbsToFile: () => Promise<void>;
    exportSmfToFile: () => Promise<void>;
    /** The `.rbs` / `.mid` the export buttons download, built without downloading. */
    buildRbsExport: () => Promise<FileExportResult>;
    buildSmfExport: () => Promise<FileExportResult>;
    importSongFromFile: () => void;
    handleSaveSong: (slot: number) => Promise<void>;
    loadSong: (slot: number) => void;
    loadCloudData: (data: unknown, type: CloudItemType) => Promise<void>;
    handleAISongImport: (song: SavedSongData, aiData: AISongData) => Promise<void>;
    /** The AI import's load step alone: no cloud upload, no progress overlay. */
    loadImportedAISong: (song: SavedSongData) => Promise<void>;
    handleRbsImport: (song: import('../importers/rbs').HyphonSong) => void;
    handleSmfImport: (song: import('../importers/smf').HyphonSmfSong) => void;
    isImportingAISong: boolean;
    aiImportProgress: number;
    aiImportStage: AiImportStage;
    aiImportError: string | null;
    setIsImportingAISong: React.Dispatch<React.SetStateAction<boolean>>;
    setAiImportProgress: React.Dispatch<React.SetStateAction<number>>;
    setAiImportStage: React.Dispatch<React.SetStateAction<AiImportStage>>;
    isExportingRbs: boolean;
    isExportingSmf: boolean;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function aiImportErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) return 'Import failed: Unknown error';
    if (error.message.includes('JSON') || error.message.includes('parse')) return `Invalid JSON syntax: ${error.message}`;
    if (error.message.includes('validation') || error.message.includes('required')) return `Song validation failed: ${error.message}`;
    if (error.message.includes('network') || error.message.includes('fetch')) return 'Network error - song saved locally';
    return `Import failed: ${error.message}`;
}

/** An imported .rbs's 303 knobs, straight to the voices: partB → bass1, partA → lead, bass2. */
function apply303Knobs(engine: AudioEngine | null, params: import('../importers/rbs').HyphonSong['params']): void {
    const open303 = engine?.open303Engine;
    if (!(open303 instanceof Open303Manager)) return;
    const knobs = (p: NonNullable<typeof params.synthA>) => ({
        filterCutoff: p.filterCutoff,
        filterResonance: p.filterResonance,
        filterMode: p.filterMode ?? 0,
        decay: p.decay,
        volume: p.volume,
        pan: p.pan,
    });
    if (params.synthB) open303.applyBass1Params(knobs(params.synthB), convert303Waveform(params.synthB.waveform ?? ''));
    if (params.synthA) open303.applyLead303Params(knobs(params.synthA), convert303Waveform(params.synthA.waveform ?? ''));
    if (params.bass2) open303.applyBass2Params(params.bass2);
}

export function useSongStorage(deps: SongStorageDeps): SongStorageReturn {
    const { audioEngine, showToast, setIsAISongModalOpen, rbsArrangementExtrasRef, trakEventsRef, isSongModeActive } = deps;

    const [isImportingAISong, setIsImportingAISong] = useState(false);
    const [aiImportProgress, setAiImportProgress] = useState(0);
    const [aiImportStage, setAiImportStage] = useState<AiImportStage>(null);
    const [aiImportError, setAiImportError] = useState<string | null>(null);
    const [isExportingRbs, setIsExportingRbs] = useState(false);
    const [isExportingSmf, setIsExportingSmf] = useState(false);

    const getSongData = useCallback(() => buildSongData({
        sampleBuffers: samplerBanksStore.getSnapshot().sampleBuffers,
        rbsExtras: rbsArrangementExtrasRef?.current,
        trakEvents: trakEventsRef?.current,
    }), [rbsArrangementExtrasRef, trakEventsRef]);

    const getBankData = useCallback(() => ({ type: 'bank', trackStorage: samplerBanksStore.getSnapshot().trackStorage }), []);
    const getPatternData = useCallback(() => ({ type: 'pattern', pattern: patternStore.getSnapshot() }), []);

    const loadCloudData = useCallback(async (data: unknown, type: CloudItemType) => {
        if (type === 'song') {
            await loadSongData(data as SavedSongData, {
                audioEngine,
                setSampleBuffers: samplerBanksStore.setSampleBuffers,
                rbsExtrasRef: rbsArrangementExtrasRef,
                trakEventsRef,
            });
            showToast('Song loaded!', 'success');
        } else if (type === 'bank') {
            const { trackStorage } = data as { trackStorage?: Parameters<typeof loadBankData>[0] };
            if (trackStorage) {
                loadBankData(trackStorage);
                showToast('Pattern Bank loaded!', 'success');
            }
        } else if (type === 'pattern') {
            const { pattern } = data as { pattern?: Pattern };
            if (pattern) {
                loadPatternData(pattern);
                showToast('Pattern loaded!', 'success');
            }
        }
    }, [audioEngine, showToast, rbsArrangementExtrasRef, trakEventsRef]);

    const handleSaveSong = useCallback((slot: number) => {
        const snapshot = buildSongSnapshot();
        samplerBanksStore.setSongStorage((prev) => { const copy = [...prev]; copy[slot] = snapshot; return copy; });
        samplerBanksStore.setActiveSongSlot(slot);
        return Promise.resolve();
    }, []);

    const loadSong = useCallback((slot: number) => {
        const snapshot = samplerBanksStore.getSnapshot().songStorage[slot];
        if (!snapshot) return;
        loadSongSnapshot(snapshot);
        samplerBanksStore.setActiveSongSlot(slot);
    }, []);

    const exportSongToFile = useCallback(async () => {
        const { blob, filename } = songJsonFile(await getSongData());
        downloadFile(blob, filename);
    }, [getSongData]);

    const buildRbsExport = useCallback(async () => buildRbsFile(await getSongData(), {
        isSongModeActive,
        trakEvents: trakEventsRef?.current,
    }), [getSongData, isSongModeActive, trakEventsRef]);

    const buildSmfExport = useCallback(async () => buildSmfFile(await getSongData(), { isSongModeActive }), [getSongData, isSongModeActive]);

    const exportWith = useCallback(async (
        build: () => Promise<FileExportResult>,
        setBusy: (busy: boolean) => void,
        what: { ext: string; ok: string; label: string },
    ) => {
        setBusy(true);
        try {
            const result = await build();
            if (!result.success) {
                showToast(result.error, 'error');
                return;
            }
            if (result.warnings.length > 0) console.warn(`[${what.label} Export warnings]`, result.warnings);
            downloadFile(result.blob, result.filename);
            showToast(
                result.warnings.length > 0 ? `Exported ${what.ext} (${result.warnings.length} compatibility warning(s))` : what.ok,
                result.warnings.length > 0 ? 'info' : 'success',
            );
        } catch (err) {
            console.error(`${what.label} export failed:`, err);
            showToast(`Failed to export ${what.ext} file`, 'error');
        } finally {
            setBusy(false);
        }
    }, [showToast]);

    const exportRbsToFile = useCallback(
        () => exportWith(buildRbsExport, setIsExportingRbs, { ext: '.rbs', ok: 'Exported ReBirth .rbs file!', label: 'RBS' }),
        [exportWith, buildRbsExport],
    );
    const exportSmfToFile = useCallback(
        () => exportWith(buildSmfExport, setIsExportingSmf, { ext: '.mid', ok: 'Exported Standard MIDI file!', label: 'SMF' }),
        [exportWith, buildSmfExport],
    );

    const importSongFromFile = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                await loadCloudData(JSON.parse(await file.text()) as unknown, 'song');
            } catch (err) {
                console.error('Failed to load song:', err);
                showToast('Failed to load song file.', 'error');
            }
        };
        input.click();
    }, [loadCloudData, showToast]);

    /**
     * Put a converted AI song into the sequencer: the load step of the import
     * modal, without its cloud upload and progress overlay. The agent render
     * hook (`window.__HYPHON_AGENT__.importAISong`) loads songs through this.
     */
    const loadImportedAISong = useCallback(async (song: SavedSongData) => {
        await loadCloudData(song, 'song');
        // A v1.1 song with an arrangement plays it, like an imported .rbs / SMF song.
        if (song.songStructure.length > 1) deps.setIsSongModeActive?.(true);
    }, [loadCloudData, deps]);

    const handleAISongImport = useCallback(async (song: SavedSongData, aiData: AISongData) => {
        setIsImportingAISong(true);
        setAiImportProgress(0);
        setAiImportError(null);
        try {
            // Parsing and validation happen in the modal; the overlay shows them.
            setAiImportStage('parsing');
            setAiImportProgress(10);
            await pause(100);
            setAiImportStage('validating');
            setAiImportProgress(25);
            await pause(150);
            setAiImportStage('converting');
            setAiImportProgress(40);
            await pause(150);
            // Cloud upload is optional and may fail; the local import goes on.
            setAiImportStage('uploading');
            setAiImportProgress(60);
            try {
                await CloudStorage.uploadItem({
                    name: aiData.meta.title,
                    data: song,
                    type: 'song',
                    author: aiData.meta.author,
                    description: `Generated by ${aiData.meta.generator}`,
                });
            } catch (cloudError) {
                console.warn('Cloud upload failed:', cloudError);
                showToast('Song imported locally (cloud upload failed)', 'info');
            }
            setAiImportProgress(80);
            setAiImportStage('loading');
            setAiImportProgress(90);
            await pause(200);
            await loadImportedAISong(song);
            setAiImportProgress(100);
            setAiImportStage('complete');
            showToast(`✨ Imported "${aiData.meta.title}" by ${aiData.meta.author}`, 'success');
            setTimeout(() => {
                setIsAISongModalOpen(false);
                setIsImportingAISong(false);
                setAiImportStage(null);
                setAiImportProgress(0);
            }, 1500);
        } catch (error) {
            console.error('AI Song Import Error:', error);
            setAiImportStage('error');
            const errorMessage = aiImportErrorMessage(error);
            setAiImportError(errorMessage);
            showToast(errorMessage, 'error');
            // Keep the overlay up a moment so the error can be read.
            setTimeout(() => {
                setIsImportingAISong(false);
                setAiImportStage(null);
                setAiImportError(null);
            }, 3000);
            // Re-thrown so the modal can offer a retry.
            throw error;
        }
    }, [loadImportedAISong, showToast, setIsAISongModalOpen]);

    const handleRbsImport = useCallback((song: import('../importers/rbs').HyphonSong) => {
        // The kit first: it resets the drum patches, which the song then sets.
        if (song.params.drumKit && deps.setDrumKit) deps.setDrumKit(song.params.drumKit);
        void loadCloudData(rbsImportToSavedSong(song), 'song');
        const arrangement = song.songArrangement;
        if (arrangement?.mode === 'song') deps.setIsSongModeActive?.(true);
        // Param-only TRAK events, for sub-step automation scheduling.
        const paramEvents = arrangement?.trakParamEvents ?? arrangement?.trakEvents;
        if (paramEvents?.length && trakEventsRef) {
            trakEventsRef.current = paramEvents.map((ev) => ({
                tick: ev.absoluteTicks,
                trackIndex: ev.trackIndex,
                ctrlId: ev.controllerId,
                value: ev.value,
                eventKind: ev.eventKind,
            }));
        }
        apply303Knobs(audioEngine, song.params);
        applyPcfFilterToEffect(song.pcfFilter, audioEngine?.pcfEffect ?? null);
        // The import modal stays open so ImportReportPanel is visible until "Done".
    }, [loadCloudData, audioEngine, deps, trakEventsRef]);

    const handleSmfImport = useCallback((song: import('../importers/smf').HyphonSmfSong) => {
        void loadCloudData(smfImportToSavedSong(song, { ...instrumentStore.getParams() }), 'song');
        if (song.songArrangement && song.songArrangement.songStructure.length > 1) deps.setIsSongModeActive?.(true);
        // The import modal stays open so the report is visible until "Done".
    }, [loadCloudData, deps]);

    return {
        getSongData,
        getBankData,
        getPatternData,
        exportSongToFile,
        exportRbsToFile,
        exportSmfToFile,
        buildRbsExport,
        buildSmfExport,
        importSongFromFile,
        handleSaveSong,
        loadSong,
        loadCloudData,
        handleAISongImport,
        loadImportedAISong,
        handleRbsImport,
        handleSmfImport,
        isImportingAISong,
        aiImportProgress,
        aiImportStage,
        aiImportError,
        setIsImportingAISong,
        setAiImportProgress,
        setAiImportStage,
        isExportingRbs,
        isExportingSmf,
    };
}
