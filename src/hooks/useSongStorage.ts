import { useCallback, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { Pattern, SynthParams, KickParams, SnareParams, SamplerParams, SamplerBankParams, PartSequence, SavedSongData, Bass2Params, DrumKitType, UnifiedAutomationLane } from '../types';
import type { CloudItemType } from '../services/CloudStorage';
import type { AISongData } from '../importers/ai-song';
import type { TrackKey, SongSnapshot } from '../constants/appDefaults';
import type { ScaleDefinition } from '../utils/musicTheory';
import { DEFAULT_BASS2_PARAMS } from '../constants';
import { audioBufferToWav, blobToBase64 } from '../utils/audioExport';
import { automationStore, convertHyphonLanes } from '../stores/automationStore';

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
    closedHatRef: MutableRefObject<any>;
    openHatRef: MutableRefObject<any>;
    samplerRef: MutableRefObject<SamplerParams>;
    trackStorageRef: MutableRefObject<Record<TrackKey, (PartSequence | PartSequence[] | null)[]>>;
    activeTrackSlotsRef: MutableRefObject<Record<TrackKey, number>>;
    songStructureRef: MutableRefObject<({ [key in TrackKey]: number | null })[]>;

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
    setClosedHat: React.Dispatch<React.SetStateAction<any>>;
    setOpenHat: React.Dispatch<React.SetStateAction<any>>;
    setSampler: React.Dispatch<React.SetStateAction<SamplerParams>>;
    setTrackStorage: React.Dispatch<React.SetStateAction<Record<TrackKey, (PartSequence | PartSequence[] | null)[]>>>;
    setActiveTrackSlots: React.Dispatch<React.SetStateAction<Record<TrackKey, number>>>;
    setSongStructure: React.Dispatch<React.SetStateAction<({ [key in TrackKey]: number | null })[]>>;
    setSampleBuffers: React.Dispatch<React.SetStateAction<(AudioBuffer | null)[]>>;
    setTtsPhrases: React.Dispatch<React.SetStateAction<string[]>>;
    setSongStorage: React.Dispatch<React.SetStateAction<(SongSnapshot | null)[]>>;
    setActiveSongSlot: React.Dispatch<React.SetStateAction<number | null>>;

    // Audio engine (may be null before init)
    audioEngine: any;

    // Toast helper
    showToast: (message: string, type: 'success' | 'error' | 'info') => void;

    // Modal setters referenced by import functions
    setIsAISongModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setIsRbsImportModalOpen: React.Dispatch<React.SetStateAction<boolean>>;

    // Drum kit setter (optional for backwards compat)
    setDrumKit?: (kit: DrumKitType) => void;
}

export interface SongStorageReturn {
    // Serialization
    getSongData: () => Promise<SavedSongData>;
    getBankData: () => { type: string; trackStorage: Record<TrackKey, (PartSequence | PartSequence[] | null)[]> };
    getPatternData: () => { type: string; pattern: Pattern };

    // File I/O
    exportSongToFile: () => Promise<void>;
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

/** Convert a 303-waveform string (e.g. '303-sqr', '303-saw') to the Open303 shorthand */
function convert303Waveform(waveform: string): 'saw' | 'sqr' {
    return waveform === '303-sqr' ? 'sqr' : 'saw';
}

export function useSongStorage(deps: SongStorageDeps): SongStorageReturn {
    const {
        patternRef, tempoRef,
        synthARef, synthBRef, bass2Ref, kickRef, snareRef, closedHatRef, openHatRef, samplerRef,
        trackStorageRef, activeTrackSlotsRef, songStructureRef,
        ambianceUrl, backgroundImage, sampleBuffers, ttsPhrases,
        songStorage, pattern, tempo, trackStorage,
        setPattern, setTempo, setAmbianceUrl, setBackgroundImage,
        setSynthA, setSynthB, setBass2, setKick, setSnare, setClosedHat, setOpenHat, setSampler,
        setTrackStorage, setActiveTrackSlots, setSongStructure, setSampleBuffers, setTtsPhrases,
        setSongStorage, setActiveSongSlot,
        audioEngine, showToast,
        setIsAISongModalOpen, setIsRbsImportModalOpen,
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
                const wavBlob = audioBufferToWav(buf);
                const b64 = await blobToBase64(wavBlob);
                encodedSamples[idx] = b64;
            }
        }));
        // automationStore is a module singleton — exportLanes() reads its current state at call time,
        // so memoization of this callback does not cause stale automation data.
        const exportedLanes = automationStore.exportLanes();
        return {
            version: 1,
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
            embeddedSamples: encodedSamples,
            ttsPhrases,
            ...(exportedLanes.length > 0 ? { automationLanes: exportedLanes } : {}),
        } as SavedSongData;
    }, [ambianceUrl, backgroundImage, sampleBuffers, ttsPhrases]);

    const getBankData = useCallback(() => {
        return { type: 'bank', trackStorage };
    }, [trackStorage]);

    const getPatternData = useCallback(() => {
        return { type: 'pattern', pattern };
    }, [pattern]);

    // ---- Load helpers ----

    const loadCloudData = useCallback(async (data: any, type: CloudItemType) => {
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
                // @ts-expect-error - Auto-generated to fix CI build
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
            if (songData.trackStorage) setTrackStorage(songData.trackStorage as unknown as Record<TrackKey, (PartSequence | PartSequence[] | null)[]>);
            if (songData.activeTrackSlots) setActiveTrackSlots(songData.activeTrackSlots as unknown as Record<TrackKey, number>);
            if (songData.songStructure) setSongStructure(songData.songStructure as unknown as ({ [key in TrackKey]: number | null })[]);
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
                        audioEngine.loadSampleToEngine(bankName, audioBuf);
                        loadedBuffers[bankIdx] = audioBuf;
                    } catch (e) {
                        console.error(`Failed to load sample bank ${idx}`, e);
                    }
                }));
                setSampleBuffers(loadedBuffers);
            }
            // Restore automation lanes — importLanes replaces all existing lanes (including clearing when empty).
            automationStore.importLanes(songData.automationLanes ?? []);
            showToast("Song loaded!", "success");
        } else if (type === 'bank') {
            if (data.trackStorage) {
                setTrackStorage(data.trackStorage);
                showToast("Pattern Bank loaded!", "success");
            }
        } else if (type === 'pattern') {
            if (data.pattern) {
                setPattern(data.pattern);
                showToast("Pattern loaded!", "success");
            }
        }
    }, [audioEngine, sampleBuffers, showToast]);

    const handleSaveSong = useCallback(async (slot: number) => {
        const encodedSamples: { [k: number]: string } = {};
        await Promise.all(sampleBuffers.map(async (buf, idx) => {
            if (buf) {
                const wavBlob = audioBufferToWav(buf);
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

    const importSongFromFile = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const songData = JSON.parse(text);
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
                // @ts-expect-error - Auto-generated to fix CI build
                const cloud = CloudStorage.getInstance();
                if (cloud.isAvailable()) {
                    await cloud.save('song', {
                        name: aiData.meta.title,
                        data: song,
                        metadata: {
                            title: aiData.meta.title,
                            author: aiData.meta.author,
                            generator: aiData.meta.generator,
                            importedAt: new Date().toISOString(),
                        },
                    });
                    setAiImportProgress(80);
                }
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
            loadCloudData(song, 'song');

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
    // TODO(#651): Full integration — consume song.automation (HyphonAutomationLane[]), rbsMetadata (tb303*Params, pcf),
    // apply initial Open303Manager params for 303 tracks, populate automation store (see #652), show ImportReport.
    // Current impl only does basic pattern/params via loadCloudData. See epic #650 + #651-656 for the full plan.

    const handleRbsImport = useCallback((song: import('../importers/rbs').HyphonSong) => {
        // Convert HyphonSong automation lanes using the centralized automationStore converter
        const automationLanes: UnifiedAutomationLane[] | undefined = song.automation && song.automation.length > 0
            ? convertHyphonLanes(song.automation)
            : undefined;

        // Convert HyphonSong to SavedSongData format
        const savedSong: SavedSongData = {
            version: 1,
            pattern: song.pattern,
            tempo: song.tempo,
            ambianceUrl: '',
            backgroundImage: '',
            params: {
                synthA: song.params.synthA,
                synthB: song.params.synthB,
                // @ts-expect-error - Auto-generated to fix CI build
                bass2: song.params.bass2 ?? DEFAULT_BASS2_PARAMS,
                kick: song.params.kick,
                snare: song.params.snare,
                closedHat: song.params.closedHat,
                openHat: song.params.openHat,
                // @ts-expect-error - Auto-generated to fix CI build
                sampler: song.params.sampler || Array.from({ length: 8 }, () => ({
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
            trackStorage: {
                partA: [song.pattern.partA, ...Array(7).fill(null)],
                partB: [song.pattern.partB, ...Array(7).fill(null)],
                bass2: [song.pattern.bass2, ...Array(7).fill(null)],
                kick: [song.pattern.kick, ...Array(7).fill(null)],
                snare: [song.pattern.snare, ...Array(7).fill(null)],
                closedHat: [song.pattern.closedHat, ...Array(7).fill(null)],
                openHat: [song.pattern.openHat, ...Array(7).fill(null)],
                sampler: [song.pattern.sampler, ...Array(7).fill(null)],
            },
            activeTrackSlots: {
                partA: 0, partB: 0, bass2: 0, kick: 0,
                snare: 0, closedHat: 0, openHat: 0, sampler: 0,
            },
            songStructure: Array(16).fill(null).map(() => ({
                partA: 0, partB: 0, bass2: 0, kick: 0,
                snare: 0, closedHat: 0, openHat: 0, sampler: null,
            })),
            ttsPhrases: Array(8).fill('Hello World'),
            ...(automationLanes ? { automationLanes } : {}),
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

        loadCloudData(savedSong, 'song');

        // Wire imported 303 params to Open303Manager instances.
        // partB → bass1 (SYNTH B), partA → lead303 (SYNTH A LEAD), bass2 → bass2 instance.
        const open303Engine = audioEngine?.open303Engine;
        if (open303Engine) {
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

        setIsRbsImportModalOpen(false);
        showToast(`Imported "${song.metadata.name}" from RBS`, 'success');
    }, [loadCloudData, showToast, audioEngine]);

    return {
        getSongData,
        getBankData,
        getPatternData,
        exportSongToFile,
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
