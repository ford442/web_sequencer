import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useAudioEngine } from './useAudioEngine'
import { usePyodideEngine } from './usePyodideEngine'
import { useScheduler } from './useScheduler'
import { useStepHandler } from './useStepHandler'
import { useGamepad } from './useGamepad'
import { useStableKnobConfig } from './useStableKnobConfig'
import { useSongStorage } from './useSongStorage'
import { useTTSPreloader } from './useTTSPreloader'
import { SupertonicService } from '../services/Supertonic'
import { exportSongToXM } from '../utils/xmExport'
import { noteToMidi, midiToNote } from '../utils/musicTheory'
import type { ScaleDefinition } from '../utils/musicTheory'
import { copySteps, pasteSteps } from '../utils/clipboardUtils'
import type { MainSequencerHandle } from '../components/MainSequencer'
import type { AlignmentResult } from '../engines/rubberband/PhonemeAligner'
import { type HarmonizerConfig } from '../engines/Harmonizer'
import { WaveformSelector } from '../components/WaveformSelector'
import { SamplerPanel } from '../components/SamplerPanel'

import {
    NUM_STEPS,
    DEFAULT_TEMPO,
    DEFAULT_SYNTH_PARAMS_A,
    DEFAULT_SYNTH_PARAMS_B,
    DEFAULT_BASS2_PARAMS,
    DEFAULT_KICK_PARAMS,
    DEFAULT_SNARE_PARAMS,
    DEFAULT_CLOSED_HAT_PARAMS,
    DEFAULT_OPEN_HAT_PARAMS,
} from '../constants'
import type { Pattern, SynthParams, KickParams, SnareParams, SamplerParams, SamplerBankParams, PartSequence, Note, Bass2Params, PhonemeData, ReverbType } from '../types'
import {
    INITIAL_SAMPLER_PARAMS, UPDATED_INITIAL_PATTERN,
    type TrackKey, type SongSnapshot,
    getInitialTrackStorage,
} from '../constants/appDefaults'
import {
    getBass2Controls, getSynthControls, getKickControls, getSnareControls,
    getClosedHatControls, getOpenHatControls, getSamplerControls,
} from '../utils/knobConfigs'


// --- STRUCTURAL SHALLOW UPDATE HELPERS ---
const updateSamplerStep = (prev: Pattern, bankIdx: number, step: number, updater: (s: any) => any): Pattern => ({
    ...prev,
    sampler: prev.sampler.map((bank, i) =>
        i === bankIdx
            ? { ...bank, steps: bank.steps.map((s, j) => (j === step ? updater(s) : s)) }
            : bank
    ),
});

const updateTrackStep = (prev: Pattern, trackKey: keyof Pattern, step: number, updater: (s: any) => any): Pattern => {
    if (trackKey === 'sampler') return prev; // handled above
    const track = prev[trackKey] as any;
    return {
        ...prev,
        [trackKey]: {
            ...track,
            steps: track.steps.map((s: any, j: number) => (j === step ? updater(s) : s)),
        },
    };
};

const updateSamplerRange = (prev: Pattern, bankIdx: number, low: number, high: number, updater: (s: any) => any): Pattern => ({
    ...prev,
    sampler: prev.sampler.map((bank, i) =>
        i === bankIdx
            ? { ...bank, steps: bank.steps.map((s, j) => (j >= low && j <= high ? updater(s) : s)) }
            : bank
    ),
});

const updateTrackRange = (prev: Pattern, trackKey: keyof Pattern, low: number, high: number, updater: (s: any) => any): Pattern => {
    if (trackKey === 'sampler') return prev; // handled above
    const track = prev[trackKey] as any;
    return {
        ...prev,
        [trackKey]: {
            ...track,
            steps: track.steps.map((s: any, j: number) => (j >= low && j <= high ? updater(s) : s)),
        },
    };
};
// --- END HELPERS ---

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
    const lastFreqRef = useRef<Record<string, number>>({ partA: 0, partB: 0 });
    const { audioEngine, isReady, initializeAudio, onParamChange } = useAudioEngine(pyodide, tempo)
    const isEngineReady = isReady && (isPyodideReady || !!pyodideStatus)

    useTTSPreloader()

    const [viewMode, setViewMode] = useState<'notes' | 'automation'>('notes');
    const [automationParam, setAutomationParam] = useState('formantShift');

    const [melodicMode, setMelodicMode] = useState(false);

    const [activeAlignment, setActiveAlignment] = useState<AlignmentResult | null>(null);

    const lastSamplerMidiRef = useRef<Record<number, number>>({});

    const handleStart = async () => {
        console.log("Initialization sequence started...");
        try {
            setHasStarted(true);
            await initializeAudio();
            setIsInitialized(true);
            console.log("Audio Engine Initialized");
            // Supertonic loads in the background after the loading overlay closes.
            // It's heavy (~235MB of ONNX models) and the app is fully usable without it.
            SupertonicService.getInstance().init().catch((e: unknown) => {
                console.warn('Supertonic TTS failed to init:', e);
            });
        } catch (e) {
            console.error("Failed to start system:", e);
        }
    };

    const [pattern, setPattern] = useState<Pattern>(UPDATED_INITIAL_PATTERN)
    const [isInitialized, setIsInitialized] = useState(false)
    const [isPlaying, setIsPlaying] = useState(false)
    const [isRecording, setIsRecording] = useState(false)
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
    const [clipboard, setClipboard] = useState<(Note | null)[] | null>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [drawMode, setDrawMode] = useState<'add' | 'remove' | null>(null);

    const [zoomLevel, setZoomLevel] = useState(1);

    // Stable refs for event handlers to avoid dependency changes
    const isSelectingRef = useRef(isSelecting);
    const selectionRef = useRef<typeof selection>(selection);

    useEffect(() => {
        isSelectingRef.current = isSelecting;
    }, [isSelecting]);

    useEffect(() => {
        selectionRef.current = selection;
    }, [selection]);

    const handleSelectionStart = useCallback((trackKey: TrackKey, stepIndex: number) => {
        setSelection({ trackKey, startStep: stepIndex, endStep: stepIndex });
        setIsSelecting(true);
    }, []);

    const handleSelectionEnter = useCallback((trackKey: TrackKey, stepIndex: number) => {
        const isSelecting = isSelectingRef.current;
        const selection = selectionRef.current;
        if (isSelecting && selection && selection.trackKey === trackKey) {
            setSelection(prev => prev ? { ...prev, endStep: stepIndex } : null);
        }
    }, [isSelecting, selection]);

    const handleSelectionEnd = useCallback(() => { setIsSelecting(false); }, []);

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

    const [synthA, setSynthA] = useState<SynthParams>(DEFAULT_SYNTH_PARAMS_A);
    const synthARef = useRef<SynthParams>(DEFAULT_SYNTH_PARAMS_A);
    const updateSynthA = useCallback((updates: Partial<SynthParams>) => { setSynthA(prev => { const n = { ...prev, ...updates }; synthARef.current = n; return n; }); }, []);

    const [synthB, setSynthB] = useState<SynthParams>(DEFAULT_SYNTH_PARAMS_B);
    const synthBRef = useRef<SynthParams>(DEFAULT_SYNTH_PARAMS_B);
    const updateSynthB = useCallback((updates: Partial<SynthParams>) => { setSynthB(prev => { const n = { ...prev, ...updates }; synthBRef.current = n; return n; }); }, []);

    const [bass2, setBass2] = useState<Bass2Params>(DEFAULT_BASS2_PARAMS);
    const bass2Ref = useRef<Bass2Params>(DEFAULT_BASS2_PARAMS);
    const updateBass2 = useCallback((updates: Partial<Bass2Params>) => { setBass2(prev => { const n = { ...prev, ...updates }; bass2Ref.current = n; return n; }); }, []);

    const [kick, setKick] = useState<KickParams>(DEFAULT_KICK_PARAMS);
    const kickRef = useRef(DEFAULT_KICK_PARAMS);
    const updateKick = useCallback((u: Partial<KickParams>) => { setKick(prev => { const n = { ...prev, ...u }; kickRef.current = n; return n; }); }, []);

    const [snare, setSnare] = useState<SnareParams>(DEFAULT_SNARE_PARAMS);
    const snareRef = useRef(DEFAULT_SNARE_PARAMS);
    const updateSnare = useCallback((u: Partial<SnareParams>) => { setSnare(prev => { const n = { ...prev, ...u }; snareRef.current = n; return n; }); }, []);

    const [closedHat, setClosedHat] = useState(DEFAULT_CLOSED_HAT_PARAMS);
    const closedHatRef = useRef(DEFAULT_CLOSED_HAT_PARAMS);
    const updateClosedHat = useCallback((u: Partial<typeof DEFAULT_CLOSED_HAT_PARAMS>) => { setClosedHat(prev => { const n = { ...prev, ...u }; closedHatRef.current = n; return n; }); }, []);

    const [openHat, setOpenHat] = useState(DEFAULT_OPEN_HAT_PARAMS);
    const openHatRef = useRef(DEFAULT_OPEN_HAT_PARAMS);
    const updateOpenHat = useCallback((u: Partial<typeof DEFAULT_OPEN_HAT_PARAMS>) => { setOpenHat(prev => { const n = { ...prev, ...u }; openHatRef.current = n; return n; }); }, []);

    const [sampler, setSampler] = useState<SamplerParams>(INITIAL_SAMPLER_PARAMS);
    const samplerRef = useRef(INITIAL_SAMPLER_PARAMS);
    const updateSampler = useCallback((u: SamplerParams) => { setSampler(u); samplerRef.current = u; }, []);

    const samplerVoiceParamsRef = useRef({
        drive: 0,
        rootNote: 60,
        coarseTune: 0,
        fineTune: 0,
        formantShift: 0,
        attack: 0,
        decay: 0.5,
        quality: 'good' as 'preview' | 'good' | 'better' | 'best',
        stretchMode: 'Time' as 'Time' | 'Pitch' | 'Formant',
        lockToSequencer: false
    });
    const [samplerVoiceParams, setSamplerVoiceParams] = useState(samplerVoiceParamsRef.current);
    
    const [harmonizerConfig, setHarmonizerConfig] = useState<HarmonizerConfig>({
        voiceCount: 2,
        harmonyType: 'third',
        detuneSpread: 15,
        formantSpread: 3,
        busGain: 0.85
    });
    const [isHarmonizeActive, setIsHarmonizeActive] = useState(false);
    
    const handleHarmonizerConfigChange = useCallback((config: HarmonizerConfig, isActive: boolean) => {
        setHarmonizerConfig(config);
        setIsHarmonizeActive(isActive);
        if (audioEngine?.setHarmonizerConfig) {
            audioEngine.setHarmonizerConfig(config, isActive);
        }
    }, [audioEngine]);
    
    const handleSamplerVoiceChange = useCallback((param: string, value: number | string | boolean) => {
        const newParams = { ...samplerVoiceParamsRef.current, [param]: value };
        samplerVoiceParamsRef.current = newParams;
        setSamplerVoiceParams(newParams);
        if (audioEngine?.updateSamplerVoiceParams) {
            audioEngine.updateSamplerVoiceParams(activeSamplerBankRef.current, param, value);
        }
    }, [audioEngine]);

    const handleAutoMix = useCallback(() => {
        updateSynthA({ pan: -0.3 });
        updateSynthB({ pan: 0.3 });
        updateBass2({ pan: 0 });
        updateKick({ pan: 0 });
        updateSnare({ pan: 0 });
        updateClosedHat({ pan: 0.15 });
        updateOpenHat({ pan: 0.25 });
        setSampler(prev => {
            const next = [...prev];
            for (let i = 0; i < 8; i++) {
                next[i] = { ...next[i], pan: (i % 2 === 0 ? -0.4 : 0.4) + (i * 0.05) };
            }
            return next;
        });

        updateSynthA({ volume: 0.65 });
        updateSynthB({ volume: 0.65 });
        updateBass2({ volume: 0.85 });
        updateKick({ volume: 0.95 });
        updateSnare({ volume: 0.85 });
        updateClosedHat({ volume: 0.6 });
        updateOpenHat({ volume: 0.65 });
        setSampler(prev => {
            const next = [...prev];
            for (let i = 0; i < 8; i++) {
                next[i] = { ...next[i], volume: 0.7 };
            }
            return next;
        });

        setMasterVolume(0.85);
        if (audioEngine) {
            audioEngine.setMasterVolume(0.85);
        }

        console.log("Auto-Mix Assistant applied deterministic mixing parameters.");
    }, [updateSynthA, updateSynthB, updateBass2, updateKick, updateSnare, updateClosedHat, updateOpenHat, audioEngine]);

    const tempoHoldIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const tempoRef = useRef(tempo);
    useEffect(() => { tempoRef.current = tempo; }, [tempo]);

    const adjustTempo = useCallback((direction: number) => { setTempo(t => Math.max(30, Math.min(300, t + direction))); }, []);
    const tempoHoldTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handleTempoHoldStart = useCallback((direction: number) => {
        adjustTempo(direction);
        tempoHoldTimeoutRef.current = setTimeout(() => { tempoHoldIntervalRef.current = setInterval(() => { adjustTempo(direction); }, 50); }, 300);
    }, [adjustTempo]);
    const handleTempoHoldEnd = useCallback(() => {
        if (tempoHoldTimeoutRef.current) { clearTimeout(tempoHoldTimeoutRef.current); tempoHoldTimeoutRef.current = null; }
        if (tempoHoldIntervalRef.current) { clearInterval(tempoHoldIntervalRef.current); tempoHoldIntervalRef.current = null; }
    }, []);
    const handleTempoKeyDown = useCallback((e: React.KeyboardEvent, direction: number) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); adjustTempo(direction); } }, [adjustTempo]);

    const handlePanic = useCallback(() => {
        if (!audioEngine || !audioEngine.stopAllNotes) return;
        audioEngine.stopAllNotes();
        activeKeyboardNotesRef.current.clear();
    }, [audioEngine]);

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

    const currentScaleRef = useRef(currentScale);
    useEffect(() => { currentScaleRef.current = currentScale; }, [currentScale]);

    const { onStep } = useStepHandler({
        audioEngine,
        tempo,
        onParamChange,
        currentStepRef,
        sequencerRef,
        patternRef,
        lastFreqRef,
        lastSamplerMidiRef,
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
    })

    const { isPlaying: schedPlaying, setIsPlaying: setSchedPlaying } = useScheduler(tempo, NUM_STEPS, onStep, isEngineReady)
    useEffect(() => setIsPlaying(schedPlaying), [schedPlaying])

    useEffect(() => {
        if (!schedPlaying) {
            songMeasureRef.current = 0;
            setCurrentSongMeasure(0);
            isFirstStepRef.current = true;
            if (sequencerRef.current) sequencerRef.current.setHighlight(-1);
            currentStepRef.current = -1;
        }
    }, [schedPlaying]);

    const handlePlayToggle = useCallback(async () => {
        if (!isInitialized) { await initializeAudio(); setIsInitialized(true); }
        setSchedPlaying(prev => !prev)
    }, [isInitialized, initializeAudio, setSchedPlaying]);

    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                const target = e.target as HTMLElement;
                if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
                e.preventDefault();
                handlePlayToggle();
            }
        };
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [handlePlayToggle]);

    const handleMasterVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { const v = parseFloat(e.target.value); setMasterVolume(v); audioEngine?.setMasterVolume(v); }, [audioEngine]);
    const handleMasterVolumeKeyDown = useCallback((e: React.KeyboardEvent) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setMasterVolume(0.8); audioEngine?.setMasterVolume(0.8); } }, [audioEngine]);
    const handleMasterVolumeReset = useCallback(() => { setMasterVolume(0.8); audioEngine?.setMasterVolume(0.8); }, [audioEngine]);

    const handleMasterSaturation = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { const v = parseFloat(e.target.value); setMasterSaturation(v); audioEngine?.setMasterSaturation(v); }, [audioEngine]);
    const handleMasterSaturationKeyDown = useCallback((e: React.KeyboardEvent) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setMasterSaturation(0); audioEngine?.setMasterSaturation(0); } }, [audioEngine]);
    const handleMasterSaturationReset = useCallback(() => { setMasterSaturation(0); audioEngine?.setMasterSaturation(0); }, [audioEngine]);

    const handleGlobalPan = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { const p = parseFloat(e.target.value); const val = (p > -0.1 && p < 0.1) ? 0 : p; setGlobalPan(val); audioEngine?.setGlobalPan(val); }, [audioEngine]);
    const handleGlobalPanKeyDown = useCallback((e: React.KeyboardEvent) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setGlobalPan(0); audioEngine?.setGlobalPan(0); } }, [audioEngine]);
    const handleGlobalPanReset = useCallback(() => { setGlobalPan(0); audioEngine?.setGlobalPan(0); }, [audioEngine]);
    const handleReverbType = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
        const t = e.target.value as ReverbType;
        setReverbType(t);
        audioEngine?.setReverbType?.(t);
    }, [audioEngine]);
    const updateStorageForTrack = useCallback((track: TrackKey, sequence: PartSequence | PartSequence[]) => { setTrackStorage(prev => { const copy = { ...prev }; copy[track] = [...copy[track]]; copy[track][activeTrackSlotsRef.current[track]] = sequence; return copy; }); }, []);

    const handleCopy = useCallback(() => {
        if (!selection) return;
        const copied = copySteps(patternRef.current, selection, activeSamplerBankRef.current);
        if (copied) {
            setClipboard(copied);
            showToast("Copied to clipboard!", "success");
        }
    }, [selection, showToast]);

    const handlePaste = useCallback(() => {
        if (!clipboard) return;
        let targetTrack = selectedTrack;
        let targetStep = 0;
        if (selection) {
            targetTrack = selection.trackKey;
            targetStep = selection.startStep;
        } else {
             if (!window.confirm(`Paste from clipboard to start of ${targetTrack}?`)) return;
        }
        const newPattern = pasteSteps(patternRef.current, clipboard, targetTrack, targetStep, activeSamplerBankRef.current);
        setPattern(newPattern);
        let changedSequence;
        if (targetTrack === 'sampler') {
            changedSequence = newPattern.sampler;
        } else {
            changedSequence = newPattern[targetTrack];
        }
        updateStorageForTrack(targetTrack, changedSequence);
        showToast("Pasted from clipboard!", "success");
    }, [clipboard, selection, selectedTrack, showToast, updateStorageForTrack]);

    const handleAutomationChange = useCallback((trackKey: TrackKey, step: number, value: number) => {
        setPattern(prev => {
            const nextPattern = { ...prev };
            if (trackKey === 'sampler') {
                const bankIdx = activeSamplerBankRef.current;
                const nextSampler = [...nextPattern.sampler];
                const nextBank = { ...nextSampler[bankIdx] };
                const nextAutomation = nextBank.automation ? { ...nextBank.automation } : {};
                const nextParamArray = nextAutomation[automationParam]
                    ? [...nextAutomation[automationParam]]
                    : Array(NUM_STEPS).fill(null);
                nextParamArray[step] = value;
                nextAutomation[automationParam] = nextParamArray;
                nextBank.automation = nextAutomation;
                nextSampler[bankIdx] = nextBank;
                nextPattern.sampler = nextSampler;
                updateStorageForTrack(trackKey, nextSampler);
            } else {
                 const nextTrack = { ...nextPattern[trackKey] } as any;
                 const nextAutomation = nextTrack.automation ? { ...nextTrack.automation } : {};
                 const nextParamArray = nextAutomation[automationParam]
                    ? [...nextAutomation[automationParam]]
                    : Array(NUM_STEPS).fill(null);
                 nextParamArray[step] = value;
                 nextAutomation[automationParam] = nextParamArray;
                 nextTrack.automation = nextAutomation;
                 nextPattern[trackKey] = nextTrack;
                 updateStorageForTrack(trackKey, nextTrack);
            }
            return nextPattern;
        });
    }, [automationParam, updateStorageForTrack]);

    const handlePitchChange = useCallback((trackKey: TrackKey, step: number, pitch: number) => {
        if (trackKey !== 'sampler') return;
        const note = midiToNote(pitch);
        setPattern(prev => {
            const copy = { ...prev };
            const bankIdx = activeSamplerBankRef.current;
            const newSampler = [...copy.sampler];
            const newBank = { ...newSampler[bankIdx] };
            newBank.steps = [...newBank.steps];
            if (newBank.steps[step]) {
                newBank.steps[step] = { ...newBank.steps[step]!, note };
            } else {
                newBank.steps[step] = { note, velocity: 1, length: 1 };
            }
            newSampler[bankIdx] = newBank;
            copy.sampler = newSampler;
            updateStorageForTrack('sampler', newSampler);
            return copy;
        });
    }, [updateStorageForTrack]);

    const handlePhonemeUpdate = useCallback((
        trackKey: TrackKey,
        bankIndex: number,
        step: number,
        phonemes: PhonemeData[] | undefined
    ) => {
        if (trackKey !== 'sampler') return;
        setPattern(prev => {
            const newPattern = { ...prev };
            const newSampler = [...newPattern.sampler];
            const newBank = { ...newSampler[bankIndex] };
            newBank.steps = [...newBank.steps];
            if (newBank.steps[step]) {
                newBank.steps[step] = { ...newBank.steps[step]!, phonemes };
            } else {
                newBank.steps[step] = { note: 'C4', velocity: 1, length: 1, phonemes };
            }
            newSampler[bankIndex] = newBank;
            newPattern.sampler = newSampler;
            updateStorageForTrack('sampler', newSampler);
            return newPattern;
        });
    }, [updateStorageForTrack]);

    const handlePatternChange = useCallback((rowKey: keyof Pattern, i: number, _subIndex?: number | unknown, updates?: { length?: number, slide?: boolean, chord?: string[], sliceIndex?: number }) => {
        const prev = patternRef.current;
        const copy = { ...prev };
        let changedSequence;
        if (rowKey === 'sampler') {
            const bankIndex = activeSamplerBankRef.current;
            const newSampler = [...prev.sampler];
            newSampler[bankIndex] = { ...newSampler[bankIndex], steps: [...newSampler[bankIndex].steps] };
            const steps = newSampler[bankIndex].steps;
            const existing = steps[i];
            if (updates) {
                if (existing) {
                    const newStep = { ...existing };
                    if (updates.length !== undefined) newStep.length = updates.length;
                    if (updates.slide !== undefined) newStep.slide = updates.slide;
                    if (updates.chord !== undefined) newStep.chord = updates.chord;
                    if (updates.sliceIndex !== undefined) newStep.sliceIndex = updates.sliceIndex;
                    steps[i] = newStep;
                    if (updates.length !== undefined) { for (let k = 1; k < updates.length; k++) { const nextStepIdx = i + k; if (nextStepIdx < steps.length) { steps[nextStepIdx] = null; } } }
                }
            } else { if (existing) { steps[i] = null; } else { steps[i] = { note: 'C4', velocity: 1, length: 1, slide: false }; } }
            copy.sampler = newSampler;
            changedSequence = newSampler;
        } else {
            copy[rowKey] = { ...prev[rowKey], steps: [...prev[rowKey].steps] };
            const steps = copy[rowKey].steps;
            const existing = steps[i];
            if (updates) {
                if (existing) {
                    const newStep = { ...existing };
                    if (updates.length !== undefined) newStep.length = updates.length;
                    if (updates.slide !== undefined) newStep.slide = updates.slide;
                    if (updates.chord !== undefined) newStep.chord = updates.chord;
                    steps[i] = newStep;
                    if (updates.length !== undefined) { for (let k = 1; k < updates.length; k++) { const nextStepIdx = i + k; if (nextStepIdx < steps.length) { steps[nextStepIdx] = null; } } }
                }
            } else { if (existing) { steps[i] = null; } else { const defaultNote = rowKey.startsWith('part') ? (rowKey === 'partA' ? 'C4' : 'C3') : 'C4'; steps[i] = { note: defaultNote, velocity: 1, length: 1, slide: false }; } }
            changedSequence = copy[rowKey];
        }
        setPattern(copy);
        updateStorageForTrack(rowKey, changedSequence);
    }, [updateStorageForTrack]);

    const handleStepToggle = useCallback((rowKey: TrackKey, index: number, e: any) => {
        if (e.altKey) { e.preventDefault(); let step = null; if (rowKey === 'sampler') { step = patternRef.current.sampler[activeSamplerBankRef.current].steps[index]; } else { step = patternRef.current[rowKey].steps[index]; } if (step) { handlePatternChange(rowKey, index, undefined, { slide: !step.slide }); } return; }
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); let step = null; if (rowKey === 'sampler') { step = patternRef.current.sampler[activeSamplerBankRef.current].steps[index]; } else { step = patternRef.current[rowKey].steps[index]; } if (step) { if (step.chord && step.chord.length > 0) { handlePatternChange(rowKey, index, undefined, { chord: [] }); } else { const root = noteToMidi(step.note); const chord = [midiToNote(root + 4), midiToNote(root + 7)]; handlePatternChange(rowKey, index, undefined, { chord }); } } return; }
        const pattern = patternRef.current;
        let step = null;
        if (rowKey === 'sampler') { step = pattern.sampler[activeSamplerBankRef.current].steps[index]; }
        else { step = pattern[rowKey].steps[index]; }
        const isActive = !!step;
        if (isActive) {
            setSelection({ trackKey: rowKey, startStep: index, endStep: index });
            return;
        }
        handlePatternChange(rowKey, index, e);
    }, [handlePatternChange]);

    const activeKeyboardNotesRef = useRef<Map<string, number>>(new Map());
const handleKeyboardPlay = useCallback((note: string) => {
    if (!audioEngine) return;

    const time = audioEngine.context.currentTime;

    // Play the note
    if (selectedTrack === 'partA') {
        const maybe = audioEngine.noteOnSynth?.(synthARef.current, note, time, 'partA');
        Promise.resolve(maybe).then((id) => {
            if (id != null) activeKeyboardNotesRef.current.set(note, id);
        });
    } 
    else if (selectedTrack === 'partB') {
        const maybe = audioEngine.noteOnSynth?.(synthBRef.current, note, time, 'partB');
        Promise.resolve(maybe).then((id) => {
            if (id != null) activeKeyboardNotesRef.current.set(note, id);
        });
    } 
    else if (selectedTrack === 'bass2') {
        const bass2Params: SynthParams = {
            waveform: bass2Ref.current.waveform,
            pitch: bass2Ref.current.pitch,
            filterCutoff: bass2Ref.current.cutoff,
            filterResonance: bass2Ref.current.resonance,
            filterMode: bass2Ref.current.filterMode,
            attack: 0.01,
            decay: bass2Ref.current.decay,
            sustain: 0,
            release: 0.1,
            length: 0.25,
            volume: bass2Ref.current.volume,
            delayTime: 0,
            delayFeedback: 0,
            delayMix: 0,
        };
        const maybe = audioEngine.noteOnSynth?.(bass2Params, note, time, 'bass2');
        Promise.resolve(maybe).then((id) => {
            if (id != null) activeKeyboardNotesRef.current.set(note, id);
        });
    } 
    else if (selectedTrack === 'kick') {
        audioEngine.playDrum('kick', kickRef.current, time, null, undefined, note);
    } 
    else if (selectedTrack === 'snare') {
        audioEngine.playDrum('snare', snareRef.current, time, null, undefined, note);
    } 
    else if (selectedTrack === 'closedHat') {
        audioEngine.playDrum('closedHat', closedHatRef.current, time, null, undefined, note);
    } 
    else if (selectedTrack === 'openHat') {
        audioEngine.playDrum('openHat', openHatRef.current, time, null, undefined, note);
    } 
    else if (selectedTrack === 'sampler') {
        const voiceParams = samplerVoiceParamsRef.current;
        const bankParams = {
            ...samplerRef.current[activeSamplerBank],
            rootNote: voiceParams.rootNote,
            coarseTune: voiceParams.coarseTune,
            fineTune: voiceParams.fineTune,
            formantShift: voiceParams.formantShift,
            attack: voiceParams.attack,
            decay: voiceParams.decay,
            quality: voiceParams.quality,
            stretchMode: voiceParams.stretchMode,
            lockToSequencer: voiceParams.lockToSequencer,
        };
        const id = audioEngine.noteOnSampler?.(bankParams, note, time) ?? null;
        if (id != null) activeKeyboardNotesRef.current.set(note, id);
    }

    // Record into pattern if recording + playing
    const step = currentStepRef.current;
    if (isRecording && isPlaying && step >= 0) {
        setPattern(prev => {
            const copy = { ...prev };

            if (selectedTrack === 'sampler') {
                const bankIdx = activeSamplerBankRef.current;
                const nextSampler = [...copy.sampler];
                const nextBank = { ...nextSampler[bankIdx] };

                nextBank.steps = [...nextBank.steps];
                nextBank.steps[step] = { note, velocity: 1, length: 1 };

                nextSampler[bankIdx] = nextBank;
                copy.sampler = nextSampler;

                updateStorageForTrack('sampler', nextSampler);
            } else {
                const nextTrack = { ...(copy[selectedTrack] as any) };
                nextTrack.steps = [...nextTrack.steps];
                nextTrack.steps[step] = { note, velocity: 1, length: 1 };

                copy[selectedTrack] = nextTrack;
                updateStorageForTrack(selectedTrack, nextTrack);
            }

            return copy;
        });
    }
}, [audioEngine, selectedTrack, isRecording, isPlaying, updateStorageForTrack]);

    const handleKeyboardStop = useCallback((note: string) => { if (!audioEngine) return; const id = activeKeyboardNotesRef.current.get(note); if (id === undefined) return; if (selectedTrack === 'partA' || selectedTrack === 'partB' || selectedTrack === 'bass2') { audioEngine.noteOffSynth?.(id); } else if (selectedTrack === 'sampler') { audioEngine.noteOffSampler?.(id); } activeKeyboardNotesRef.current.delete(note); }, [audioEngine, selectedTrack]);
    const handleRightMouseDown = useCallback((track: TrackKey, step: number, e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); let stepData = null; if (track === 'sampler') { stepData = patternRef.current.sampler[activeSamplerBankRef.current].steps[step]; } else { stepData = patternRef.current[track].steps[step]; } if (!stepData) return; setIsNoteDragging(true); const startMidi = noteToMidi(stepData.note); noteDragRef.current = { track, step, startY: e.clientY, startMidi, hasMoved: false, lastMidi: startMidi }; document.body.style.cursor = 'ns-resize'; }, []);
    const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
        if (!isNoteDragging || !noteDragRef.current) return;
        const { track, step, startY, startMidi } = noteDragRef.current;
        const dy = startY - e.clientY;
        if (!noteDragRef.current.hasMoved && Math.abs(dy) > 5) { noteDragRef.current.hasMoved = true; }
        if (noteDragRef.current.hasMoved) {
            const semitoneChange = Math.round(dy / 10);
            const newMidi = startMidi + semitoneChange;
            const clampedMidi = Math.max(24, Math.min(108, newMidi));
            if (clampedMidi !== noteDragRef.current.lastMidi) {
                noteDragRef.current.lastMidi = clampedMidi;
                const newNote = midiToNote(clampedMidi);
                setPattern(prev => {
                    const copy = { ...prev };
                    if (track === 'sampler') { const bankIndex = activeSamplerBank; const newSampler = [...copy.sampler]; const newBank = { ...newSampler[bankIndex] }; newBank.steps = [...newBank.steps]; if (newBank.steps[step]) { newBank.steps[step] = { ...newBank.steps[step]!, note: newNote }; } newSampler[bankIndex] = newBank; copy.sampler = newSampler; if (noteDragRef.current) noteDragRef.current.pendingSequence = copy.sampler; }
                    else { const newTrack = { ...copy[track] }; newTrack.steps = [...newTrack.steps]; if (newTrack.steps[step]) { newTrack.steps[step] = { ...newTrack.steps[step]!, note: newNote }; } copy[track] = newTrack; if (noteDragRef.current) noteDragRef.current.pendingSequence = copy[track]; }
                    return copy;
                });
            }
        }
    }, [isNoteDragging, activeSamplerBank]);
    const handleGlobalMouseUp = useCallback((e: MouseEvent) => {
        if (isDrawing) { setIsDrawing(false); setDrawMode(null); }
        if (!isNoteDragging || !noteDragRef.current) return;
        if (!noteDragRef.current.hasMoved) { const { track, step } = noteDragRef.current; setContextMenu({ x: e.clientX, y: e.clientY, track, step }); }
        else if (noteDragRef.current.pendingSequence) { updateStorageForTrack(noteDragRef.current.track, noteDragRef.current.pendingSequence); }
        setIsNoteDragging(false); noteDragRef.current = null; document.body.style.cursor = 'default';
    }, [isNoteDragging, updateStorageForTrack, isDrawing]);

    useEffect(() => {
        window.addEventListener('pointerup', handleGlobalMouseUp as any);
        if (isNoteDragging) { window.addEventListener('mousemove', handleGlobalMouseMove); window.addEventListener('mouseup', handleGlobalMouseUp); }
        return () => {
            window.removeEventListener('pointerup', handleGlobalMouseUp as any);
            window.removeEventListener('mousemove', handleGlobalMouseMove); window.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, [isNoteDragging, handleGlobalMouseMove, handleGlobalMouseUp]);

    const handleDrawEnter = useCallback(() => {}, []);
useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

        // Copy
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            e.preventDefault();
            handleCopy();
        }

        // Paste
        if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
            e.preventDefault();
            handlePaste();
        }

        // Delete / Backspace → clear selected range
        if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
            const { trackKey, startStep, endStep } = selection;
            const low = Math.min(startStep, endStep);
            const high = Math.max(startStep, endStep);

            setPattern(prev => {
                const copy = { ...prev };

                if (trackKey === 'sampler') {
                    const bankIdx = activeSamplerBankRef.current;
                    const newSampler = [...copy.sampler];
                    const newBank = { ...newSampler[bankIdx] };

                    newBank.steps = [...newBank.steps];
                    for (let i = low; i <= high; i++) {
                        newBank.steps[i] = null;
                    }

                    newSampler[bankIdx] = newBank;
                    copy.sampler = newSampler;

                    updateStorageForTrack(trackKey, newSampler);
                } else {
                    const newTrack = { ...(copy[trackKey] as any) };
                    newTrack.steps = [...newTrack.steps];
                    for (let i = low; i <= high; i++) {
                        newTrack.steps[i] = null;
                    }

                    copy[trackKey] = newTrack;
                    updateStorageForTrack(trackKey, newTrack);
                }

                return copy;
            });

            setSelection(null);
        }

        // Escape → stop tape
        if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            audioEngine?.triggerTapeStop?.(2.0);
        }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mouseup', handleSelectionEnd);

    return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('mouseup', handleSelectionEnd);
    };
}, [selection, handleSelectionEnd, updateStorageForTrack, handleCopy, handlePaste]);
const handleNoteSelect = useCallback((note: string) => {
    if (!contextMenu) return;

    const prev = patternRef.current;
    const copy = { ...prev };
    const trackKey = contextMenu.track as TrackKey;

    if (trackKey === 'sampler') {
        const bankIdx = activeSamplerBankRef.current;
        const newSampler = [...copy.sampler];
        const newBank = { ...newSampler[bankIdx] };

        newBank.steps = [...newBank.steps];
        const stepData = newBank.steps[contextMenu.step];
        if (stepData) {
            newBank.steps[contextMenu.step] = { ...stepData, note };
        }

        newSampler[bankIdx] = newBank;
        copy.sampler = newSampler;

        setPattern(copy);
        updateStorageForTrack(trackKey, newSampler);
    } else {
        const newTrack = { ...(copy[trackKey] as any) };
        newTrack.steps = [...newTrack.steps];
        const stepData = newTrack.steps[contextMenu.step];
        if (stepData) {
            newTrack.steps[contextMenu.step] = { ...stepData, note };
        }

        copy[trackKey] = newTrack;

        setPattern(copy);
        updateStorageForTrack(trackKey, newTrack);
    }

    setContextMenu(null);
}, [contextMenu, updateStorageForTrack]);
const handleNoteLengthChange = useCallback((newLength: number) => {
    if (!contextMenu) return;

    const prev = patternRef.current;
    const copy = { ...prev };
    const trackKey = contextMenu.track;
    const stepIndex = contextMenu.step;

    if (trackKey === 'sampler') {
        const bankIdx = activeSamplerBankRef.current;
        const newSampler = [...copy.sampler];
        const newBank = { ...newSampler[bankIdx] };
        newBank.steps = [...newBank.steps];

        // Update the length of the current step
        const currentStep = newBank.steps[stepIndex];
        if (currentStep) {
            newBank.steps[stepIndex] = { ...currentStep, length: newLength };
        }

        // Nullify subsequent steps covered by the new length
        for (let i = 1; i < newLength; i++) {
            const targetIndex = stepIndex + i;
            if (targetIndex < 256) {
                newBank.steps[targetIndex] = null;
            }
        }

        newSampler[bankIdx] = newBank;
        copy.sampler = newSampler;

        setPattern(copy);
        updateStorageForTrack(trackKey, newSampler);
    } else {
        const newTrack = { ...(copy[trackKey] as any) };
        newTrack.steps = [...newTrack.steps];

        // Update the length of the current step
        const currentStep = newTrack.steps[stepIndex];
        if (currentStep) {
            newTrack.steps[stepIndex] = { ...currentStep, length: newLength };
        }

        // Nullify subsequent steps covered by the new length
        for (let i = 1; i < newLength; i++) {
            const targetIndex = stepIndex + i;
            if (targetIndex < 256) {
                newTrack.steps[targetIndex] = null;
            }
        }

        copy[trackKey] = newTrack;

        setPattern(copy);
        updateStorageForTrack(trackKey, newTrack);
    }

    setContextMenu(null);
}, [contextMenu, updateStorageForTrack]);

const handleNotePropertyChange = useCallback((
    key: 'timbre' | 'velocity' | 'probability' | 'microtiming' | 'reverse' | 'retrigger' | 'freeze' | 'formantShift' | 
         'filterCutoff' | 'filterResonance' | 'envMod' | 'formantLfoRate' | 'formantLfoDepth' | 
         'formantEnvAttack' | 'formantEnvDecay' | 'formantEnvAmount' | 'vibratoDepth' | 'drive' | 
         'characterMorph' | 'reverbSend' | 'reverbType' | 'reverbLfoRate' | 'reverbLfoDepth' | 'delaySend' | 'freezeEnvDepth' |
         'grainEnvDepth' | 'grainPitchQuantize' | 'choir' | 'gateDepth' | 'gateRate' | 'tranceGate',
    value: number | boolean | string
) => {
    if (!contextMenu) return;

    const prev = patternRef.current;
    const copy = { ...prev };
    const trackKey = contextMenu.track;
    const stepIndex = contextMenu.step;

    const updateStep = (stepData: any) => {
        if (!stepData) return stepData;

        const newStep = { ...stepData };

        if (key === 'reverse') {
            if (typeof value === 'boolean') newStep.reverse = value;
        } else if (key === 'reverbType') {
            if (typeof value === 'string') newStep[key] = value;
        } else {
            if (typeof value === 'number') newStep[key] = value;
        }

        return newStep;
    };

    if (trackKey === 'sampler') {
        const bankIdx = activeSamplerBankRef.current;
        const newSampler = [...copy.sampler];
        const newBank = { ...newSampler[bankIdx] };
        newBank.steps = [...newBank.steps];

        const stepData = newBank.steps[stepIndex];
        if (stepData) {
            newBank.steps[stepIndex] = updateStep(stepData);
        }

        newSampler[bankIdx] = newBank;
        copy.sampler = newSampler;

        setPattern(copy);
        updateStorageForTrack(trackKey, newSampler);
    } else {
        const newTrack = { ...(copy[trackKey] as any) };
        newTrack.steps = [...newTrack.steps];

        const stepData = newTrack.steps[stepIndex];
        if (stepData) {
            newTrack.steps[stepIndex] = updateStep(stepData);
        }

        copy[trackKey] = newTrack;

        setPattern(copy);
        updateStorageForTrack(trackKey, newTrack);
    }
}, [contextMenu, updateStorageForTrack]);
    const handleClearPattern = useCallback(() => {
        if (window.confirm("Clear current pattern?")) {
            const emptyPattern: Pattern = {
                partA: { steps: Array(32).fill(null) },
                partB: { steps: Array(32).fill(null) },
                bass2: { steps: Array(32).fill(null) },
                kick: { steps: Array(32).fill(null) },
                snare: { steps: Array(32).fill(null) },
                closedHat: { steps: Array(32).fill(null) },
                openHat: { steps: Array(32).fill(null) },
                sampler: Array.from({ length: 8 }, () => ({ steps: Array(32).fill(null) })),
            };
            setPattern(emptyPattern);
            setTrackStorage(prevStorage => {
                const storageCopy = { ...prevStorage };
                (Object.keys(storageCopy) as TrackKey[]).forEach(key => {
                    storageCopy[key] = [...storageCopy[key]];
                    storageCopy[key][activeTrackSlotsRef.current[key]] = emptyPattern[key];
                });
                return storageCopy;
            });
        }
    }, []);
    const handleTrackSlotClick = useCallback((track: TrackKey, slotIndex: number) => { const currentTrackPattern = track === 'sampler' ? patternRef.current.sampler : patternRef.current[track]; const storedPattern = trackStorageRef.current[track][slotIndex]; if (storedPattern) { setPattern(prev => ({ ...prev, [track]: storedPattern })); setActiveTrackSlots(prev => ({ ...prev, [track]: slotIndex })); } else { setTrackStorage(prev => { const copy = { ...prev }; copy[track] = [...prev[track]]; copy[track][slotIndex] = currentTrackPattern; return copy; }); setActiveTrackSlots(prev => ({ ...prev, [track]: slotIndex })); } }, []);
    const handleSelectRow = useCallback((k: any) => setSelectedTrack(k as TrackKey), []);
    const handleEditLength = useCallback((k: TrackKey, i: number, len: number) => { handlePatternChange(k, i, undefined, { length: len }); }, [handlePatternChange]);
    const handleSongModeToggle = useCallback(() => setIsSongModeOpen(prev => !prev), []);
    const handleSongStructureUpdate = useCallback((idx: number, key: TrackKey, val: number | null) => { setSongStructure(prev => { const copy = [...prev]; copy[idx] = { ...copy[idx], [key]: val }; return copy; }); }, []);
    const handleAddMeasure = useCallback(() => setSongStructure(prev => [...prev, { partA: null, partB: null, bass2: null, kick: null, snare: null, closedHat: null, openHat: null, sampler: null }]), []);
    const handleExportXM = useCallback(() => { exportSongToXM(songStructureRef.current, trackStorageRef.current, { synthA: synthARef.current, synthB: synthBRef.current, kick: kickRef.current, snare: snareRef.current, closedHat: closedHatRef.current, openHat: openHatRef.current, sampler: samplerRef.current }, tempoRef.current, patternRef.current, { webGpuEngine: audioEngine?.webGpuEngine, wasmEngine: audioEngine?.wasmEngine, pyodide: pyodide }, sampleBuffers); }, [audioEngine, pyodide, sampleBuffers]);
    const handleRemoveMeasure = useCallback(() => { const currentStructure = songStructure; if (currentStructure.length === 0) return; const last = currentStructure[currentStructure.length - 1]; const hasData = Object.values(last).some(v => v !== null); if (hasData) { if (!window.confirm("The last measure contains patterns. Are you sure you want to remove it?")) return; } setSongStructure(prev => prev.slice(0, -1)); }, [songStructure]);
    const handleLoadSample = useCallback(async (name: string, buffer: AudioBuffer, onProgress?: (progress: number) => void) => {
        if (!audioEngine) return;
        await audioEngine.loadSampleToEngine(name, buffer, onProgress);
        setSampleBuffers(prev => { const next = [...prev]; next[activeSamplerBank] = buffer; return next; });
        const bankName = `bank_${activeSamplerBank}`;
        setSampler(prev => { const newParams = [...prev]; newParams[activeSamplerBank] = { ...newParams[activeSamplerBank], sampleName: bankName }; return newParams; });
        if (audioEngine.prepareVocal) {
            const text = ttsPhrases[activeSamplerBank] || "Hello World";
            audioEngine.prepareVocal(activeSamplerBank, text).then(() => {
                if (audioEngine.getAlignment) {
                    setActiveAlignment(audioEngine.getAlignment(activeSamplerBank));
                }
            });
        }
    }, [audioEngine, activeSamplerBank, ttsPhrases]);

    const {
        getSongData, getBankData, getPatternData,
        exportSongToFile, importSongFromFile,
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
    });

    const handleSynthChange = useCallback((isA: boolean, id: string, val: number) => { const updater = isA ? updateSynthA : updateSynthB; let realVal = val; if (id === 'pitch') realVal = Math.floor(val * 48 - 24); else if (id === 'filterCutoff') realVal = val * 8000; else if (id === 'filterResonance') realVal = val * 20; else if (id === 'filterMode') realVal = Math.round(val); else if (id === 'decay') realVal = val * 2; else if (id === 'release') realVal = val * 2; else if (id === 'length') realVal = val * 2; updater({ [id]: realVal }); }, [updateSynthA, updateSynthB]);
    const handleBass2Change = useCallback((id: string, val: number) => { let realVal = val; if (id === 'waveform') realVal = val > 0.5 ? 1 : 0; else if (id === 'cutoff') realVal = val * 8000; else if (id === 'resonance') realVal = val * 20; else if (id === 'filterMode') realVal = Math.round(val); else if (id === 'decay') realVal = val * 2; else if (id === 'pitch') realVal = Math.floor(val * 48 - 24); updateBass2({ [id]: realVal }); }, [updateBass2]);
    const handleKickChange = useCallback((id: string, val: number) => { let realVal = val; if (id === 'pitch') realVal = val * 130 + 20; updateKick({ [id]: realVal }); }, [updateKick]);
    const handleSnareChange = useCallback((id: string, val: number) => { let realVal = val; if (id === 'tone') realVal = val * 300 + 100; else if (id === 'noise') realVal = val * 7000 + 1000; else if (id === 'decay') realVal = val * 0.5; updateSnare({ [id]: realVal }); }, [updateSnare]);
    const handleClosedHatChange = useCallback((id: string, val: number) => updateClosedHat({ [id]: val }), [updateClosedHat]);
    const handleOpenHatChange = useCallback((id: string, val: number) => updateOpenHat({ [id]: val }), [updateOpenHat]);
    const handleSamplerChange = useCallback((id: string, val: number) => {
        let realVal = val; if (id === 'playbackSpeed') realVal = val * 4.0; else if (id === 'filterCutoff') realVal = val * 20000; else if (id === 'filterResonance') realVal = val * 20; setSampler(prev => {
            const next = [...prev]; const currentBank = next[activeSamplerBank];
            next[activeSamplerBank] = { ...currentBank, [id]: realVal }; return next;
        });
    }, [activeSamplerBank]);

    const handleSamplerParamChange = useCallback((bankIdx: number, key: string, val: any) => {
        setSampler(prev => {
            const next = [...prev];
            if (next[bankIdx]) {
                next[bankIdx] = { ...next[bankIdx], [key as keyof SamplerBankParams]: val };
            }
            samplerRef.current = next;
            return next;
        });
    }, []);

    const handleTtsPhraseChange = useCallback((newPhrases: string[]) => {
        setTtsPhrases(newPhrases);
        if (audioEngine?.prepareVocal) {
            const text = newPhrases[activeSamplerBank];
            audioEngine.prepareVocal(activeSamplerBank, text).then(() => {
                if (audioEngine.getAlignment) {
                    setActiveAlignment(audioEngine.getAlignment(activeSamplerBank));
                }
            });
        }
    }, [audioEngine, activeSamplerBank]);

    const handleGenerateTTS = useCallback(async (text: string) => {
        if (!audioEngine) return;
        setIsGenerating(true);
        try {
            const rawData = await SupertonicService.getInstance().generate(text);
            const buffer = audioEngine.context.createBuffer(1, rawData.length, 44100);
            buffer.getChannelData(0).set(rawData);
            const bankName = `bank_${activeSamplerBankRef.current}`;
            handleLoadSample(bankName, buffer);
            showToast(`Generated: ${text.substring(0, 15)}...`, "success");
        } catch (e) {
            console.error(e);
            showToast("TTS Generation Failed", "error");
            throw e;
        } finally {
            setIsGenerating(false);
        }
    }, [audioEngine, handleLoadSample, showToast]);

    const handleTextToDrums = useCallback(async (text: string) => {
        try {
            await handleGenerateTTS(text);
            const alignment = audioEngine?.getAlignment?.(activeSamplerBankRef.current);
            if (!alignment) return;
            const newPattern = { ...patternRef.current };
            const newKick = { ...newPattern.kick, steps: [...newPattern.kick.steps] };
            const newSnare = { ...newPattern.snare, steps: [...newPattern.snare.steps] };
            const newCH = { ...newPattern.closedHat, steps: [...newPattern.closedHat.steps] };
            const newOH = { ...newPattern.openHat, steps: [...newPattern.openHat.steps] };
            newKick.steps = Array(32).fill(null);
            newSnare.steps = Array(32).fill(null);
            newCH.steps = Array(32).fill(null);
            newOH.steps = Array(32).fill(null);
            const stepTime = 60 / tempoRef.current / 4;
            alignment.phonemes.forEach((p, idx) => {
                const stepIdx = Math.round(p.start / stepTime);
                if (stepIdx >= 0 && stepIdx < 32) {
                    const ph = p.phoneme.toUpperCase().replace(/[0-9]/g, '');
                    const isVowel = ['AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW'].includes(ph);
                    const isSnare = ['B','D','G','CH','JH','K','P','T'].includes(ph);
                    const isHat = ['F','S','SH','TH','V','Z','ZH'].includes(ph);
                    const isOpenHat = ['SH','ZH','S','F'].includes(ph) && p.end - p.start > 0.15;
                    if (isVowel) newKick.steps[stepIdx] = { note: 'C4', velocity: 1, length: 1 };
                    else if (isSnare) newSnare.steps[stepIdx] = { note: 'C4', velocity: 1, length: 1 };
                    else if (isOpenHat) newOH.steps[stepIdx] = { note: 'C4', velocity: 1, length: 1 };
                    else if (isHat) newCH.steps[stepIdx] = { note: 'C4', velocity: 1, length: 1 };
                    else newCH.steps[stepIdx] = { note: 'C4', velocity: 0.5, length: 1 };
                }
            });
            newPattern.kick = newKick;
            newPattern.snare = newSnare;
            newPattern.closedHat = newCH;
            newPattern.openHat = newOH;
            setPattern(newPattern);
            updateStorageForTrack('kick', newKick);
            updateStorageForTrack('snare', newSnare);
            updateStorageForTrack('closedHat', newCH);
            updateStorageForTrack('openHat', newOH);
            showToast("Drumkit generated from text!", "success");
            setIsLyricTrackVisible(false);
        } catch(e) {
            console.error(e);
            showToast("Failed to generate drums.", "error");
        }
    }, [handleGenerateTTS, audioEngine, updateStorageForTrack, showToast]);
const handleLyricApply = useCallback(async (text: string) => {
    try {
        await handleGenerateTTS(text);

        const newPhrases = [...ttsPhrases];
        newPhrases[activeSamplerBankRef.current] = text;
        setTtsPhrases(newPhrases);

        const prev = patternRef.current;
        const copy = { ...prev };
        const bankIdx = activeSamplerBankRef.current;

        const newSampler = [...copy.sampler];
        const newBank = { ...newSampler[bankIdx] };
        newBank.steps = [...newBank.steps];

        let noteIndex = 0;
        for (let i = 0; i < 32; i++) {
            const step = newBank.steps[i];
            if (step && step.velocity > 0) {
                newBank.steps[i] = { ...step, sliceIndex: noteIndex };
                noteIndex++;
            }
        }

        newSampler[bankIdx] = newBank;
        copy.sampler = newSampler;

        setPattern(copy);
        updateStorageForTrack('sampler', newSampler);

        setSampler(prevParams => {
            const next = [...prevParams];
            if (next[bankIdx]) {
                next[bankIdx] = { ...next[bankIdx], sliceMode: 'phoneme' };
            }
            samplerRef.current = next;
            return next;
        });

        if (noteIndex > 0) {
            showToast(`Mapped ${noteIndex} syllables across Sampler Bank ${bankIdx + 1}!`, "success");
        } else {
            showToast("Generated TTS! (No notes found to map syllables to)", "success");
        }

        setIsLyricTrackVisible(false);
    } catch (e) {
        console.error(e);
        showToast("Failed to generate or map lyrics.", "error");
    }
}, [handleGenerateTTS, ttsPhrases, updateStorageForTrack, showToast]);

    const onSynthAParamChange = useCallback((id: string, v: number) => handleSynthChange(true, id, v), [handleSynthChange]);
    const onSynthBParamChange = useCallback((id: string, v: number) => handleSynthChange(false, id, v), [handleSynthChange]);
    const onBass2ParamChange = useCallback((id: string, v: number) => handleBass2Change(id, v), [handleBass2Change]);

    const synthAControls = useStableKnobConfig(getSynthControls, synthA);
    const synthBControls = useStableKnobConfig(getSynthControls, synthB);
    const bass2Controls = useStableKnobConfig(getBass2Controls, bass2);
    const kickControls = useStableKnobConfig(getKickControls, kick);
    const snareControls = useStableKnobConfig(getSnareControls, snare);
    const closedHatControls = useStableKnobConfig(getClosedHatControls, closedHat);
    const openHatControls = useStableKnobConfig(getOpenHatControls, openHat);
    const samplerControls = useStableKnobConfig(getSamplerControls, sampler[activeSamplerBank]);

    const synthAChild = useMemo(() => (<div className="absolute top-4 right-6 pointer-events-auto"><WaveformSelector selected={synthA.waveform} onChange={(w) => updateSynthA({ waveform: w })} accentColor="cyan" /></div>), [synthA.waveform, updateSynthA]);
    const synthBChild = useMemo(() => (<div className="absolute top-4 right-6 pointer-events-auto"><WaveformSelector selected={synthB.waveform} onChange={(w) => updateSynthB({ waveform: w })} accentColor="pink" /></div>), [synthB.waveform, updateSynthB]);
    const bass2Child = useMemo(() => (
        <div className="absolute top-4 right-6 pointer-events-auto">
            <div className="flex flex-col gap-2 p-2 rounded-lg bg-zinc-950/80 border border-pink-500/20">
                <span className="text-[8px] font-mono text-pink-400/60 uppercase tracking-wider text-center">Waveform</span>
                <button 
                    onClick={() => updateBass2({ waveform: '303-saw' })} 
                    className={`px-4 py-1.5 text-[10px] font-bold rounded-md transition-all border ${
                        bass2.waveform === '303-saw' 
                            ? 'bg-gradient-to-b from-pink-500 to-pink-600 text-white border-pink-400 shadow-[0_0_12px_rgba(255,0,102,0.5),inset_0_1px_0_rgba(255,255,255,0.2)]' 
                            : 'bg-gradient-to-b from-zinc-800 to-zinc-900 text-zinc-400 border-zinc-700 hover:text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                    }`}
                >
                    SAW
                </button>
                <button 
                    onClick={() => updateBass2({ waveform: '303-sqr' })} 
                    className={`px-4 py-1.5 text-[10px] font-bold rounded-md transition-all border ${
                        bass2.waveform === '303-sqr' 
                            ? 'bg-gradient-to-b from-pink-500 to-pink-600 text-white border-pink-400 shadow-[0_0_12px_rgba(255,0,102,0.5),inset_0_1px_0_rgba(255,255,255,0.2)]' 
                            : 'bg-gradient-to-b from-zinc-800 to-zinc-900 text-zinc-400 border-zinc-700 hover:text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]'
                    }`}
                >
                    SQR
                </button>
            </div>
        </div>
    ), [bass2.waveform, updateBass2]);
    const samplerChild = useMemo(() => (<div className="absolute top-2 left-[25%] w-[50%] max-h-[280px] h-auto pointer-events-auto z-10 bg-gray-900/90 rounded-lg border border-purple-500/30 backdrop-blur-sm overflow-hidden"><SamplerPanel params={sampler} onChange={(u) => updateSampler(u)} onParamChange={handleSamplerParamChange} onLoadSample={handleLoadSample} audioContext={audioEngine?.context!} audioEngine={audioEngine || undefined} activeBankIdx={activeSamplerBank} onBankChange={setActiveSamplerBank} onOpenEditor={() => setIsVoiceEditorOpen(true)} isVoiceEditorOpen={isVoiceEditorOpen} ttsPhrases={ttsPhrases} onTtsPhraseChange={handleTtsPhraseChange} onGenerateTTS={handleGenerateTTS} loadedBanks={loadedBanks} sampleBuffer={sampleBuffers[activeSamplerBank]} sliceHighlightRef={sliceHighlightRef} melodicMode={melodicMode} onMelodicModeChange={setMelodicMode} multisampleReady={multisampleReady} multisampleProcessing={multisampleProcessing} alignment={activeAlignment} onAlignmentChange={(newAlignment) => { audioEngine?.setAlignment?.(activeSamplerBank, newAlignment); setActiveAlignment(newAlignment); }} /></div>), [sampler, updateSampler, handleSamplerParamChange, audioEngine, setIsVoiceEditorOpen, isVoiceEditorOpen, activeSamplerBank, handleLoadSample, ttsPhrases, handleTtsPhraseChange, handleGenerateTTS, loadedBanks, sampleBuffers, melodicMode, multisampleReady, multisampleProcessing, activeAlignment, setActiveAlignment]);

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
        isInitialized, setIsInitialized,
        isPlaying, setIsPlaying,
        isRecording, setIsRecording,
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
        currentStepRef,
        tempoRef,
        tempoHoldIntervalRef,
        tempoHoldTimeoutRef,
        activeKeyboardNotesRef,
        noteDragRef,
    }
}
