import { useCallback, useEffect, useRef, useState, useMemo, lazy, Suspense } from 'react'
import { useAudioEngine } from './hooks/useAudioEngine'
import { usePyodideEngine } from './hooks/usePyodideEngine'
import { useScheduler } from './hooks/useScheduler'
import { useStepHandler } from './hooks/useStepHandler'
import { useGamepad } from './hooks/useGamepad';
import { useStableKnobConfig } from './hooks/useStableKnobConfig';
import { useSongStorage } from './hooks/useSongStorage';
import { GamepadDebugger } from './components/GamepadDebugger';
import { HardwareModule } from './components/HardwareModule';
import { SamplerVoicePanel } from './components/SamplerVoicePanel';
import { WaveformSelector } from './components/WaveformSelector';
import { NoteSelector } from './components/NoteSelector';
import { LiveKeyboard } from './components/LiveKeyboard';
import { LyricTrack } from './components/LyricTrack';
import { ShortcutsHelp } from './components/ShortcutsHelp';
import { VoiceEditor } from './components/VoiceEditor';
import { SamplerPanel } from './components/SamplerPanel';
import { SongMode } from './components/SongMode';
import { CloudLibrary } from './components/CloudLibrary';
import { AISongModal } from './components/AISongModal';
import { RbsImportModal } from './components/RbsImportModal';
import { CloudStatus } from './components/CloudStatus';
import { Toast } from './components/Toast';
import { SupertonicService } from './services/Supertonic';
import { loadingProgressStore } from './stores/loadingProgressStore';
import { exportSongToXM } from './utils/xmExport';
import { getNoteColor } from './utils/noteColors';
import { noteToMidi, midiToNote } from './utils/musicTheory';
import { copySteps, pasteSteps } from './utils/clipboardUtils';
import { MainSequencer, ROWS } from './components/MainSequencer';
import type { MainSequencerHandle } from './components/MainSequencer';
import type { AlignmentResult } from './engines/rubberband/PhonemeAligner';
import { SEQUENCER_STYLES } from './components/sequencer/constants';
import { Harmonizer, type HarmonizerConfig, HARMONIZE_PRESETS } from './engines/Harmonizer';

const Studio3D = lazy(() => import('./components/Studio3D').then(module => ({ default: module.Studio3D })));

import {
    noteToFrequency,
    INITIAL_PATTERN,
    NUM_STEPS,
    DEFAULT_TEMPO,
    DEFAULT_SYNTH_PARAMS_A,
    DEFAULT_SYNTH_PARAMS_B,
    DEFAULT_BASS2_PARAMS,
    DEFAULT_KICK_PARAMS,
    DEFAULT_SNARE_PARAMS,
    DEFAULT_CLOSED_HAT_PARAMS,
    DEFAULT_OPEN_HAT_PARAMS,
} from './constants'
import type { Pattern, SynthParams, KickParams, SnareParams, SamplerParams, SamplerBankParams, PartSequence, Note, Bass2Params, PhonemeData } from './types'
import {
    DEFAULT_SAMPLER_BANK_PARAMS, INITIAL_SAMPLER_PARAMS, UPDATED_INITIAL_PATTERN,
    type TrackKey, type SongSnapshot,
    getInitialTrackStorage,
    COLOR_LEAD, COLOR_BASS, COLOR_BASS2, COLOR_KICK, COLOR_SNARE, COLOR_CH, COLOR_OH, COLOR_SAMPLER,
    EMPTY_SEQ, EMPTY_SAMPLER_SEQUENCE, EMPTY_PATTERN,
} from './constants/appDefaults'
import {
    getBass2Controls, getSynthControls, getKickControls, getSnareControls,
    getClosedHatControls, getOpenHatControls, getSamplerControls,
} from './utils/knobConfigs'
import { StartOverlay } from './components/StartOverlay'

export const App: React.FC = () => {
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
        // Read persisted preference from localStorage
        return localStorage.getItem('forceScriptProcessorFallback') === 'true';
    });

    // Initialize Gamepad Support
    useGamepad();

    // NEW: 3D Mode State
    const [is3DMode, setIs3DMode] = useState(false);

    // Toast Notification State
    const [toast, setToast] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
    const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
        setToast({ message, type });
    }, []);

    const lastFreqRef = useRef<Record<string, number>>({ partA: 0, partB: 0 });
    const { audioEngine, isReady, initializeAudio, onParamChange } = useAudioEngine(pyodide)
    const isEngineReady = isReady && (isPyodideReady || !!pyodideStatus)

    // NEW: Automation View State
    const [viewMode, setViewMode] = useState<'notes' | 'automation'>('notes');
    const [automationParam, setAutomationParam] = useState('formantShift');

    // NEW: Melodic Lyric Mode
    const [melodicMode, setMelodicMode] = useState(false);

    // NEW: Phoneme Alignment State for UI Feedback
    const [activeAlignment, setActiveAlignment] = useState<AlignmentResult | null>(null);

    // Store last sampler MIDI for slide calculations
    const lastSamplerMidiRef = useRef<Record<number, number>>({});

    const handleStart = async () => {
        console.log("Initialization sequence started...");
        try {
            // We set hasStarted immediately or use a timeout to ensure
            // the UI unblocks even if a non-critical engine part is slow.
            setHasStarted(true);

            await initializeAudio();
            setIsInitialized(true);
            console.log("Audio Engine Initialized");

            // Kick off TTS model loading in the background immediately after audio init.
            // Models are ~235 MB; starting early means they're ready when the user opens the sampler.
            loadingProgressStore.startStep('ttsEngine');
            SupertonicService.getInstance().init().then(() => {
                loadingProgressStore.completeStep('ttsEngine');
            }).catch((e: unknown) => {
                loadingProgressStore.failStep(
                    'ttsEngine',
                    e instanceof Error ? e : new Error(String(e)),
                    true // recoverable — app works without TTS
                );
            });
        } catch (e) {
            console.error("Failed to start system:", e);
        }
    };

    const [pattern, setPattern] = useState<Pattern>(UPDATED_INITIAL_PATTERN)
    const [tempo, setTempo] = useState<number>(DEFAULT_TEMPO)
    const [isInitialized, setIsInitialized] = useState(false)
    const [isPlaying, setIsPlaying] = useState(false)
    const [isRecording, setIsRecording] = useState(false)
    const [selectedTrack, setSelectedTrack] = useState<TrackKey>('partA')
    const [ambianceUrl, setAmbianceUrl] = useState<string>('')
    const [backgroundImage, setBackgroundImage] = useState<string>('')
    const [masterVolume, setMasterVolume] = useState(0.8)
    const [masterSaturation, setMasterSaturation] = useState(0)
    const [globalPan, setGlobalPan] = useState(0)

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

    // Ref for visual slice feedback
    const sliceHighlightRef = useRef<((slice: number) => void) | null>(null);

    // --- SELECTION STATE ---
    const [selection, setSelection] = useState<{ trackKey: TrackKey; startStep: number; endStep: number; } | null>(null);
    const [isSelecting, setIsSelecting] = useState(false);
    const [clipboard, setClipboard] = useState<(Note | null)[] | null>(null);
    // Drag-to-Edit State
    const [isDrawing, setIsDrawing] = useState(false);
    const [drawMode, setDrawMode] = useState<'add' | 'remove' | null>(null);

    const handleSelectionStart = useCallback((trackKey: TrackKey, stepIndex: number) => {
        setSelection({ trackKey, startStep: stepIndex, endStep: stepIndex });
        setIsSelecting(true);
    }, []);

    const handleSelectionEnter = useCallback((trackKey: TrackKey, stepIndex: number) => {
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

    // Update active alignment when bank changes
    useEffect(() => {
        activeSamplerBankRef.current = activeSamplerBank;
        if (audioEngine && audioEngine.getAlignment) {
            setActiveAlignment(audioEngine.getAlignment(activeSamplerBank));
        }
    }, [activeSamplerBank, audioEngine]);

    const [sampleBuffers, setSampleBuffers] = useState<(AudioBuffer | null)[]>(new Array(8).fill(null));
    const loadedBanks = useMemo(() => sampleBuffers.map(b => !!b), [sampleBuffers]);
    
    // Multisample bank status
    const multisampleReady = useMemo(() => 
        Array.from({ length: 8 }, (_, i) => audioEngine?.isMultisampleReady?.(i) ?? false),
        [audioEngine, sampleBuffers] // Recompute when audioEngine or samples change
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

    // Sampler Voice Controls State - stored in refs for audio engine access
    const samplerVoiceParamsRef = useRef({
        rootNote: 60,      // C4
        coarseTune: 0,     // ±24 st
        fineTune: 0,       // ±50 ¢
        formantShift: 0,   // ±12 st
        pitchAttack: 0,    // 0-1
        pitchDecay: 0.5,   // 0-1
        quality: 'good' as 'preview' | 'good' | 'better' | 'best',
        stretchMode: 'elastic' as 'precise' | 'elastic' | 'hybrid',
        lockToSequencer: false
    });
    const [samplerVoiceParams, setSamplerVoiceParams] = useState(samplerVoiceParamsRef.current);
    
    // Harmonizer State
    const [harmonizerConfig, setHarmonizerConfig] = useState<HarmonizerConfig>({
        voiceCount: 2,
        harmonyType: 'third',
        detuneSpread: 15,
        formantSpread: 3
    });
    const [isHarmonizeActive, setIsHarmonizeActive] = useState(false);
    
    const handleHarmonizerConfigChange = useCallback((config: HarmonizerConfig, isActive: boolean) => {
        setHarmonizerConfig(config);
        setIsHarmonizeActive(isActive);
        // Update audio engine
        if (audioEngine?.setHarmonizerConfig) {
            audioEngine.setHarmonizerConfig(config, isActive);
        }
    }, [audioEngine]);
    
    const handleSamplerVoiceChange = useCallback((param: string, value: number | string | boolean) => {
        const newParams = { ...samplerVoiceParamsRef.current, [param]: value };
        samplerVoiceParamsRef.current = newParams;
        setSamplerVoiceParams(newParams);
        
        // Also update the audio engine's voice params in real-time
        if (audioEngine?.updateSamplerVoiceParams) {
            audioEngine.updateSamplerVoiceParams(activeSamplerBankRef.current, param, value);
        }
    }, [audioEngine]);

    const tempoHoldIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const tempoRef = useRef(tempo);
    useEffect(() => { tempoRef.current = tempo; }, [tempo]);

    const adjustTempo = useCallback((direction: number) => { setTempo(t => Math.max(30, Math.min(300, t + direction))); }, []);
    const handleTempoHoldStart = useCallback((direction: number) => {
        adjustTempo(direction);
        const timeout = setTimeout(() => { tempoHoldIntervalRef.current = setInterval(() => { adjustTempo(direction); }, 50); }, 300);
        (tempoHoldIntervalRef as any).timeout = timeout;
    }, [adjustTempo]);
    const handleTempoHoldEnd = useCallback(() => {
        if ((tempoHoldIntervalRef as any).timeout) { clearTimeout((tempoHoldIntervalRef as any).timeout); }
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

    // Global Key Handler for Play/Pause (Spacebar)
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

    const handleMasterVolume = (e: React.ChangeEvent<HTMLInputElement>) => { const v = parseFloat(e.target.value); setMasterVolume(v); audioEngine?.setMasterVolume(v); };
    const handleMasterVolumeKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setMasterVolume(0.8); audioEngine?.setMasterVolume(0.8); } };
    const handleMasterVolumeReset = () => { setMasterVolume(0.8); audioEngine?.setMasterVolume(0.8); };

    const handleMasterSaturation = (e: React.ChangeEvent<HTMLInputElement>) => { const v = parseFloat(e.target.value); setMasterSaturation(v); audioEngine?.setMasterSaturation(v); };
    const handleMasterSaturationKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setMasterSaturation(0); audioEngine?.setMasterSaturation(0); } };
    const handleMasterSaturationReset = () => { setMasterSaturation(0); audioEngine?.setMasterSaturation(0); };

    const handleGlobalPan = (e: React.ChangeEvent<HTMLInputElement>) => { const p = parseFloat(e.target.value); const val = (p > -0.1 && p < 0.1) ? 0 : p; setGlobalPan(val); audioEngine?.setGlobalPan(val); };
    const handleGlobalPanKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setGlobalPan(0); audioEngine?.setGlobalPan(0); } };
    const handleGlobalPanReset = () => { setGlobalPan(0); audioEngine?.setGlobalPan(0); };
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

        // If selection is active, use it as target
        if (selection) {
            targetTrack = selection.trackKey;
            targetStep = selection.startStep;
        } else {
            // Default to start of track if no selection, but ask for confirmation or just notify
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

                // Update storage
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
    }, [activeSamplerBank, automationParam, updateStorageForTrack]);

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
                // If no step exists, create one with default values
                newBank.steps[step] = { note: 'C4', velocity: 1, length: 1, phonemes };
            }

            newSampler[bankIndex] = newBank;
            newPattern.sampler = newSampler;

            // Also update storage for persistence
            updateStorageForTrack('sampler', newSampler);
            return newPattern;
        });
    }, [updateStorageForTrack]);

    const handlePatternChange = useCallback((rowKey: keyof Pattern, i: number, _subIndex?: number | unknown, updates?: { length?: number, slide?: boolean, chord?: string[], sliceIndex?: number }) => {
        // Use Ref to access current state without dependency to avoid re-renders of all rows
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

        // Start Drag Drawing
        const pattern = patternRef.current;
        let step = null;
        if (rowKey === 'sampler') { step = pattern.sampler[activeSamplerBankRef.current].steps[index]; }
        else { step = pattern[rowKey].steps[index]; }
        const isActive = !!step;

        setIsDrawing(true);
        setDrawMode(isActive ? 'remove' : 'add');

        handlePatternChange(rowKey, index, e);
    }, [handlePatternChange, activeSamplerBank]);

    const activeKeyboardNotesRef = useRef<Map<string, number>>(new Map());
    const handleKeyboardPlay = useCallback((note: string) => {
        if (!audioEngine) return;
        const time = audioEngine.context.currentTime;
        if (selectedTrack === 'partA') { const maybe = audioEngine.noteOnSynth?.(synthARef.current, note, time, 'partA'); Promise.resolve(maybe).then((id) => { if (id) activeKeyboardNotesRef.current.set(note, id); }); }
        else if (selectedTrack === 'partB') { const maybe = audioEngine.noteOnSynth?.(synthBRef.current, note, time, 'partB'); Promise.resolve(maybe).then((id) => { if (id) activeKeyboardNotesRef.current.set(note, id); }); }
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
            // @ts-expect-error - Auto-generated to fix CI build
            const maybe = audioEngine.noteOnSynth?.(bass2Params, note, time, 'bass2'); 
            Promise.resolve(maybe).then((id) => { if (id) activeKeyboardNotesRef.current.set(note, id); }); 
        }
        else if (selectedTrack === 'kick') audioEngine.playDrum('kick', { ...kickRef.current, pitch: 60 }, time);
        else if (selectedTrack === 'snare') audioEngine.playDrum('snare', snareRef.current, time);
        else if (selectedTrack === 'closedHat') audioEngine.playDrum('closedHat', closedHatRef.current, time);
        else if (selectedTrack === 'openHat') audioEngine.playDrum('openHat', openHatRef.current, time);
        else if (selectedTrack === 'sampler') { 
            // Merge sampler voice params with bank params for keyboard playback
            const voiceParams = samplerVoiceParamsRef.current;
            const bankParams = {
                ...samplerRef.current[activeSamplerBank],
                rootNote: voiceParams.rootNote,
                coarseTune: voiceParams.coarseTune,
                fineTune: voiceParams.fineTune,
                formantShift: voiceParams.formantShift,
                pitchAttack: voiceParams.pitchAttack,
                pitchDecay: voiceParams.pitchDecay,
                quality: voiceParams.quality,
                stretchMode: voiceParams.stretchMode,
                lockToSequencer: voiceParams.lockToSequencer
            };
            // @ts-expect-error - Auto-generated to fix CI build
            const id = audioEngine.noteOnSampler?.(bankParams, note, time) ?? null; 
            if (id) activeKeyboardNotesRef.current.set(note, id); 
        }
        const step = currentStepRef.current;
        if (isRecording && isPlaying && step >= 0) { setPattern(prev => { const copy = JSON.parse(JSON.stringify(prev)) as Pattern; if (selectedTrack === 'sampler') { copy.sampler[activeSamplerBank].steps[step] = { note, velocity: 1, length: 1 }; updateStorageForTrack('sampler', copy.sampler); } else { copy[selectedTrack].steps[step] = { note, velocity: 1, length: 1 }; updateStorageForTrack(selectedTrack, copy[selectedTrack]); } return copy; }); }
    }, [audioEngine, selectedTrack, isRecording, isPlaying, updateStorageForTrack, activeSamplerBank]);

    const handleKeyboardStop = useCallback((note: string) => { if (!audioEngine) return; const id = activeKeyboardNotesRef.current.get(note); if (!id) return; if (selectedTrack === 'partA' || selectedTrack === 'partB' || selectedTrack === 'bass2') { audioEngine.noteOffSynth?.(id); } else if (selectedTrack === 'sampler') { audioEngine.noteOffSampler?.(id); } activeKeyboardNotesRef.current.delete(note); }, [audioEngine, selectedTrack]);
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
        // Stop Drawing
        if (isDrawing) { setIsDrawing(false); setDrawMode(null); }

        if (!isNoteDragging || !noteDragRef.current) return;
        if (!noteDragRef.current.hasMoved) { const { track, step } = noteDragRef.current; setContextMenu({ x: e.clientX, y: e.clientY, track, step }); }
        else if (noteDragRef.current.pendingSequence) { updateStorageForTrack(noteDragRef.current.track, noteDragRef.current.pendingSequence); }
        setIsNoteDragging(false); noteDragRef.current = null; document.body.style.cursor = 'default';
    }, [isNoteDragging, updateStorageForTrack, isDrawing]);

    useEffect(() => {
        // Add global listener for pointer up to catch drags that end outside
        window.addEventListener('pointerup', handleGlobalMouseUp as any);
        if (isNoteDragging) { window.addEventListener('mousemove', handleGlobalMouseMove); window.addEventListener('mouseup', handleGlobalMouseUp); }
        return () => {
            window.removeEventListener('pointerup', handleGlobalMouseUp as any);
            window.removeEventListener('mousemove', handleGlobalMouseMove); window.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, [isNoteDragging, handleGlobalMouseMove, handleGlobalMouseUp]);

    const handleDrawEnter = useCallback((trackKey: TrackKey, stepIndex: number) => {
        if (!isDrawing || !drawMode) return;

        const pattern = patternRef.current;
        let step = null;
        if (trackKey === 'sampler') {
            step = pattern.sampler[activeSamplerBankRef.current].steps[stepIndex];
        } else {
            step = pattern[trackKey].steps[stepIndex];
        }

        const isActive = !!step;

        if (drawMode === 'add' && !isActive) {
            handlePatternChange(trackKey, stepIndex, undefined);
        } else if (drawMode === 'remove' && isActive) {
            handlePatternChange(trackKey, stepIndex, undefined);
        }
    }, [isDrawing, drawMode, handlePatternChange, activeSamplerBank]);

    // Selection Keyboard/Mouse Handler
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            // Clipboard
            if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
                e.preventDefault();
                handleCopy();
            }
            if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
                e.preventDefault();
                handlePaste();
            }

            if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
                const { trackKey, startStep, endStep } = selection;
                const low = Math.min(startStep, endStep);
                const high = Math.max(startStep, endStep);
                setPattern(prev => {
                    const copy = JSON.parse(JSON.stringify(prev));
                    let changedSequence;
                    if (trackKey === 'sampler') {
                        const bankIdx = activeSamplerBankRef.current;
                        const bank = copy.sampler[bankIdx];
                        for (let i = low; i <= high; i++) { bank.steps[i] = null; }
                        changedSequence = copy.sampler;
                    } else {
                        const track = copy[trackKey] as any;
                        for (let i = low; i <= high; i++) { track.steps[i] = null; }
                        changedSequence = track;
                    }
                    updateStorageForTrack(trackKey, changedSequence);
                    return copy;
                });
                setSelection(null);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('mouseup', handleSelectionEnd);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('mouseup', handleSelectionEnd);
        };
    }, [selection, handleSelectionEnd, updateStorageForTrack, handleCopy, handlePaste]);

    const handleNoteSelect = (note: string) => {
        if (!contextMenu) return;
        const prev = patternRef.current;
        const copy = JSON.parse(JSON.stringify(prev)) as Pattern;
        let changedSequence;
        let trackKey: TrackKey;
        if (contextMenu.track === 'sampler') {
            trackKey = 'sampler';
            const stepData = copy.sampler[activeSamplerBank].steps[contextMenu.step];
            if (stepData) stepData.note = note;
            changedSequence = copy.sampler;
        } else {
            trackKey = contextMenu.track;
            const stepData = copy[trackKey].steps[contextMenu.step];
            if (stepData) stepData.note = note;
            changedSequence = copy[trackKey];
        }
        setPattern(copy);
        updateStorageForTrack(trackKey, changedSequence);
        setContextMenu(null);
    };

    const handleNoteLengthChange = (newLength: number) => {
        if (!contextMenu) return;
        const prev = patternRef.current;
        const copy = JSON.parse(JSON.stringify(prev)) as Pattern;
        const trackKey = contextMenu.track;
        const stepIndex = contextMenu.step;
        const isSampler = trackKey === 'sampler';
        let stepsArray;
        if (isSampler) { stepsArray = copy.sampler[activeSamplerBank].steps; } else { stepsArray = (copy[trackKey] as any).steps; }
        const stepData = stepsArray[stepIndex];
        if (stepData) {
            stepData.length = newLength;
            for (let i = 1; i < newLength; i++) { const nextStepIdx = stepIndex + i; if (nextStepIdx < stepsArray.length) { stepsArray[nextStepIdx] = null; } }
        }
        let changedSequence;
        if (isSampler) { changedSequence = copy.sampler; } else { changedSequence = copy[trackKey]; }
        setPattern(copy);
        updateStorageForTrack(trackKey, changedSequence);
    };

    const handleNotePropertyChange = (key: 'timbre' | 'velocity' | 'probability' | 'microtiming' | 'reverse' | 'retrigger' | 'freeze' | 'filterCutoff' | 'filterResonance' | 'envMod' | 'formantLfoRate' | 'formantLfoDepth' | 'vibratoDepth' | 'drive' | 'characterMorph' | 'reverbSend', value: number | boolean) => {
        if (!contextMenu) return;
        const prev = patternRef.current;
        const copy = JSON.parse(JSON.stringify(prev)) as Pattern;
        const trackKey = contextMenu.track;
        const stepIndex = contextMenu.step;
        const isSampler = trackKey === 'sampler';

        let stepsArray;
        if (isSampler) {
            stepsArray = copy.sampler[activeSamplerBank].steps;
        } else {
            stepsArray = (copy[trackKey] as any).steps;
        }

        const stepData = stepsArray[stepIndex];
        if (stepData) {
            if (key === 'reverse') {
                if (typeof value === 'boolean') stepData.reverse = value;
            } else {
                if (typeof value === 'number') stepData[key] = value;
            }
        }

        let changedSequence;
        if (isSampler) { changedSequence = copy.sampler; } else { changedSequence = copy[trackKey]; }
        setPattern(copy);
        updateStorageForTrack(trackKey, changedSequence);
    };

    const handleClearPattern = () => { if (window.confirm("Clear current pattern?")) { const emptyPattern: Pattern = { partA: { steps: Array(32).fill(null) }, partB: { steps: Array(32).fill(null) }, bass2: { steps: Array(32).fill(null) }, kick: { steps: Array(32).fill(null) }, snare: { steps: Array(32).fill(null) }, closedHat: { steps: Array(32).fill(null) }, openHat: { steps: Array(32).fill(null) }, sampler: Array.from({ length: 8 }, () => ({ steps: Array(32).fill(null) })), }; setPattern(emptyPattern); setTrackStorage(prevStorage => { const storageCopy = { ...prevStorage }; (Object.keys(storageCopy) as TrackKey[]).forEach(key => { storageCopy[key] = [...storageCopy[key]]; storageCopy[key][activeTrackSlots[key]] = emptyPattern[key]; }); return storageCopy; }); } };
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

    // Song persistence / file I/O (extracted to useSongStorage hook)
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
            const next = [...prev]; const currentBank = next[activeSamplerBank]; // @ts-ignore
            next[activeSamplerBank] = { ...currentBank, [id]: realVal }; return next;
        });
    }, [activeSamplerBank]);

    // Stable handler for SamplerPanel to avoid re-renders
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

            // Reuse handleLoadSample to update state and engine
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

            // clear existing
            newKick.steps = Array(32).fill(null);
            newSnare.steps = Array(32).fill(null);
            newCH.steps = Array(32).fill(null);
            newOH.steps = Array(32).fill(null);

            // Calculate step duration
            const stepTime = 60 / tempoRef.current / 4;

            alignment.phonemes.forEach((p, idx) => {
                const stepIdx = Math.round(p.start / stepTime);
                if (stepIdx >= 0 && stepIdx < 32) {
                    const ph = p.phoneme.toUpperCase().replace(/[0-9]/g, '');

                    const isVowel = ['AA','AE','AH','AO','AW','AY','EH','ER','EY','IH','IY','OW','OY','UH','UW'].includes(ph);
                    const isSnare = ['B','D','G','CH','JH','K','P','T'].includes(ph);
                    const isHat = ['F','S','SH','TH','V','Z','ZH'].includes(ph);
                    const isOpenHat = ['SH','ZH','S','F'].includes(ph) && p.end - p.start > 0.15; // Longer noisy phonemes

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

            // Update phrases state
            const newPhrases = [...ttsPhrases];
            newPhrases[activeSamplerBankRef.current] = text;
            setTtsPhrases(newPhrases);

            // Global Lyric Track Distribution: Map to all active steps in the current bank
            const prev = patternRef.current;
            const copy = JSON.parse(JSON.stringify(prev)) as Pattern;
            const bankIdx = activeSamplerBankRef.current;
            const bank = copy.sampler[bankIdx];

            let noteIndex = 0;
            // Iterate through all 32 steps
            for (let i = 0; i < 32; i++) {
                // If there's an active step (note exists and velocity > 0)
                if (bank.steps[i] && bank.steps[i]!.velocity > 0) {
                     bank.steps[i]!.sliceIndex = noteIndex;
                     noteIndex++;
                }
            }

            setPattern(copy);
            updateStorageForTrack('sampler', copy.sampler);

            // Update Sampler Params to enable slice mode
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
    const samplerChild = useMemo(() => (<div className="absolute top-2 left-[25%] w-[50%] max-h-[280px] h-auto pointer-events-auto z-10 bg-gray-900/90 rounded-lg border border-purple-500/30 backdrop-blur-sm overflow-hidden"><SamplerPanel params={sampler} onChange={(u) => updateSampler(u)} onParamChange={handleSamplerParamChange} onLoadSample={handleLoadSample} audioContext={audioEngine?.context!} audioEngine={audioEngine || undefined} activeBankIdx={activeSamplerBank} onBankChange={setActiveSamplerBank} onOpenEditor={() => setIsVoiceEditorOpen(true)} ttsPhrases={ttsPhrases} onTtsPhraseChange={handleTtsPhraseChange} onGenerateTTS={handleGenerateTTS} loadedBanks={loadedBanks} sampleBuffer={sampleBuffers[activeSamplerBank]} sliceHighlightRef={sliceHighlightRef} melodicMode={melodicMode} onMelodicModeChange={setMelodicMode} multisampleReady={multisampleReady} multisampleProcessing={multisampleProcessing} /></div>), [sampler, updateSampler, handleSamplerParamChange, audioEngine, setIsVoiceEditorOpen, activeSamplerBank, handleLoadSample, ttsPhrases, handleGenerateTTS, loadedBanks, sampleBuffers, melodicMode, multisampleReady, multisampleProcessing]);

    // --- RENDER PARTS FOR 3D ---
    // Extract parts so they can be passed to either normal view or 3D view

    // PERFORMANCE: Memoize main UI sections to prevent unnecessary VDOM regeneration
    // when unrelated state updates (e.g. playing a sequence vs editing a pattern).
    
    // === NEW SLIM TOP TRANSPORT TOOLBAR ===
    const transportToolbarNode = useMemo(() => (
        <header className="h-12 flex items-center justify-between px-4 bg-gradient-to-r from-[#0b0d10] via-[#0d1014] to-[#0b0d10] border-b border-cyan-900/40 shadow-[0_4px_20px_rgba(0,0,0,0.5)] shrink-0 relative backdrop-blur-md w-full z-30">
            {/* Left: Logo + Song Tabs */}
            <div className="flex items-center gap-4">
                <h1 className="text-lg font-bold font-orbitron text-cyan-400 tracking-widest hidden md:block drop-shadow-[0_0_8px_rgba(6,182,212,0.6)]">HYPHON</h1>
                
                {/* Song Slots */}
                <div className="flex items-center gap-1 bg-zinc-950/80 p-1.5 rounded-lg border border-cyan-500/20 shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]">
                    <span className="text-[9px] text-gray-600 font-mono uppercase px-1 mr-1">SONG</span>
                    {[0, 1, 2, 3].map(slot => {
                        const isSaved = !!songStorage[slot];
                        const isActive = activeSongSlot === slot;
                        return (
                            <button 
                                key={slot} 
                                onClick={() => { if (isSaved) loadSong(slot); else handleSaveSong(slot); }} 
                                onContextMenu={(e) => { e.preventDefault(); handleSaveSong(slot); }} 
                                className={`w-7 h-6 text-xs font-mono rounded transition-all ${isActive 
                                    ? 'bg-cyan-500 text-black font-bold shadow-[0_0_10px_rgba(6,182,212,0.6)]' 
                                    : (isSaved 
                                        ? 'bg-cyan-900/40 text-cyan-300 border border-cyan-700/50 hover:bg-cyan-800/50' 
                                        : 'bg-zinc-900 text-zinc-600 border border-zinc-800 hover:border-zinc-700')}`} 
                                aria-label={`Song Slot ${slot + 1}`} 
                                aria-pressed={isActive}
                            >
                                {slot + 1}
                            </button>
                        );
                    })}
                </div>

                {/* Cloud Status */}
                <div className="flex items-center gap-2">
                    <CloudStatus />
                </div>
            </div>

            {/* Center: Transport Controls */}
            <div className="flex items-center gap-3">
                {/* Play/Stop Button */}
                <button
                    onClick={handlePlayToggle}
                    aria-pressed={isPlaying}
                    aria-label={isPlaying ? "Stop Playback" : "Start Playback"}
                    title={isPlaying ? "Stop Playback (Space)" : "Start Playback (Space)"}
                    className={`h-8 px-5 rounded-md font-orbitron text-sm font-bold tracking-wider transition-all shadow-lg ${isPlaying 
                        ? 'bg-red-600 hover:bg-red-500 text-white shadow-[0_0_15px_rgba(220,38,38,0.5)] border border-red-400' 
                        : 'bg-green-600 hover:bg-green-500 text-white shadow-[0_0_15px_rgba(22,163,74,0.4)] border border-green-400'}`}
                >
                    {isPlaying ? '■ STOP' : '▶ PLAY'}
                </button>

                {/* Record Button */}
                <button 
                    onClick={() => setIsRecording(!isRecording)} 
                    aria-pressed={isRecording} 
                    aria-label="Toggle Recording" 
                    className={`h-8 w-10 rounded-md font-orbitron text-xs font-bold tracking-wide transition-all ${isRecording 
                        ? 'bg-red-600 text-white animate-pulse shadow-[0_0_15px_rgba(220,38,38,0.6)] border border-red-400' 
                        : 'bg-zinc-800 hover:bg-zinc-700 text-red-500 border border-zinc-700 hover:border-red-900/50'}`}
                >
                    REC
                </button>

                {/* Divider */}
                <div className="w-px h-5 bg-gray-700 mx-1" />

                {/* BPM Control */}
                <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-gray-500 font-mono uppercase tracking-wider">BPM</span>
                    <div className="flex items-center bg-zinc-950 rounded-md border border-zinc-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]">
                        <button
                            onMouseDown={() => handleTempoHoldStart(-1)}
                            onMouseUp={handleTempoHoldEnd}
                            onMouseLeave={handleTempoHoldEnd}
                            onKeyDown={(e) => handleTempoKeyDown(e, -1)}
                            className="w-6 h-7 text-cyan-500 hover:text-cyan-400 font-bold text-sm border-r border-zinc-800 focus:outline-none hover:bg-zinc-900/50 transition-colors"
                            aria-label="Decrease Tempo"
                        >
                            −
                        </button>
                        <span 
                            className="w-12 text-center font-mono text-cyan-300 text-sm font-semibold" 
                            role="status" 
                            aria-live="polite" 
                            aria-label={`Tempo: ${tempo} BPM`}
                        >
                            {tempo}
                        </span>
                        <button
                            onMouseDown={() => handleTempoHoldStart(1)}
                            onMouseUp={handleTempoHoldEnd}
                            onMouseLeave={handleTempoHoldEnd}
                            onKeyDown={(e) => handleTempoKeyDown(e, 1)}
                            className="w-6 h-7 text-cyan-500 hover:text-cyan-400 font-bold text-sm border-l border-zinc-800 focus:outline-none hover:bg-zinc-900/50 transition-colors"
                            aria-label="Increase Tempo"
                        >
                            +
                        </button>
                    </div>
                </div>
            </div>

            {/* Right: Utility Buttons */}
            <div className="flex items-center gap-2">
                {/* Clear Button */}
                <button 
                    onClick={handleClearPattern} 
                    className="h-7 px-3 text-xs font-bold text-red-400 border border-red-900/50 bg-gradient-to-r from-red-950/30 to-red-900/20 rounded-md hover:bg-red-900/30 transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-red-500" 
                    aria-label="Clear Current Pattern" 
                    title="Clear Current Pattern"
                >
                    CLEAR
                </button>

                {/* Divider */}
                <div className="w-px h-5 bg-gray-700 mx-1" />

                {/* Song Mode Toggle */}
                <button 
                    onClick={() => setIsSongModeOpen(!isSongModeOpen)} 
                    aria-pressed={isSongModeOpen} 
                    aria-label="Toggle Song Mode" 
                    className={`h-7 px-3 rounded-md font-orbitron text-xs font-bold tracking-wide transition-all ${isSongModeOpen 
                        ? 'bg-purple-600 text-white shadow-[0_0_10px_rgba(147,51,234,0.5)] border border-purple-400' 
                        : 'bg-zinc-800 text-gray-400 border border-zinc-700 hover:bg-zinc-700 hover:text-gray-300'}`}
                >
                    SONG
                </button>

                {/* 3D Toggle */}
                <button
                    onClick={() => setIs3DMode(!is3DMode)}
                    aria-pressed={is3DMode}
                    aria-label="Toggle 3D Studio View"
                    className={`h-7 w-8 rounded-md font-orbitron text-xs font-bold transition-all ${is3DMode 
                        ? 'bg-cyan-600 text-white border border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.5)]' 
                        : 'bg-zinc-800 text-cyan-500 border border-zinc-700 hover:bg-zinc-700'}`}
                >
                    3D
                </button>

                {/* Panic Button */}
                <button 
                    onClick={handlePanic} 
                    aria-label="Panic Stop All Notes" 
                    className="h-7 w-7 rounded-md bg-red-950/50 hover:bg-red-900/70 text-red-500 border border-red-900/50 flex items-center justify-center font-bold text-xs transition-all"
                    title="Panic (!)"
                >
                    !
                </button>
            </div>
        </header>
    ), [songStorage, activeSongSlot, tempo, isRecording, isPlaying, isSongModeOpen, is3DMode, loadSong, handleSaveSong, handleClearPattern, handleTempoHoldStart, handleTempoHoldEnd, handleTempoKeyDown, handlePanic, handlePlayToggle, setIsRecording, setIsSongModeOpen, setIs3DMode]);

    const sequencerNode = useMemo(() => {
        if (isSongModeOpen && is3DMode) {
            return (
                <div className="w-full h-[480px] p-4 bg-[#0a0d10] rounded-xl border-2 border-gray-700 shadow-2xl relative overflow-hidden">
                    <div className="absolute inset-0 rounded-xl border-2 border-cyan-900/10 pointer-events-none z-50"></div>
                    <SongMode
                        isVisible={true}
                        is3D={true}
                        songStructure={songStructure}
                        currentSongStep={currentSongMeasure}
                        backgroundImage={backgroundImage}
                        onSetBackgroundImage={setBackgroundImage}
                        onToggle={handleSongModeToggle}
                        onUpdateStep={handleSongStructureUpdate}
                        onAddMeasure={handleAddMeasure}
                        onRemoveMeasure={handleRemoveMeasure}
                        onExportXM={handleExportXM}
                        isSongModeActive={isSongModeActive}
                        onSetIsSongModeActive={setIsSongModeActive}
                    />
                </div>
            );
        }
        return (
            <MainSequencer
                ref={sequencerRef}
                pattern={pattern}
                activeSamplerBank={activeSamplerBank}
                selectedTrack={selectedTrack}
                activeTrackSlots={activeTrackSlots}
                trackStorage={trackStorage}
                selection={selection}
                isDrawing={isDrawing}
                onToggle={handleStepToggle}
                onRightMouseDown={handleRightMouseDown}
                onEditLength={handleEditLength}
                onSelectRow={handleSelectRow}
                onSelectSlot={handleTrackSlotClick}
                onSelectionStart={handleSelectionStart}
                onSelectionEnter={handleSelectionEnter}
                onDrawEnter={handleDrawEnter}
                viewMode={viewMode}
                automationParam={automationParam}
                onAutomationChange={handleAutomationChange}
                alignment={activeAlignment}
                melodicMode={melodicMode}
                onPitchChange={handlePitchChange}
                onPhonemeUpdate={handlePhonemeUpdate}
                samplerAudioBuffer={sampleBuffers[activeSamplerBank]}
            >
                {contextMenu && (
                    <div style={{ position: 'fixed', top: 0, left: 0, zIndex: 9999 }}>
                        <NoteSelector
                            x={contextMenu.x} y={contextMenu.y} trackType={(contextMenu.track.startsWith('part') || contextMenu.track === 'sampler') ? 'synth' : 'drum'}
                            currentNote={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.note ?? '' : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.note ?? ''}
                            currentLength={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.length ?? 1 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.length ?? 1}
                            currentTimbre={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.timbre ?? 0 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.timbre ?? 0}
                            currentVelocity={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.velocity ?? 1 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.velocity ?? 1}
                            currentProbability={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.probability ?? 1 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.probability ?? 1}
                            currentMicrotiming={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.microtiming ?? 0 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.microtiming ?? 0}
                            currentRetrigger={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.retrigger ?? 1 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.retrigger ?? 1}
                            currentReverse={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.reverse ?? false : false}
                            currentFreeze={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.freeze ?? 0 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.freeze ?? 0}
                            currentFilterCutoff={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.filterCutoff : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.filterCutoff}
                            currentFilterResonance={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.filterResonance : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.filterResonance}
                            currentEnvMod={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.envMod : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.envMod}
                            currentFormantLfoRate={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.formantLfoRate ?? 0 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.formantLfoRate ?? 0}
                            currentFormantLfoDepth={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.formantLfoDepth ?? 0 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.formantLfoDepth ?? 0}
                            currentVibratoDepth={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.vibratoDepth ?? 0 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.vibratoDepth ?? 0}
                            currentDrive={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.drive : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.drive}
                            currentCharacterMorph={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.characterMorph : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.characterMorph}
                            currentReverbSend={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.reverbSend : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.reverbSend}
                            onSelect={handleNoteSelect}
                            onLengthChange={handleNoteLengthChange}
                            onPropertyChange={handleNotePropertyChange}
                            onClose={() => setContextMenu(null)}
                            getNoteColor={getNoteColor}
                        />
                    </div>
                )}
            </MainSequencer>
        );
    }, [isSongModeOpen, is3DMode, songStructure, currentSongMeasure, backgroundImage, isSongModeActive, pattern, activeSamplerBank, selectedTrack, activeTrackSlots, trackStorage, contextMenu, selection, handleSongModeToggle, handleSongStructureUpdate, handleAddMeasure, handleRemoveMeasure, handleExportXM, setIsSongModeActive, setBackgroundImage, handleStepToggle, handleRightMouseDown, handleEditLength, handleSelectRow, handleTrackSlotClick, handleNoteSelect, handleNoteLengthChange, handleSelectionStart, handleSelectionEnter]);

    const keyboardNode = useMemo(() => (
        <div className="w-full bg-[#0d1015] border-2 border-gray-700/50 rounded-xl overflow-hidden shadow-2xl p-2">
            <LiveKeyboard onPlayNote={handleKeyboardPlay} onStopNote={handleKeyboardStop} activeTrackColor={selectedTrack.startsWith('part') ? (selectedTrack === 'partA' ? '#06b6d4' : '#d946ef') : selectedTrack === 'bass2' ? '#ff0066' : selectedTrack === 'kick' ? '#f97316' : selectedTrack === 'snare' ? '#22c55e' : selectedTrack === 'sampler' ? '#a855f7' : '#eab308'} />
        </div>
    ), [selectedTrack, handleKeyboardPlay, handleKeyboardStop]);

    const rackNode = useMemo(() => {
        // PERFORMANCE: Inline conditional rendering to avoid dependency on unstable function reference.
        // This ensures the Rack only re-renders when relevant props/state change.
        let modulePanel = null;
        if (selectedTrack === 'partA') modulePanel = <HardwareModule title="SYNTH A // LEAD" colorHex={COLOR_LEAD} controls={synthAControls} onParamChange={onSynthAParamChange} is3D={is3DMode}>{synthAChild}</HardwareModule>;
        else if (selectedTrack === 'partB') modulePanel = <HardwareModule title="SYNTH B // BASS" colorHex={COLOR_BASS} controls={synthBControls} onParamChange={onSynthBParamChange} is3D={is3DMode}>{synthBChild}</HardwareModule>;
        else if (selectedTrack === 'bass2') modulePanel = <HardwareModule title="BASS 2 // TB-303" colorHex={COLOR_BASS2} controls={bass2Controls} onParamChange={onBass2ParamChange} is3D={is3DMode}>{bass2Child}</HardwareModule>;
        else if (selectedTrack === 'kick') modulePanel = <HardwareModule title="KICK DRUM" colorHex={COLOR_KICK} controls={kickControls} onParamChange={handleKickChange} is3D={is3DMode} />;
        else if (selectedTrack === 'snare') modulePanel = <HardwareModule title="SNARE DRUM" colorHex={COLOR_SNARE} controls={snareControls} onParamChange={handleSnareChange} is3D={is3DMode} />;
        else if (selectedTrack === 'closedHat') modulePanel = <HardwareModule title="CLOSED HAT" colorHex={COLOR_CH} controls={closedHatControls} onParamChange={handleClosedHatChange} is3D={is3DMode} />;
        else if (selectedTrack === 'openHat') modulePanel = <HardwareModule title="OPEN HAT" colorHex={COLOR_OH} controls={openHatControls} onParamChange={handleOpenHatChange} is3D={is3DMode} />;
        else if (selectedTrack === 'sampler') { 
            modulePanel = (
                <SamplerVoicePanel 
                    title={`SAMPLER // BANK ${activeSamplerBank + 1}`} 
                    colorHex={COLOR_SAMPLER} 
                    controls={samplerControls} 
                    onParamChange={handleSamplerChange}
                    is3D={is3DMode}
                    {...samplerVoiceParams}
                    onSamplerParamChange={handleSamplerVoiceChange}
                    harmonizerConfig={harmonizerConfig}
                    onHarmonizerConfigChange={handleHarmonizerConfigChange}
                    isHarmonizeActive={isHarmonizeActive}
                >
                    {samplerChild}
                </SamplerVoicePanel>
            ); 
        }

        return (
            <div className="w-full h-full bg-gradient-to-br from-black to-[#0a0c0f] rounded-2xl border-2 border-gray-700 overflow-hidden relative flex flex-col">
                <div className="absolute inset-0 rounded-2xl border-2 border-cyan-900/10 pointer-events-none"></div>

                {is3DMode && (
                    <div className="flex items-center justify-center gap-2 p-2 bg-[#050709] border-b border-gray-800 shrink-0 z-50 relative pointer-events-auto">
                        {ROWS.map((row: any) => (
                            <button
                                key={row.key}
                                onClick={() => setSelectedTrack(row.key as any)}
                                className={`px-4 py-2 rounded text-xs font-bold font-orbitron border transition-all ${selectedTrack === row.key ? 'bg-cyan-900/50 text-cyan-400 border-cyan-500 shadow-[0_0_10px_cyan]' : 'bg-gray-800 text-gray-500 border-gray-700 hover:bg-gray-700 hover:text-gray-300'}`}
                            >
                                {row.label.toUpperCase()}
                            </button>
                        ))}
                    </div>
                )}

                <div className="flex-1 relative overflow-hidden">
                    {modulePanel}
                </div>
            </div>
        );
    }, [is3DMode, selectedTrack, activeSamplerBank, synthAControls, synthBControls, bass2Controls, kickControls, snareControls, closedHatControls, openHatControls, samplerControls, onSynthAParamChange, onSynthBParamChange, onBass2ParamChange, handleKickChange, handleSnareChange, handleClosedHatChange, handleOpenHatChange, handleSamplerChange, synthAChild, synthBChild, bass2Child, samplerChild, samplerVoiceParams, handleSamplerVoiceChange, harmonizerConfig, isHarmonizeActive, handleHarmonizerConfigChange]);

    // --- MAIN RENDER ---
    if (is3DMode) {
        return (
            <Suspense fallback={<div className="flex items-center justify-center h-screen w-screen bg-black text-cyan-400 font-orbitron text-xl tracking-widest animate-pulse">LOADING 3D STUDIO...</div>}>
                <Studio3D
                    header={transportToolbarNode}
                    sequencer={sequencerNode}
                    keyboard={keyboardNode}
                    rack={rackNode}
                    onExit={() => setIs3DMode(false)}
                />
            </Suspense>
        );
    }

    return (
        <div className="flex flex-col h-screen w-screen bg-gradient-to-br from-[#050709] via-[#080a0b] to-[#0a0c0f] text-gray-200 overflow-hidden font-sans relative bg-cover bg-center" style={{ backgroundImage: backgroundImage ? `url(${backgroundImage})` : undefined }}>
            <style>{SEQUENCER_STYLES}</style>
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
            {backgroundImage && <div className="absolute inset-0 bg-black/60 pointer-events-none z-0"></div>}
            {!hasStarted && <StartOverlay onStart={handleStart} isReady={isPyodideReady} />}
            
            {/* AI Song Import Loading Overlay */}
            {isImportingAISong && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="AI Song Import Progress">
                    <div className="bg-[#0f1115] border border-emerald-500/30 rounded-xl shadow-[0_0_60px_rgba(16,185,129,0.3)] p-8 max-w-md w-full mx-4">
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                                {aiImportStage === 'error' ? (
                                    <span className="text-2xl text-red-400">⚠️</span>
                                ) : aiImportStage === 'complete' ? (
                                    <span className="text-2xl text-emerald-400">✓</span>
                                ) : (
                                    <span className="text-2xl animate-pulse">🤖</span>
                                )}
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">
                                    {aiImportStage === 'error' ? 'Import Failed' : 
                                     aiImportStage === 'complete' ? 'Import Complete' : 
                                     'Importing AI Song'}
                                </h3>
                                <p className="text-sm text-gray-400">
                                    {aiImportStage === 'parsing' && 'Parsing JSON...'}
                                    {aiImportStage === 'validating' && 'Validating song structure...'}
                                    {aiImportStage === 'converting' && 'Converting to Hyphon format...'}
                                    {aiImportStage === 'uploading' && 'Uploading to cloud...'}
                                    {aiImportStage === 'loading' && 'Loading into sequencer...'}
                                    {aiImportStage === 'complete' && 'Successfully imported!'}
                                    {aiImportStage === 'error' && aiImportError || 'Processing...'}
                                </p>
                            </div>
                        </div>
                        
                        {/* Progress Bar */}
                        <div className="relative h-2 bg-gray-800 rounded-full overflow-hidden">
                            <div 
                                className={`absolute top-0 left-0 h-full rounded-full transition-all duration-300 ${
                                    aiImportStage === 'error' ? 'bg-red-500' :
                                    aiImportStage === 'complete' ? 'bg-emerald-500' :
                                    'bg-gradient-to-r from-emerald-500 to-cyan-500'
                                }`}
                                style={{ width: `${aiImportProgress}%` }}
                            />
                            {/* Animated shimmer effect during processing */}
                            {aiImportStage !== 'error' && aiImportStage !== 'complete' && (
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" 
                                     style={{ 
                                         animation: 'shimmer 1.5s infinite',
                                         backgroundSize: '200% 100%'
                                     }} 
                                />
                            )}
                        </div>
                        
                        {/* Progress Steps */}
                        <div className="mt-4 grid grid-cols-5 gap-1">
                            {['parsing', 'validating', 'converting', 'uploading', 'loading'].map((stage, idx) => {
                                const stageOrder = ['parsing', 'validating', 'converting', 'uploading', 'loading'];
                                const currentIdx = aiImportStage ? stageOrder.indexOf(aiImportStage) : -1;
                                const isComplete = currentIdx > idx;
                                const isActive = aiImportStage === stage;
                                
                                return (
                                    <div 
                                        key={stage}
                                        className={`h-1 rounded-full transition-all duration-300 ${
                                            isComplete ? 'bg-emerald-500' :
                                            isActive ? 'bg-yellow-400 animate-pulse' :
                                            'bg-gray-800'
                                        }`}
                                    />
                                );
                            })}
                        </div>
                        
                        {/* Stage Labels */}
                        <div className="mt-4 flex justify-between text-[10px] text-gray-500 uppercase tracking-wider">
                            <span className={aiImportStage === 'parsing' ? 'text-emerald-400' : ''}>Parse</span>
                            <span className={aiImportStage === 'validating' ? 'text-emerald-400' : ''}>Validate</span>
                            <span className={aiImportStage === 'converting' ? 'text-emerald-400' : ''}>Convert</span>
                            <span className={aiImportStage === 'uploading' ? 'text-emerald-400' : ''}>Cloud</span>
                            <span className={aiImportStage === 'loading' ? 'text-emerald-400' : ''}>Load</span>
                        </div>
                        
                        {/* Error Message */}
                        {aiImportError && (
                            <div className="mt-4 p-3 bg-red-950/30 border border-red-900/50 rounded-lg">
                                <p className="text-xs text-red-400">{aiImportError}</p>
                            </div>
                        )}
                        
                        {/* Cancel Button (only during non-critical stages) */}
                        {aiImportStage && !['complete', 'error', 'loading'].includes(aiImportStage) && (
                            <button
                                onClick={() => {
                                    setIsImportingAISong(false);
                                    setAiImportStage(null);
                                    setAiImportProgress(0);
                                    // @ts-expect-error - Auto-generated to fix CI build
                                    showToast('Import cancelled', 'info');
                                }}
                                className="mt-4 w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-400 text-xs rounded transition-all"
                            >
                                Cancel Import
                            </button>
                        )}
                    </div>
                </div>
            )}
            
            <CloudLibrary isOpen={isCloudLibraryOpen} onClose={() => setIsCloudLibraryOpen(false)} onLoadData={loadCloudData} onShowToast={showToast} getSongData={getSongData} getBankData={getBankData} getPatternData={getPatternData} />
            {/* @ts-expect-error - Auto-generated to fix CI build */}
            <AISongModal isOpen={isAISongModalOpen} onClose={() => setIsAISongModalOpen(false)} onImport={handleAISongImport} onShowToast={showToast} isImporting={isImportingAISong} />
            {/* @ts-expect-error - Auto-generated to fix CI build */}
            <RbsImportModal isOpen={isRbsImportModalOpen} onClose={() => setIsRbsImportModalOpen(false)} onImport={handleRbsImport} onShowToast={showToast} />
            {isVoiceEditorOpen && (<VoiceEditor onClose={() => setIsVoiceEditorOpen(false)} />)}
            {isShortcutsHelpOpen && (<ShortcutsHelp onClose={() => setIsShortcutsHelpOpen(false)} />)}
            {showGamepadDebug && (<GamepadDebugger onClose={() => setShowGamepadDebug(false)} />)}

            {/* Standard 2D Layout */}
            {transportToolbarNode}
            <SongMode isVisible={isSongModeOpen} songStructure={songStructure} currentSongStep={currentSongMeasure} backgroundImage={backgroundImage} onSetBackgroundImage={setBackgroundImage} onToggle={handleSongModeToggle} onUpdateStep={handleSongStructureUpdate} onAddMeasure={handleAddMeasure} onRemoveMeasure={handleRemoveMeasure} onExportXM={handleExportXM} isSongModeActive={isSongModeActive} onSetIsSongModeActive={setIsSongModeActive} />

            <LyricTrack
                isVisible={isLyricTrackVisible}
                initialText={ttsPhrases[activeSamplerBank] || ""}
                isGenerating={isGenerating}
                onApply={handleLyricApply}
                onClose={() => setIsLyricTrackVisible(false)}
            />

            <main className="flex-1 relative bg-gradient-to-b from-[#0a0e14] via-[#111827] to-[#050709] shadow-inner flex flex-col justify-start z-10 overflow-y-auto pb-12">
                {/* Sequencer — top section */}
                <div className="w-full max-w-[1000px] mx-auto h-[440px] shrink-0 pt-6">
                    {sequencerNode}
                </div>

                {/* Knobs / Hardware Module — PROMINENT middle section */}
                <div className="w-full max-w-[1000px] mx-auto shrink-0 mt-2 px-4">
                    <div className="h-[380px] rounded-xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.6)] border border-cyan-500/20">
                        {rackNode}
                    </div>
                </div>

                {/* Live Keyboard — bottom section */}
                <div className="shrink-0 py-4 mt-2 max-w-[1000px] mx-auto w-full px-4">
                    {keyboardNode}
                </div>
            </main>

            {/* Slim Bottom Control Bar */}
            <div className="fixed bottom-0 left-0 right-0 h-10 bg-gradient-to-r from-[#0a0c10] via-[#0d1014] to-[#0a0c10] backdrop-blur-md border-t border-cyan-900/30 z-40 flex items-center justify-between px-4 shadow-[0_-4px_20px_rgba(0,0,0,0.5)]">
                {/* Left: View Controls */}
                <div className="flex items-center gap-2">
                    {/* Notes/Automation Toggle */}
                    <div className="flex items-center bg-zinc-950 rounded-md border border-zinc-800 overflow-hidden">
                        <button
                            onClick={() => setViewMode('notes')}
                            className={`px-2.5 py-1 text-[10px] font-bold transition-all ${viewMode === 'notes' ? 'bg-cyan-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                        >
                            NOTES
                        </button>
                        <button
                            onClick={() => setViewMode('automation')}
                            className={`px-2.5 py-1 text-[10px] font-bold transition-all ${viewMode === 'automation' ? 'bg-pink-600 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                        >
                            AUTO
                        </button>
                    </div>

                    {viewMode === 'automation' && (
                        <select
                            value={automationParam}
                            onChange={(e) => setAutomationParam(e.target.value)}
                            className="bg-zinc-950 text-[10px] text-gray-300 border border-zinc-800 rounded px-1.5 py-1 outline-none focus:border-cyan-500"
                        >
                            <option value="formantShift">Formant</option>
                            <option value="vibratoDepth">Vibrato</option>
                            <option value="chordInversion">Chord Inversion</option>
                        </select>
                    )}

                    <div className="w-px h-4 bg-gray-700 mx-1" />

                    {/* LYRICS Button */}
                    <button 
                        onClick={() => setIsLyricTrackVisible(!isLyricTrackVisible)}
                        aria-pressed={isLyricTrackVisible}
                        aria-label="Toggle Global Lyric Track"
                        className={`h-6 px-2.5 rounded-md font-orbitron text-[10px] font-bold tracking-wide transition-all ${isLyricTrackVisible ? 'bg-cyan-600 text-white shadow-[0_0_8px_rgba(6,182,212,0.5)]' : 'bg-zinc-800 text-cyan-400 border border-zinc-700 hover:bg-zinc-700'}`}
                    >
                        LYRICS
                    </button>
                </div>

                {/* Center: File Operations */}
                <div className="flex items-center gap-1.5">
                    <button 
                        onClick={exportSongToFile} 
                        disabled={isImportingAISong}
                        className={`h-6 px-2 text-[10px] font-bold text-green-400 bg-zinc-900 border border-green-900/50 rounded transition-all ${isImportingAISong ? 'opacity-50 cursor-not-allowed' : 'hover:bg-green-950/30'}`} 
                        title="Save to JSON"
                    >
                        💾 SAVE
                    </button>
                    <button 
                        onClick={importSongFromFile} 
                        disabled={isImportingAISong}
                        className={`h-6 px-2 text-[10px] font-bold text-blue-400 bg-zinc-900 border border-blue-900/50 rounded transition-all ${isImportingAISong ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-950/30'}`} 
                        title="Load from JSON"
                    >
                        📂 LOAD
                    </button>
                    <button 
                        onClick={() => setIsRbsImportModalOpen(true)}
                        disabled={isImportingAISong}
                        className={`h-6 px-2 text-[10px] font-bold text-amber-400 bg-zinc-900 border border-amber-900/50 rounded transition-all ${isImportingAISong ? 'opacity-50 cursor-not-allowed' : 'hover:bg-amber-950/30'}`} 
                        title="Import ReBirth RB-338 file"
                    >
                        🎹 Import .rbs File...
                    </button>
                    <button 
                        onClick={() => !isImportingAISong && setIsAISongModalOpen(true)}
                        disabled={isImportingAISong}
                        className={`h-6 px-2 text-[10px] font-bold bg-zinc-900 border rounded transition-all min-w-[130px] ${
                            isImportingAISong 
                                ? 'text-yellow-400 border-yellow-900/50 cursor-wait' 
                                : 'text-emerald-400 border-emerald-900/50 hover:bg-emerald-950/30'
                        }`}
                        title={isImportingAISong 
                            ? `Importing: ${aiImportStage || 'processing'}... ${aiImportProgress}%` 
                            : "Import AI-generated song (Claude, Gemini, Jules, Copilot)"
                        }
                    >
                        {isImportingAISong ? (
                            <span className="flex items-center gap-1">
                                <span className="animate-spin">⏳</span>
                                <span>{aiImportStage === 'parsing' && 'Parsing...'}
                                {aiImportStage === 'validating' && 'Validating...'}
                                {aiImportStage === 'converting' && 'Converting...'}
                                {aiImportStage === 'uploading' && 'Uploading...'}
                                {aiImportStage === 'loading' && 'Loading...'}
                                {aiImportStage === 'complete' && 'Done!'}
                                {aiImportStage === 'error' && 'Failed'}
                                {!aiImportStage && 'Processing...'} {aiImportProgress}%</span>
                            </span>
                        ) : (
                            <span>🤖 Import AI Song</span>
                        )}
                    </button>
                    <button 
                        onClick={() => setIsCloudLibraryOpen(true)} 
                        disabled={isImportingAISong}
                        className={`h-6 px-2 text-[10px] font-bold text-purple-400 bg-zinc-900 border border-purple-900/50 rounded transition-all ${isImportingAISong ? 'opacity-50 cursor-not-allowed' : 'hover:bg-purple-950/30'}`} 
                        title="Cloud Library"
                    >
                        ☁️ CLOUD
                    </button>
                </div>

                {/* Right: Utility Toggles */}
                <div className="flex items-center gap-2">
                    <div className="flex flex-col items-center justify-center gap-1 min-w-[60px]">
                        <input
                            type="range" min="0" max="1" step="0.01"
                            value={masterSaturation} onChange={handleMasterSaturation} onKeyDown={handleMasterSaturationKeyDown} onDoubleClick={handleMasterSaturationReset}
                            className="w-16 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                            aria-label="Master Saturation"
                            title={`Warmth: ${Math.round(masterSaturation * 100)}%`}
                            aria-valuetext={`${Math.round(masterSaturation * 100)}%`}
                        />
                    </div>
                    <div className="flex flex-col items-center justify-center gap-1 min-w-[60px]">
                        <input
                            type="range" min="0" max="1.5" step="0.01"
                            value={masterVolume} onChange={handleMasterVolume} onKeyDown={handleMasterVolumeKeyDown} onDoubleClick={handleMasterVolumeReset}
                            className="w-16 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                            aria-label="Master Volume"
                            title={`Volume: ${Math.round(masterVolume * 100)}%`}
                            aria-valuetext={`${Math.round(masterVolume * 100)}%`}
                        />
                    </div>
                    <div className="flex flex-col items-center justify-center gap-1 min-w-[60px]">
                        <input
                            type="range" min="-1" max="1" step="0.01"
                            value={globalPan} onChange={handleGlobalPan} onKeyDown={handleGlobalPanKeyDown} onDoubleClick={handleGlobalPanReset}
                            className="w-16 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                            aria-label="Global Pan"
                            title={`Pan: ${globalPan === 0 ? 'Center' : globalPan < 0 ? Math.round(Math.abs(globalPan) * 100) + '% L' : Math.round(globalPan * 100) + '% R'}`}
                            aria-valuetext={`${globalPan === 0 ? 'Center' : globalPan < 0 ? Math.round(Math.abs(globalPan) * 100) + '% Left' : Math.round(globalPan * 100) + '% Right'}`}
                        />
                    </div>

                    <div className="w-px h-4 bg-gray-700 mx-1" />

                    {/* Gamepad Toggle */}
                    <button
                        onClick={() => setShowGamepadDebug(true)}
                        className="h-6 w-6 rounded bg-zinc-800 hover:bg-zinc-700 text-slate-400 hover:text-slate-200 transition-all border border-zinc-700 flex items-center justify-center"
                        title="Gamepad Debugger"
                        aria-label="Open Gamepad Debugger"
                    >
                        <span className="text-xs">🎮</span>
                    </button>

                    {/* AudioWorklet Fallback Toggle */}
                    <button
                        onClick={() => {
                            const newValue = !forceScriptProcessorFallback;
                            setForceScriptProcessorFallback(newValue);
                            localStorage.setItem('forceScriptProcessorFallback', String(newValue));
                            showToast(
                                newValue
                                    ? "ScriptProcessor fallback enabled. Refresh to apply." 
                                    : "AudioWorklet mode enabled. Refresh to apply.",
                                'success'
                            );
                        }}
                        className={`h-6 px-2 rounded text-[10px] font-mono border transition-all ${forceScriptProcessorFallback ? 'bg-yellow-900/30 text-yellow-400 border-yellow-900/50' : 'bg-zinc-800 text-gray-500 border-zinc-700'}`}
                        title={forceScriptProcessorFallback ? "Using ScriptProcessor fallback" : "Using AudioWorklet"}
                    >
                        {forceScriptProcessorFallback ? '⚠️ AW' : '🔊 AW'}
                    </button>

                    <div className="w-px h-4 bg-gray-700 mx-1" />

                    {/* Help Button */}
                    <button
                        onClick={() => setIsShortcutsHelpOpen(true)}
                        className="h-6 w-6 rounded-full bg-zinc-800 text-gray-400 hover:text-white hover:bg-zinc-700 border border-zinc-600 flex items-center justify-center font-bold text-xs transition-all"
                        aria-label="Keyboard Shortcuts"
                        title="Keyboard Shortcuts (?)"
                    >
                        ?
                    </button>
                </div>
            </div>
        </div>
    )
}

export default App
