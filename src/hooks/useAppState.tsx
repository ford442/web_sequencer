import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useAudioEngine } from './useAudioEngine'
import { usePyodideEngine } from './usePyodideEngine'
import { useScheduler } from './useScheduler'
import { useStepHandler } from './useStepHandler'
import { useUndoRedo } from './useUndoRedo'
import { useGamepad } from './useGamepad'
import { useStableKnobConfig } from './useStableKnobConfig'
import { useSongStorage } from './useSongStorage'
import { useTTSPreloader } from './useTTSPreloader'
import { SupertonicService } from '../services/Supertonic'
import { automationStore } from '../stores/automationStore';
import { AutomationScheduler } from '../audio/automation/AutomationScheduler';
import type { PcfEffect } from '../engines/PcfEffect';
import type { MainSequencerHandle } from '../components/MainSequencer'
import type { AlignmentResult } from '../engines/rubberband/PhonemeAligner'

import {
    NUM_STEPS,
    DEFAULT_TEMPO,
} from '../constants'
import type { Pattern, PartSequence, ReverbType, ResolvedTrakEvent } from '../types'
import type { ScaleDefinition } from '../utils/musicTheory'
import {
    UPDATED_INITIAL_PATTERN,
    type TrackKey, type SongSnapshot,
    getInitialTrackStorage,
} from '../constants/appDefaults'
import {
    getBass2Controls, getSynthControls, getKickControls, getSnareControls,
    getClosedHatControls, getOpenHatControls, getSamplerControls,
} from '../utils/knobConfigs'

import { useSelectionHandlers } from './appState/useSelectionHandlers'
import { useClipboardHandlers } from './appState/useClipboardHandlers'
import { usePatternHandlers } from './appState/usePatternHandlers'
import { useAutomationHandlers } from './appState/useAutomationHandlers'
import { useKeyboardHandlers } from './appState/useKeyboardHandlers'
import { useLyricHandlers } from './appState/useLyricHandlers'
import { useSynthParamHandlers } from './appState/useSynthParamHandlers'
import { useMasterHandlers } from './appState/useMasterHandlers'
import { useTransportHandlers } from './appState/useTransportHandlers'
import { useAutoMix } from './appState/useAutoMix'
import { useSongHandlers, useSampleHandlers } from './appState/useSongHandlers'
import { useHardwarePanels } from './appState/useHardwarePanels'
import { useInstrumentState } from './appState/useInstrumentState'
import { useSamplerVoiceState } from './appState/useSamplerVoiceState'

export function useAppState() {

    const { pyodide, isPyodideReady, pyodideStatus } = usePyodideEngine()
    const [isVoiceEditorOpen, setIsVoiceEditorOpen] = useState(false);
    const [isCloudLibraryOpen, setIsCloudLibraryOpen] = useState(false);
    const [isAISongModalOpen, setIsAISongModalOpen] = useState(false);
    const [isRbsImportModalOpen, setIsRbsImportModalOpen] = useState(false);
    const [isLyricTrackVisible, setIsLyricTrackVisible] = useState(false);
    const [isShortcutsHelpOpen, setIsShortcutsHelpOpen] = useState(false);
    const [showGamepadDebug, setShowGamepadDebug] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [hasStarted, setHasStarted] = useState(false);
    const [forceScriptProcessorFallback, setForceScriptProcessorFallback] = useState(() => {
        return localStorage.getItem('forceScriptProcessorFallback') === 'true';
    });

    useGamepad();

    const [is3DMode, setIs3DMode] = useState(false);

    const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' | 'info' } | null>(null);
    const showToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'success') => {
        setToast({ message, type });
    }, []);

    const [tempo, setTempo] = useState<number>(DEFAULT_TEMPO)
    const [swing, setSwing] = useState<number>(0)
    const lastFreqRef = useRef<Record<string, number>>({ partA: 0, partB: 0 });
    const { audioEngine, isReady, initializeAudio, onParamChange, drumKitEngineRef } = useAudioEngine(pyodide, tempo)
    const isEngineReady = isReady && (isPyodideReady || !!pyodideStatus)

    useTTSPreloader()

    const [viewMode, setViewMode] = useState<'notes' | 'automation'>('notes');
    const [automationParam, setAutomationParam] = useState('formantShift');

    const [melodicMode, setMelodicMode] = useState(false);

    const [activeAlignment, setActiveAlignment] = useState<AlignmentResult | null>(null);

    const lastSamplerMidiRef = useRef<Record<number, number>>({});
    const lastSamplerFormantRef = useRef<Record<number, number>>({});

    const handleStart = async () => {
        console.log("Initialization sequence started...");
        try {
            setHasStarted(true);
            await initializeAudio();
            setIsInitialized(true);
            console.log("Audio Engine Initialized");
            SupertonicService.getInstance().init().catch((e: unknown) => {
                console.warn('Supertonic TTS failed to init:', e);
            });
        } catch (e) {
            console.error("Failed to start system:", e);
        }
    };

    const [pattern, setPattern] = useState<Pattern>(UPDATED_INITIAL_PATTERN)
    const undoRedo = useUndoRedo<Pattern>(50)
    const [isInitialized, setIsInitialized] = useState(false)
    const [isPlaying, setIsPlaying] = useState(false)
    const [isRecording, setIsRecording] = useState(false)
    const [isAutomationRecording, setIsAutomationRecording] = useState(false)
    const [selectedTrack, setSelectedTrack] = useState<TrackKey>('partA')
    const [ambianceUrl, setAmbianceUrl] = useState<string>('')
    const [backgroundImage, setBackgroundImage] = useState<string>('')
    const [masterVolume, setMasterVolume] = useState(0.8)
    const [masterSaturation, setMasterSaturation] = useState(0)
    const [globalPan, setGlobalPan] = useState(0)
    const [reverbType, setReverbType] = useState<ReverbType>('plate')

    const [isSongModeOpen, setIsSongModeOpen] = useState(false);
    const [isSongModeActive, setIsSongModeActive] = useState(false);
    const [songStructure, setSongStructure] = useState<({ [key in TrackKey]: number | null })[]>(
        Array(16).fill(null).map(() => ({
            partA: null, partB: null, bass2: null, kick: null, snare: null, closedHat: null, openHat: null, sampler: null
        }))
    );
    const [currentSongMeasure, setCurrentSongMeasure] = useState(0);
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, track: TrackKey, step: number } | null>(null);
    const [isNoteDragging, setIsNoteDragging] = useState(false);
    const noteDragRef = useRef<{ track: TrackKey; step: number; startY: number; startMidi: number; hasMoved: boolean; lastMidi: number; pendingSequence?: PartSequence | PartSequence[]; } | null>(null);

    const [currentScale, setCurrentScale] = useState<ScaleDefinition | null>(null);

    const sliceHighlightRef = useRef<((slice: number) => void) | null>(null);

    const [selection, setSelection] = useState<{ trackKey: TrackKey; startStep: number; endStep: number; } | null>(null);
    const [isSelecting, setIsSelecting] = useState(false);
    const [clipboard, setClipboard] = useState<(import('../types').Note | null)[] | null>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [drawMode, setDrawMode] = useState<'add' | 'remove' | null>(null);

    const [zoomLevel, setZoomLevel] = useState(1);

    const [trackStorage, setTrackStorage] = useState<Record<TrackKey, (PartSequence | PartSequence[] | null)[]>>(
        getInitialTrackStorage(UPDATED_INITIAL_PATTERN)
    );
    const [activeTrackSlots, setActiveTrackSlots] = useState<Record<TrackKey, number>>({
        partA: 0, partB: 0, bass2: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: 0
    });
    const activeTrackSlotsRef = useRef(activeTrackSlots);
    useEffect(() => { activeTrackSlotsRef.current = activeTrackSlots; }, [activeTrackSlots]);

    const [songStorage, setSongStorage] = useState<(SongSnapshot | null)[]>([null, null, null, null]);
    const [activeSongSlot, setActiveSongSlot] = useState<number | null>(null);

    const [activeSamplerBank, setActiveSamplerBank] = useState(0);
    const activeSamplerBankRef = useRef(activeSamplerBank);

    useEffect(() => {
        activeSamplerBankRef.current = activeSamplerBank;
        if (audioEngine && audioEngine.getAlignment) {
            setActiveAlignment(audioEngine.getAlignment(activeSamplerBank));
        }
    }, [activeSamplerBank, audioEngine]);

    const [sampleBuffers, setSampleBuffers] = useState<(AudioBuffer | null)[]>(new Array(8).fill(null));
    const loadedBanks = useMemo(() => sampleBuffers.map(b => !!b), [sampleBuffers]);
    
    const multisampleReady = useMemo(() => 
        Array.from({ length: 8 }, (_, i) => audioEngine?.isMultisampleReady?.(i) ?? false),
        [audioEngine, sampleBuffers]
    );
    const multisampleProcessing = useMemo(() => 
        Array.from({ length: 8 }, (_, i) => {
            const bank = audioEngine?.getMultisampleBank?.(i);
            return bank?.isProcessing ?? false;
        }),
        [audioEngine, sampleBuffers]
    );
    const [ttsPhrases, setTtsPhrases] = useState<string[]>(Array(8).fill("Hello World"));

    const {
        synthA, setSynthA, synthARef, updateSynthA,
        synthB, setSynthB, synthBRef, updateSynthB,
        bass2, setBass2, bass2Ref, updateBass2,
        kick, setKick, kickRef, updateKick,
        snare, setSnare, snareRef, updateSnare,
        closedHat, setClosedHat, closedHatRef, updateClosedHat,
        openHat, setOpenHat, openHatRef, updateOpenHat,
        drumKit, drumKitRef, updateDrumKit,
        sampler, setSampler, samplerRef, updateSampler,
    } = useInstrumentState(drumKitEngineRef);

    const tempoRef = useRef(tempo);
    useEffect(() => { tempoRef.current = tempo; }, [tempo]);

    const patternRef = useRef(pattern);
    useEffect(() => { patternRef.current = pattern; }, [pattern]);
    const songStructureRef = useRef(songStructure);
    useEffect(() => { songStructureRef.current = songStructure; }, [songStructure]);
    const isSongModeActiveRef = useRef(isSongModeActive);
    useEffect(() => { isSongModeActiveRef.current = isSongModeActive; }, [isSongModeActive]);
    const trackStorageRef = useRef(trackStorage);
    useEffect(() => { trackStorageRef.current = trackStorage; }, [trackStorage]);
    const songMeasureRef = useRef(0);
    const isFirstStepRef = useRef(true);

    const sequencerRef = useRef<MainSequencerHandle>(null);
    const currentStepRef = useRef(-1);

    const {
        samplerVoiceParamsRef,
        samplerVoiceParams,
        setSamplerVoiceParams,
        harmonizerConfig,
        setHarmonizerConfig,
        isHarmonizeActive,
        setIsHarmonizeActive,
        handleHarmonizerConfigChange,
        handleSamplerVoiceChange,
    } = useSamplerVoiceState({
        audioEngine, sampler, activeSamplerBank, activeSamplerBankRef,
        samplerRef, setSampler, currentStepRef,
    });

    const currentScaleRef = useRef(currentScale);
    useEffect(() => { currentScaleRef.current = currentScale; }, [currentScale]);

    const automationSchedulerRef = useRef<AutomationScheduler | null>(null);
    const trakEventsRef = useRef<ResolvedTrakEvent[] | null>(null);
    useEffect(() => {
        const ctx = audioEngine?.context;
        const mgr = (audioEngine as any)?.open303Engine ?? null;
        const pcf: PcfEffect | null = (audioEngine as any)?.pcfEffect ?? null;
        if (ctx) {
            if (!automationSchedulerRef.current) {
                automationSchedulerRef.current = new AutomationScheduler(ctx, mgr ?? null, { ppq: 192 });
            } else {
                automationSchedulerRef.current.setOpen303Manager(mgr ?? null);
            }
            automationSchedulerRef.current.setPcfEffect(pcf);
        }
    }, [audioEngine]);

    useEffect(() => {
        const mgr = (audioEngine as any)?.open303Engine;
        if (!mgr || typeof mgr.syncEngine303Settings !== 'function') return;
        mgr.syncEngine303Settings({
            lead: synthA.engine303 ?? 'open303',
            bass1: synthB.engine303 ?? 'open303',
            bass2: bass2.engine303 ?? 'open303',
        });
    }, [audioEngine, synthA.engine303, synthB.engine303, bass2.engine303]);

    const activeKeyboardNotesRef = useRef<Map<string, number>>(new Map());

    const {
        updateStorageForTrack,
        handlePatternChange,
        handleStepToggle,
        handlePitchChange,
        handlePhonemeUpdate,
        handleNoteSelect,
        handleNoteLengthChange,
        handleNotePropertyChange,
        handleClearPattern,
        handleTrackSlotClick,
        handleSelectRow,
        handleEditLength,
    } = usePatternHandlers({
        patternRef, setPattern, undoRedo, activeSamplerBankRef,
        contextMenu, setContextMenu, setSelection,
        trackStorageRef, activeTrackSlotsRef, setTrackStorage, setActiveTrackSlots,
        setSelectedTrack,
    });

    const { handleSelectionStart, handleSelectionEnter, handleSelectionEnd } = useSelectionHandlers(
        selection, isSelecting, setSelection, setIsSelecting,
    );

    const { handleCopy, handlePaste } = useClipboardHandlers({
        selection, selectedTrack, clipboard, setClipboard, setPattern, setSelection,
        patternRef, activeSamplerBankRef, undoRedo, updateStorageForTrack, showToast,
        handleSelectionEnd, audioEngine,
    });

    const { onStep } = useStepHandler({
        audioEngine,
        tempo,
        onParamChange,
        currentStepRef,
        sequencerRef,
        patternRef,
        lastFreqRef,
        lastSamplerMidiRef,
        lastSamplerFormantRef,
        synthARef,
        synthBRef,
        bass2Ref,
        kickRef,
        snareRef,
        closedHatRef,
        openHatRef,
        samplerRef,
        samplerVoiceParamsRef,
        activeSamplerBankRef,
        sliceHighlightRef,
        isSongModeActiveRef,
        songStructureRef,
        currentScaleRef,
        songMeasureRef,
        isFirstStepRef,
        trackStorageRef,
        setCurrentSongMeasure,
        automationSchedulerRef,
        trakEventsRef,
    })

    const { isPlaying: schedPlaying, setIsPlaying: setSchedPlaying } = useScheduler(tempo, NUM_STEPS, onStep, isEngineReady, audioEngine?.context ?? null, swing)
    useEffect(() => setIsPlaying(schedPlaying), [schedPlaying])

    useEffect(() => {
        if (!schedPlaying) {
            songMeasureRef.current = 0;
            setCurrentSongMeasure(0);
            isFirstStepRef.current = true;
            if (sequencerRef.current) sequencerRef.current.setHighlight(-1);
            currentStepRef.current = -1;
            automationStore.clearLiveValues();
            automationSchedulerRef.current?.cancelAll();
        }
    }, [schedPlaying]);

    const {
        adjustTempo,
        handleTempoHoldStart,
        handleTempoHoldEnd,
        handleTempoKeyDown,
        handlePanic,
        handlePlayToggle,
        tempoHoldIntervalRef,
        tempoHoldTimeoutRef,
    } = useTransportHandlers({
        isInitialized, isReady, initializeAudio, setIsInitialized,
        audioEngine, setSchedPlaying, setTempo, undoRedo, setPattern,
        activeKeyboardNotesRef,
    });

    const { handleAutomationChange, handleKnobRecordToggle } = useAutomationHandlers({
        automationParam, patternRef, setPattern, activeSamplerBankRef,
        updateStorageForTrack, currentStepRef, schedPlaying,
        isAutomationRecording, isSongModeActive, activeTrackSlotsRef, isSongModeActiveRef,
    });

    const {
        handleMasterVolume,
        handleMasterVolumeKeyDown,
        handleMasterVolumeReset,
        handleMasterSaturation,
        handleMasterSaturationKeyDown,
        handleMasterSaturationReset,
        handleGlobalPan,
        handleGlobalPanKeyDown,
        handleGlobalPanReset,
        handleReverbType,
    } = useMasterHandlers({
        setMasterVolume, setMasterSaturation, setGlobalPan, setReverbType,
        audioEngine, currentStepRef,
    });

    const {
        handleSynthChange,
        handleBass2Change,
        handleKickChange,
        handleSnareChange,
        handleClosedHatChange,
        handleOpenHatChange,
        handleSamplerChange,
        handleSamplerParamChange,
        onSynthAParamChange,
        onSynthBParamChange,
        onBass2ParamChange,
    } = useSynthParamHandlers({
        updateSynthA, updateSynthB, updateBass2, updateKick, updateSnare,
        updateClosedHat, updateOpenHat, setSampler, activeSamplerBank,
        currentStepRef, samplerRef,
    });

    const { handleLoadSample } = useSampleHandlers({
        audioEngine, activeSamplerBank, ttsPhrases,
        setSampleBuffers, setSampler, setActiveAlignment,
    });

    const {
        handleTtsPhraseChange,
        handleGenerateTTS,
        handleTextToDrums,
        handleLyricApply,
    } = useLyricHandlers({
        audioEngine, patternRef, tempoRef, activeSamplerBankRef, samplerRef,
        setPattern, setSampler, setTtsPhrases, setIsGenerating, setIsLyricTrackVisible,
        ttsPhrases, activeSamplerBank, handleLoadSample, updateStorageForTrack, showToast,
        setActiveAlignment,
    });

    const {
        handleDrumPadPlay,
        handleKeyboardPlay,
        handleKeyboardStop,
        handleRightMouseDown,
        handleGlobalMouseMove,
        handleGlobalMouseUp,
        handleDrawEnter,
    } = useKeyboardHandlers({
        audioEngine, selectedTrack, isRecording, isPlaying, isNoteDragging, isDrawing,
        activeSamplerBank, setPattern, setIsNoteDragging, setIsDrawing, setDrawMode, setContextMenu,
        patternRef, activeSamplerBankRef, currentStepRef,
        synthARef, synthBRef, bass2Ref, kickRef, snareRef, closedHatRef, openHatRef,
        samplerRef, samplerVoiceParamsRef, activeKeyboardNotesRef, noteDragRef,
        updateStorageForTrack,
    });

    const { handleAutoMix } = useAutoMix({
        patternRef, updateSynthA, updateSynthB, updateBass2, updateKick, updateSnare,
        updateClosedHat, updateOpenHat, setSampler, setMasterVolume, audioEngine,
        synthA, synthB,
    });

    const {
        handleSongModeToggle,
        handleSongStructureUpdate,
        handleAddMeasure,
        handleRemoveMeasure,
        handleExportXM,
    } = useSongHandlers({
        songStructure, setSongStructure, setIsSongModeOpen,
        patternRef, songStructureRef, trackStorageRef, tempoRef,
        synthARef, synthBRef, kickRef, snareRef, closedHatRef, openHatRef, samplerRef,
        audioEngine, pyodide, sampleBuffers,
    });

    const {
        getSongData, getBankData, getPatternData,
        exportSongToFile, exportRbsToFile, importSongFromFile,
        handleSaveSong, loadSong, loadCloudData,
        handleAISongImport, handleRbsImport,
        isImportingAISong, aiImportProgress, aiImportStage, aiImportError,
        setIsImportingAISong, setAiImportStage, setAiImportProgress,
    } = useSongStorage({
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
        setDrumKit: updateDrumKit,
        setIsSongModeActive,
        trakEventsRef,
    });

    const { synthAChild, synthBChild, bass2Child, samplerChild } = useHardwarePanels({
        synthA, synthB, bass2, sampler,
        updateSynthA, updateSynthB, updateBass2, updateSampler,
        audioEngine, activeSamplerBank, setActiveSamplerBank,
        isVoiceEditorOpen, setIsVoiceEditorOpen,
        ttsPhrases, handleTtsPhraseChange, handleGenerateTTS,
        handleSamplerParamChange, handleLoadSample,
        loadedBanks, sampleBuffers, sliceHighlightRef,
        melodicMode, setMelodicMode, multisampleReady, multisampleProcessing,
        activeAlignment, setActiveAlignment,
    });

    const synthAControls = useStableKnobConfig(getSynthControls, synthA);
    const synthBControls = useStableKnobConfig(getSynthControls, synthB);
    const bass2Controls = useStableKnobConfig(getBass2Controls, bass2);
    const kickControls = useStableKnobConfig(getKickControls, kick);
    const snareControls = useStableKnobConfig(getSnareControls, snare);
    const closedHatControls = useStableKnobConfig(getClosedHatControls, closedHat);
    const openHatControls = useStableKnobConfig(getOpenHatControls, openHat);
    const samplerControls = useStableKnobConfig(getSamplerControls, sampler[activeSamplerBank]);

    return {
        isVoiceEditorOpen, setIsVoiceEditorOpen,
        isCloudLibraryOpen, setIsCloudLibraryOpen,
        isAISongModalOpen, setIsAISongModalOpen,
        isRbsImportModalOpen, setIsRbsImportModalOpen,
        isLyricTrackVisible, setIsLyricTrackVisible,
        isShortcutsHelpOpen, setIsShortcutsHelpOpen,
        showGamepadDebug, setShowGamepadDebug,
        isGenerating, setIsGenerating,
        hasStarted, setHasStarted,
        forceScriptProcessorFallback, setForceScriptProcessorFallback,
        is3DMode, setIs3DMode,
        toast, setToast,
        showToast,
        pyodide, isPyodideReady, pyodideStatus,
        lastFreqRef,
        audioEngine, isReady, initializeAudio, onParamChange,
        isEngineReady,
        pattern, setPattern,
        tempo, setTempo,
        swing, setSwing,
        undoRedo,
        currentStepRef,
        isInitialized, setIsInitialized,
        isPlaying, setIsPlaying,
        isRecording, setIsRecording,
        isAutomationRecording, setIsAutomationRecording,
        selectedTrack, setSelectedTrack,
        ambianceUrl, setAmbianceUrl,
        backgroundImage, setBackgroundImage,
        masterVolume, setMasterVolume,
        masterSaturation, setMasterSaturation,
        globalPan, setGlobalPan,
        reverbType, setReverbType,
        isSongModeOpen, setIsSongModeOpen,
        isSongModeActive, setIsSongModeActive,
        songStructure, setSongStructure,
        currentSongMeasure, setCurrentSongMeasure,
        contextMenu, setContextMenu,
        isNoteDragging, setIsNoteDragging,
        viewMode, setViewMode,
        automationParam, setAutomationParam,
        melodicMode, setMelodicMode,
        activeAlignment, setActiveAlignment,
        lastSamplerMidiRef,
        lastSamplerFormantRef,
        currentScale, setCurrentScale,
        sliceHighlightRef,
        selection, setSelection,
        isSelecting, setIsSelecting,
        clipboard, setClipboard,
        isDrawing, setIsDrawing,
        drawMode, setDrawMode,
        zoomLevel, setZoomLevel,
        trackStorage, setTrackStorage,
        activeTrackSlots, setActiveTrackSlots,
        activeTrackSlotsRef,
        songStorage, setSongStorage,
        activeSongSlot, setActiveSongSlot,
        activeSamplerBank, setActiveSamplerBank,
        activeSamplerBankRef,
        sampleBuffers, setSampleBuffers,
        loadedBanks,
        multisampleReady,
        multisampleProcessing,
        ttsPhrases, setTtsPhrases,
        synthA, setSynthA,
        synthARef,
        updateSynthA,
        synthB, setSynthB,
        synthBRef,
        updateSynthB,
        bass2, setBass2,
        bass2Ref,
        updateBass2,
        kick, setKick,
        kickRef,
        updateKick,
        snare, setSnare,
        snareRef,
        updateSnare,
        closedHat, setClosedHat,
        closedHatRef,
        updateClosedHat,
        openHat, setOpenHat,
        openHatRef,
        updateOpenHat,
        drumKit,
        drumKitRef,
        updateDrumKit,
        sampler, setSampler,
        samplerRef,
        updateSampler,
        samplerVoiceParamsRef,
        samplerVoiceParams, setSamplerVoiceParams,
        harmonizerConfig, setHarmonizerConfig,
        isHarmonizeActive, setIsHarmonizeActive,
        handleStart,
        handleAutoMix,
        handlePanic,
        handlePlayToggle,
        adjustTempo,
        handleTempoHoldStart,
        handleTempoHoldEnd,
        handleTempoKeyDown,
        handleMasterVolume,
        handleMasterVolumeKeyDown,
        handleMasterVolumeReset,
        handleMasterSaturation,
        handleMasterSaturationKeyDown,
        handleMasterSaturationReset,
        handleGlobalPan,
        handleGlobalPanKeyDown,
        handleGlobalPanReset,
        handleReverbType,
        updateStorageForTrack,
        handleCopy,
        handlePaste,
        handleAutomationChange,
        handlePitchChange,
        handlePhonemeUpdate,
        handlePatternChange,
        handleStepToggle,
        handleKeyboardPlay,
        handleKeyboardStop,
        handleDrumPadPlay,
        handleRightMouseDown,
        handleGlobalMouseMove,
        handleGlobalMouseUp,
        handleDrawEnter,
        handleSelectionStart,
        handleSelectionEnter,
        handleSelectionEnd,
        handleNoteSelect,
        handleNoteLengthChange,
        handleNotePropertyChange,
        handleClearPattern,
        handleTrackSlotClick,
        handleSelectRow,
        handleEditLength,
        handleSongModeToggle,
        handleSongStructureUpdate,
        handleAddMeasure,
        handleExportXM,
        handleRemoveMeasure,
        handleLoadSample,
        handleSynthChange,
        handleBass2Change,
        handleKickChange,
        handleSnareChange,
        handleClosedHatChange,
        handleOpenHatChange,
        handleKnobRecordToggle,
        handleSamplerChange,
        handleSamplerParamChange,
        handleTtsPhraseChange,
        handleGenerateTTS,
        handleTextToDrums,
        handleLyricApply,
        onSynthAParamChange,
        onSynthBParamChange,
        onBass2ParamChange,
        handleHarmonizerConfigChange,
        handleSamplerVoiceChange,
        synthAControls,
        synthBControls,
        bass2Controls,
        kickControls,
        snareControls,
        closedHatControls,
        openHatControls,
        samplerControls,
        synthAChild,
        synthBChild,
        bass2Child,
        samplerChild,
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
        setAiImportStage,
        setAiImportProgress,
        patternRef,
        songStructureRef,
        isSongModeActiveRef,
        currentScaleRef,
        trackStorageRef,
        songMeasureRef,
        isFirstStepRef,
        sequencerRef,
        tempoRef,
        tempoHoldIntervalRef,
        tempoHoldTimeoutRef,
        activeKeyboardNotesRef,
        noteDragRef,
    }
}
