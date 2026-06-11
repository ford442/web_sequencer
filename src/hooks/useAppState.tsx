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
import { exportSongToXM } from '../utils/xmExport'
import { noteToMidi, midiToNote } from '../utils/musicTheory'
import type { ScaleDefinition } from '../utils/musicTheory'
import { copySteps, pasteSteps } from '../utils/clipboardUtils'
import type { MainSequencerHandle } from '../components/MainSequencer'
import type { AlignmentResult } from '../engines/rubberband/PhonemeAligner'
import { type HarmonizerConfig } from '../engines/Harmonizer'
import { Engine303Selector } from '../components/Engine303Selector'
import { ProphecyPanel } from '../components/ProphecyPanel'
import { OscillatorTypeSelector } from '../components/OscillatorTypeSelector'
import { OscillatorVariantSelector } from '../components/OscillatorVariantSelector'
import { SamplerPanel } from '../components/SamplerPanel'
import { engineTelemetry } from '../utils/engineTelemetry'

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
    DEFAULT_DRUM_KIT,
    DEFAULT_SAMPLER_BANK_PARAMS,
    getKitDrumParams,
} from '../constants'
import type { Pattern, SynthParams, KickParams, SnareParams, SamplerParams, SamplerBankParams, PartSequence, Note, Bass2Params, PhonemeData, ReverbType, DrumKitType, AutomationTarget, ResolvedTrakEvent, OscillatorType } from '../types'
import { waveformToOscillatorType, getDefaultWaveformForType, getOscillatorPanelClasses, OSCILLATOR_THEMES } from '../types'
import {
    INITIAL_SAMPLER_PARAMS, UPDATED_INITIAL_PATTERN,
    type TrackKey, type SongSnapshot,
    getInitialTrackStorage,
} from '../constants/appDefaults'
import {
    getBass2Controls, getSynthControls, getKickControls, getSnareControls,
    getClosedHatControls, getOpenHatControls, getSamplerControls,
} from '../utils/knobConfigs'

// Programmatically derived from the knobConfig getters so it never drifts from the real control lists.
// Used by the global "REC AUTO" effect to arm all params when automation recording is active.
const GLOBAL_ARM_PARAMS: Array<{ target: AutomationTarget; param: string }> = [
    ...getSynthControls(DEFAULT_SYNTH_PARAMS_A).map(c => ({ target: 'synthA' as const, param: c.id })),
    ...getSynthControls(DEFAULT_SYNTH_PARAMS_B).map(c => ({ target: 'synthB' as const, param: c.id })),
    ...getBass2Controls(DEFAULT_BASS2_PARAMS).map(c => ({ target: 'bass2' as const, param: c.id })),
    ...getKickControls(DEFAULT_KICK_PARAMS).map(c => ({ target: 'kick' as const, param: c.id })),
    ...getSnareControls(DEFAULT_SNARE_PARAMS).map(c => ({ target: 'snare' as const, param: c.id })),
    ...getClosedHatControls(DEFAULT_CLOSED_HAT_PARAMS).map(c => ({ target: 'closedHat' as const, param: c.id })),
    ...getOpenHatControls(DEFAULT_OPEN_HAT_PARAMS).map(c => ({ target: 'openHat' as const, param: c.id })),
    ...getSamplerControls(DEFAULT_SAMPLER_BANK_PARAMS).map(c => ({ target: 'sampler' as const, param: c.id })),
];

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
    const [swing, setSwing] = useState<number>(0) // 0 = straight, 1 = max shuffle
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

    // Drum kit selection (808/909)
    const [drumKit, setDrumKit] = useState<DrumKitType>(DEFAULT_DRUM_KIT);
    const drumKitRef = useRef<DrumKitType>(DEFAULT_DRUM_KIT);
    const updateDrumKit = useCallback((kit: DrumKitType) => {
      setDrumKit(kit);
      drumKitRef.current = kit;
      // Sync kit engine
      if (drumKitEngineRef?.current) {
        drumKitEngineRef.current.setKit(kit);
      }
      // Apply kit default params when switching
      const kitParams = getKitDrumParams(kit);
      setKick(kitParams.kick); kickRef.current = kitParams.kick;
      setSnare(kitParams.snare); snareRef.current = kitParams.snare;
      setClosedHat(kitParams.closedHat); closedHatRef.current = kitParams.closedHat;
      setOpenHat(kitParams.openHat); openHatRef.current = kitParams.openHat;
    }, [drumKitEngineRef]);

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
        vibratoRate: 5.5,
        vibratoDepth: 0,
        tremoloDepth: 0,
        breathAmount: 0,
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
        setSampler(prev => {
            const next = [...prev];
            const bankIndex = activeSamplerBankRef.current;
            const current = next[bankIndex];
            if (!current) return prev;

            const nextBank: SamplerBankParams = {
                ...current,
                [param]: value as any,
            };

            if (param === 'breathAmount') {
                // Backward-compat for existing playback paths that still read flat breathIntensity.
                nextBank.breathIntensity = value as number;
            }
            if (param === 'vibratoRate' || param === 'vibratoDepth' || param === 'tremoloDepth' || param === 'breathAmount') {
                nextBank.expressiveness = {
                    vibratoRate: param === 'vibratoRate' ? value as number : current.expressiveness?.vibratoRate ?? 5.5,
                    vibratoDepth: param === 'vibratoDepth' ? value as number : current.expressiveness?.vibratoDepth ?? (current.vibratoDepth ?? 0),
                    tremoloDepth: param === 'tremoloDepth' ? value as number : current.expressiveness?.tremoloDepth ?? (current.tremoloDepth ?? 0),
                    breathAmount: param === 'breathAmount' ? value as number : current.expressiveness?.breathAmount ?? (current.breathIntensity ?? 0),
                };
            }

            next[bankIndex] = nextBank;
            samplerRef.current = next;
            return next;
        });
        if (audioEngine?.updateSamplerVoiceParams) {
            audioEngine.updateSamplerVoiceParams(activeSamplerBankRef.current, param, value);
        }

        // Live automation recording capture for Voice Designer (high creative value)
        if (automationStore.isParameterArmed('sampler', param)) {
            const step = automationStore.getState().playbackStep || currentStepRef.current || 0;
            let norm = typeof value === 'number' ? value : 0;
            if (param === 'formantShift') norm = (norm + 1) / 2; // -> 0-1
            automationStore.recordPoint('sampler', param, { step, value: Math.max(0, Math.min(1, norm)) });
        }
    }, [audioEngine]);

    useEffect(() => {
        const bank = sampler[activeSamplerBank];
        if (!bank) return;
        const expressiveness = bank.expressiveness;
        const nextParams = {
            ...samplerVoiceParamsRef.current,
            rootNote: bank.rootNote ?? samplerVoiceParamsRef.current.rootNote,
            coarseTune: bank.coarseTune ?? samplerVoiceParamsRef.current.coarseTune,
            fineTune: bank.fineTune ?? samplerVoiceParamsRef.current.fineTune,
            formantShift: bank.formantShift ?? samplerVoiceParamsRef.current.formantShift,
            attack: bank.attack ?? samplerVoiceParamsRef.current.attack,
            decay: bank.decay ?? samplerVoiceParamsRef.current.decay,
            quality: bank.quality ?? samplerVoiceParamsRef.current.quality,
            stretchMode: bank.stretchMode ?? samplerVoiceParamsRef.current.stretchMode,
            lockToSequencer: bank.lockToSequencer ?? samplerVoiceParamsRef.current.lockToSequencer,
            vibratoRate: expressiveness?.vibratoRate ?? samplerVoiceParamsRef.current.vibratoRate,
            vibratoDepth: expressiveness?.vibratoDepth ?? bank.vibratoDepth ?? samplerVoiceParamsRef.current.vibratoDepth,
            tremoloDepth: expressiveness?.tremoloDepth ?? bank.tremoloDepth ?? samplerVoiceParamsRef.current.tremoloDepth,
            breathAmount: expressiveness?.breathAmount ?? bank.breathIntensity ?? samplerVoiceParamsRef.current.breathAmount,
        };
        samplerVoiceParamsRef.current = nextParams;
        setSamplerVoiceParams(nextParams);
    }, [sampler, activeSamplerBank]);

    const handleAutoMix = useCallback(() => {
        // 1. Analyze Sequence Content
        const pattern = patternRef.current;
        const calculateActivity = (trackSeq: any) => {
            if (!trackSeq || !trackSeq.steps) return 0;
            let activeSteps = 0;
            let totalVelocity = 0;
            trackSeq.steps.forEach((step: any) => {
                if (step) {
                    activeSteps++;
                    totalVelocity += step.velocity || 1;
                }
            });
            return activeSteps === 0 ? 0 : totalVelocity / trackSeq.steps.length;
        };

        const synthAActivity = calculateActivity(pattern.partA);
        const synthBActivity = calculateActivity(pattern.partB);
        const bassActivity = calculateActivity(pattern.bass2);
        const kickActivity = calculateActivity(pattern.kick);
        const snareActivity = calculateActivity(pattern.snare);
        const closedHatActivity = calculateActivity(pattern.closedHat);
        const openHatActivity = calculateActivity(pattern.openHat);

        const samplerActivities = pattern.sampler.map(bank => calculateActivity(bank));
        const totalSamplerActivity = samplerActivities.reduce((a, b) => a + b, 0);

        // 2. Dynamic Panning
        // Spread synths based on relative activity to avoid crowding
        let synthAPan = -0.3;
        let synthBPan = 0.3;
        if (synthAActivity > 0 && synthBActivity === 0) {
            synthAPan = 0; // Center if it's the only synth
        } else if (synthBActivity > 0 && synthAActivity === 0) {
            synthBPan = 0;
        }

        updateSynthA({ pan: synthAPan });
        updateSynthB({ pan: synthBPan });
        updateBass2({ pan: 0 }); // Bass always centered
        updateKick({ pan: 0 });  // Kick always centered
        updateSnare({ pan: 0 }); // Snare always centered
        updateClosedHat({ pan: 0.15 });
        updateOpenHat({ pan: 0.25 });

        // Spread sampler voices wider if they are active, stagger them
        setSampler(prev => {
            const next = [...prev];
            let panSpread = 0.4;
            if (totalSamplerActivity > 0.5) panSpread = 0.6; // Wider if very active
            for (let i = 0; i < 8; i++) {
                // Determine direction and width based on index and activity
                const direction = i % 2 === 0 ? -1 : 1;
                const width = panSpread + (i * 0.05 * direction);
                // Keep the lead (0) closer to center if it's the main vocal
                next[i] = { ...next[i], pan: i === 0 ? 0 : Math.max(-1, Math.min(1, width)) };
            }
            return next;
        });

        // 3. Dynamic Leveling
        // Attenuate dense tracks to leave headroom
        const scaleVolume = (baseVol: number, activity: number) => {
            if (activity === 0) return baseVol;
            // Reduce volume slightly as activity increases (up to 15% reduction)
            const reduction = Math.min(0.15, activity * 0.2);
            return Math.max(0.1, baseVol - reduction);
        };

        updateSynthA({ volume: scaleVolume(0.7, synthAActivity) });
        updateSynthB({ volume: scaleVolume(0.7, synthBActivity) });
        updateBass2({ volume: scaleVolume(0.85, bassActivity) });
        updateKick({ volume: scaleVolume(0.95, kickActivity) });
        updateSnare({ volume: scaleVolume(0.85, snareActivity) });
        updateClosedHat({ volume: scaleVolume(0.6, closedHatActivity) });
        updateOpenHat({ volume: scaleVolume(0.65, openHatActivity) });

        setSampler(prev => {
            const next = [...prev];
            for (let i = 0; i < 8; i++) {
                next[i] = { ...next[i], volume: scaleVolume(0.75, samplerActivities[i]) };
            }
            return next;
        });

        // 4. Dynamic EQ / Masking Prevention
        // If Bass is active, thin out the synths slightly
        if (bassActivity > 0.1) {
            updateSynthA({ filterCutoff: Math.max(synthA.filterCutoff, 250) }); // Highpass
            updateSynthB({ filterCutoff: Math.max(synthB.filterCutoff, 250) });
        } else {
             // Reset to lower if bass is sparse
            if (synthA.filterCutoff > 100) updateSynthA({ filterCutoff: 100 });
            if (synthB.filterCutoff > 100) updateSynthB({ filterCutoff: 100 });
        }

        // If Vocals are very active, reduce synth resonance to clear the mid-range
        if (totalSamplerActivity > 0.3) {
            updateSynthA({ filterResonance: Math.min(synthA.filterResonance, 3) });
            updateSynthB({ filterResonance: Math.min(synthB.filterResonance, 3) });
        }

        setMasterVolume(0.85);
        if (audioEngine) {
            audioEngine.setMasterVolume(0.85);
        }

        console.log("Auto-Mix Assistant applied dynamic, content-aware mixing parameters.");
    }, [updateSynthA, updateSynthB, updateBass2, updateKick, updateSnare, updateClosedHat, updateOpenHat, audioEngine, synthA.filterCutoff, synthA.filterResonance, synthB.filterCutoff, synthB.filterResonance, setSampler]);

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

    // AutomationScheduler: created/updated when the audio engine becomes ready.
    // Wires Open303Manager into AudioParam-aligned parameter scheduling for
    // zipper-free 303 automation during playback.
    // ppq:192 matches the RBS TRAK event resolution (768 ticks/bar ÷ 4 beats = 192 PPQ).
    const automationSchedulerRef = useRef<AutomationScheduler | null>(null);
    // Resolved TRAK events from an imported RBS song for sub-step automation scheduling.
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

    // Restore saved engine303 voice selection (jc303 vs open303) once the manager exists.
    useEffect(() => {
        const mgr = (audioEngine as any)?.open303Engine;
        if (!mgr || typeof mgr.syncEngine303Settings !== 'function') return;
        mgr.syncEngine303Settings({
            lead: synthA.engine303 ?? 'open303',
            bass1: synthB.engine303 ?? 'open303',
            bass2: bass2.engine303 ?? 'open303',
        });
    }, [audioEngine, synthA.engine303, synthB.engine303, bass2.engine303]);

    // Cancel pending automation events when playback stops.
    // (handled in the schedPlaying useEffect below)

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

    // === Automation Recording Management (builds on #652 store) ===
    // When automation record is enabled + playing, auto-arm and capture all knob params.
    // On stop, commit buffers to 'recorded' lanes (pattern scope; song scope in song mode).
    useEffect(() => {
        if (isAutomationRecording && schedPlaying) {
            // Arm and start recording buffers for all params
            GLOBAL_ARM_PARAMS.forEach(({ target, param }) => {
                if (!automationStore.isParameterArmed(target, param)) {
                    automationStore.armParameter(target, param);
                }
                // Start buffer if not already recording
                const buf = automationStore.getState().recordingBuffers.find(b => b.target === target && b.parameter === param && b.isRecording);
                if (!buf) {
                    automationStore.startRecording(target, param);
                }
            });
        } else if (!isAutomationRecording || !schedPlaying) {
            // Commit any active recordings to lanes
            GLOBAL_ARM_PARAMS.forEach(({ target, param }) => {
                if (automationStore.isParameterArmed(target, param)) {
                    const scope: 'pattern' | 'song' = isSongModeActive ? 'song' : 'pattern';
                    const patternIdx = isSongModeActive ? undefined : (activeTrackSlotsRef.current['partA'] ?? 0);
                    automationStore.stopRecording(target, param, { scope, patternIndex: patternIdx, name: `${target}.${param} (recorded)` });
                    automationStore.disarmParameter(target, param);
                }
            });
        }
    }, [isAutomationRecording, schedPlaying, isSongModeActive]);

    const handlePlayToggle = useCallback(async () => {
        if (!isInitialized) {
            await initializeAudio();
            setIsInitialized(true);
        }
        const ctx = audioEngine?.context;
        if (ctx?.state === 'suspended') {
            try {
                await ctx.resume();
            } catch (e) {
                console.warn('[transport] AudioContext.resume() failed:', e);
            }
        }
        if (!isReady) {
            console.warn('[transport] Audio engine not ready yet — playback may not start');
        }
        setSchedPlaying(prev => !prev);
    }, [isInitialized, initializeAudio, audioEngine, isReady, setSchedPlaying]);

    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            const inTextField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            if (e.code === 'Space') {
                if (inTextField) return;
                e.preventDefault();
                handlePlayToggle();
                return;
            }

            // Undo: Ctrl/Cmd+Z
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
                if (inTextField) return;
                e.preventDefault();
                const prev = undoRedo.undo();
                if (prev) setPattern(prev);
                return;
            }

            // Redo: Ctrl/Cmd+Shift+Z  or  Ctrl/Cmd+Y
            if (((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') ||
                ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y')) {
                if (inTextField) return;
                e.preventDefault();
                const next = undoRedo.redo();
                if (next) setPattern(next);
                return;
            }
        };
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [handlePlayToggle, undoRedo]);

    const handleMasterVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => { const v = parseFloat(e.target.value); setMasterVolume(v); audioEngine?.setMasterVolume(v);
        if (automationStore.isParameterArmed('master', 'volume')) {
            const step = automationStore.getState().playbackStep || currentStepRef.current || 0;
            automationStore.recordPoint('master', 'volume', { step, value: Math.max(0, Math.min(1, v)) });
        }
    }, [audioEngine]);
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
        undoRedo.push(patternRef.current);
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
        const prev = patternRef.current;
        let newPattern = prev;

        if (trackKey === 'sampler') {
            const bankIdx = activeSamplerBankRef.current;
            const bank = prev.sampler[bankIdx];
            const nextAutomation = bank.automation ? { ...bank.automation } : {};
            const nextParamArray = nextAutomation[automationParam]
                ? [...nextAutomation[automationParam]]
                : Array(NUM_STEPS).fill(null);
            nextParamArray[step] = value;
            nextAutomation[automationParam] = nextParamArray;

            newPattern = {
                ...prev,
                sampler: prev.sampler.map((b, i) => i === bankIdx ? { ...b, automation: nextAutomation } : b)
            };
            updateStorageForTrack(trackKey, newPattern.sampler);
        } else {
            const track = prev[trackKey] as any;
            const nextAutomation = track.automation ? { ...track.automation } : {};
            const nextParamArray = nextAutomation[automationParam]
               ? [...nextAutomation[automationParam]]
               : Array(NUM_STEPS).fill(null);
            nextParamArray[step] = value;
            nextAutomation[automationParam] = nextParamArray;
            const nextTrack = { ...track, automation: nextAutomation };
            newPattern = { ...prev, [trackKey]: nextTrack };
            updateStorageForTrack(trackKey, newPattern[trackKey]);
        }
        setPattern(newPattern);
    }, [automationParam, updateStorageForTrack]);

    const handlePitchChange = useCallback((trackKey: TrackKey, step: number, pitch: number) => {
        if (trackKey !== 'sampler') return;
        const note = midiToNote(pitch);
        const prev = patternRef.current;
        const bankIdx = activeSamplerBankRef.current;
        const updater = (stepData: any) => stepData ? { ...stepData, note } : { note, velocity: 1, length: 1 };
        const newPattern = updateSamplerStep(prev, bankIdx, step, updater);
        updateStorageForTrack('sampler', newPattern.sampler);
        setPattern(newPattern);
    }, [updateStorageForTrack]);

    const handlePhonemeUpdate = useCallback((
        trackKey: TrackKey,
        bankIndex: number,
        step: number,
        phonemes: PhonemeData[] | undefined
    ) => {
        if (trackKey !== 'sampler') return;

        const prev = patternRef.current;
        const updater = (stepData: any) => stepData ? { ...stepData, phonemes } : { note: 'C4', velocity: 1, length: 1, phonemes };
        const newPattern = updateSamplerStep(prev, bankIndex, step, updater);

        updateStorageForTrack('sampler', newPattern.sampler);
        setPattern(newPattern);
    }, [updateStorageForTrack]);

    const handlePatternChange = useCallback((rowKey: keyof Pattern, i: number, _subIndex?: number | unknown, updates?: { length?: number, slide?: boolean, chord?: string[], sliceIndex?: number }) => {
        undoRedo.push(patternRef.current); // snapshot before edit
        const prev = patternRef.current;
        let changedSequence;
        let newPattern = prev;

        if (rowKey === 'sampler') {
            const bankIndex = activeSamplerBankRef.current;

            const updater = (stepData: any, isLengthClear?: boolean) => {
                if (isLengthClear) return null;
                if (updates) {
                    if (stepData) return { ...stepData, ...updates };
                    return stepData; // no existing step
                }
                if (stepData) return null;
                return { note: 'C4', velocity: 1, length: 1, slide: false };
            };

            newPattern = updateSamplerStep(newPattern, bankIndex, i, (s) => updater(s, false));
            if (updates?.length !== undefined && updater(prev.sampler[bankIndex].steps[i], false)) {
                for (let k = 1; k < updates.length; k++) {
                    const nextStepIdx = i + k;
                    if (nextStepIdx < prev.sampler[bankIndex].steps.length) {
                         newPattern = updateSamplerStep(newPattern, bankIndex, nextStepIdx, () => null);
                    }
                }
            }

            changedSequence = newPattern.sampler;
        } else {
            const updater = (stepData: any, isLengthClear?: boolean) => {
                if (isLengthClear) return null;
                if (updates) {
                    if (stepData) return { ...stepData, ...updates };
                    return stepData; // no existing step
                }
                if (stepData) return null;
                const defaultNote = rowKey.startsWith('part') ? (rowKey === 'partA' ? 'C4' : 'C3') : 'C4';
                return { note: defaultNote, velocity: 1, length: 1, slide: false };
            };

            newPattern = updateTrackStep(newPattern, rowKey, i, (s) => updater(s, false));
            if (updates?.length !== undefined && updater((prev[rowKey] as any).steps[i], false)) {
                 for (let k = 1; k < updates.length; k++) {
                    const nextStepIdx = i + k;
                    if (nextStepIdx < (prev[rowKey] as any).steps.length) {
                         newPattern = updateTrackStep(newPattern, rowKey, nextStepIdx, () => null);
                    }
                 }
            }

            changedSequence = newPattern[rowKey];
        }

        updateStorageForTrack(rowKey, changedSequence);
        setPattern(newPattern);
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
            vibratoDepth: voiceParams.vibratoDepth,
            tremoloDepth: voiceParams.tremoloDepth,
            breathIntensity: voiceParams.breathAmount,
            expressiveness: {
                vibratoRate: voiceParams.vibratoRate,
                vibratoDepth: voiceParams.vibratoDepth,
                tremoloDepth: voiceParams.tremoloDepth,
                breathAmount: voiceParams.breathAmount,
            },
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
                const prev = patternRef.current;
                const updater = (stepData: any) => stepData ? { ...stepData, note: newNote } : { note: newNote, velocity: 1, length: 1 };
                let newPattern;

                if (track === 'sampler') {
                    const bankIndex = activeSamplerBank;
                    newPattern = updateSamplerStep(prev, bankIndex, step, updater);
                    if (noteDragRef.current) noteDragRef.current.pendingSequence = newPattern.sampler;
                } else {
                    newPattern = updateTrackStep(prev, track, step, updater);
                    if (noteDragRef.current) noteDragRef.current.pendingSequence = newPattern[track];
                }
                setPattern(newPattern);
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

    const trackKey = contextMenu.track as TrackKey;
    const stepIndex = contextMenu.step;

    const prev = patternRef.current;
    const updater = (stepData: any) => stepData ? { ...stepData, note } : { note, velocity: 1, length: 1 };

    let newPattern;
    let changedSequence;

    if (trackKey === 'sampler') {
        const bankIdx = activeSamplerBankRef.current;
        newPattern = updateSamplerStep(prev, bankIdx, stepIndex, updater);
        changedSequence = newPattern.sampler;
    } else {
        newPattern = updateTrackStep(prev, trackKey, stepIndex, updater);
        changedSequence = newPattern[trackKey];
    }

    updateStorageForTrack(trackKey, changedSequence);
    setPattern(newPattern);

    setContextMenu(null);
}, [contextMenu, updateStorageForTrack]);
const handleNoteLengthChange = useCallback((newLength: number) => {
    if (!contextMenu) return;

    const prev = patternRef.current;
    const trackKey = contextMenu.track;
    const stepIndex = contextMenu.step;

    let newPattern = prev;

    if (trackKey === 'sampler') {
        const bankIdx = activeSamplerBankRef.current;

        // Update the length of the current step
        newPattern = updateSamplerStep(newPattern, bankIdx, stepIndex, (step) => {
            if (step) return { ...step, length: newLength };
            return step;
        });

        // Nullify subsequent steps covered by the new length
        for (let i = 1; i < newLength; i++) {
            const targetIndex = stepIndex + i;
            if (targetIndex < 256) {
                newPattern = updateSamplerStep(newPattern, bankIdx, targetIndex, () => null);
            }
        }

        updateStorageForTrack(trackKey, newPattern.sampler);
    } else {
        // Update the length of the current step
        newPattern = updateTrackStep(newPattern, trackKey, stepIndex, (step) => {
            if (step) return { ...step, length: newLength };
            return step;
        });

        // Nullify subsequent steps covered by the new length
        for (let i = 1; i < newLength; i++) {
            const targetIndex = stepIndex + i;
            if (targetIndex < 256) {
                newPattern = updateTrackStep(newPattern, trackKey, targetIndex, () => null);
            }
        }

        updateStorageForTrack(trackKey, newPattern[trackKey]);
    }

    setPattern(newPattern);

    setContextMenu(null);
}, [contextMenu, updateStorageForTrack]);

const handleNotePropertyChange = useCallback((
    key: 'timbre' | 'velocity' | 'probability' | 'microtiming' | 'reverse' | 'retrigger' | 'freeze' | 'formantShift' | 
         'filterCutoff' | 'filterResonance' | 'envMod' | 'formantLfoSync' | 'formantLfoRate' | 'formantLfoDepth' |
         'freezeLfoSync' | 'freezeLfoRate' | 'freezeLfoDepth' | 'formantEnvSync' |
         'formantEnvAttack' | 'formantEnvDecay' | 'formantEnvAmount' | 'vibratoDepth' | 'drive' | 
         'characterMorph' | 'reverbSend' | 'reverbType' | 'reverbLfoRate' | 'reverbLfoDepth' | 'delayLfoRate' | 'delayLfoDepth' | 'delaySend' | 'freezeEnvDepth' | 'timeStretchEnvDepth' | 'pan' | 'glitchChance' |
         'grainEnvDepth' | 'grainPitchQuantize' | 'granularPitchShift' | 'choir' | 'gateDepth' | 'gateRate' | 'tranceGate' | 'bitcrush' | 'downsample' |
         'vowel' | 'portamento' | 'slideFormant',
    value: number | boolean | string
) => {
    if (!contextMenu) return;

    const trackKey = contextMenu.track;
    const stepIndex = contextMenu.step;

    const prev = patternRef.current;
    const updater = (stepData: any) => {
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

    let newPattern;
    let changedSequence;

    if (trackKey === 'sampler') {
        const bankIdx = activeSamplerBankRef.current;
        newPattern = updateSamplerStep(prev, bankIdx, stepIndex, updater);
        changedSequence = newPattern.sampler;
    } else {
        newPattern = updateTrackStep(prev, trackKey, stepIndex, updater);
        changedSequence = newPattern[trackKey];
    }

    updateStorageForTrack(trackKey, changedSequence);
    setPattern(newPattern);
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
        setDrumKit: updateDrumKit,
        setIsSongModeActive,
        trakEventsRef,
    });

    const handleSynthChange = useCallback((isA: boolean, id: string, val: number) => { const updater = isA ? updateSynthA : updateSynthB; let realVal = val; if (id === 'pitch') realVal = Math.floor(val * 48 - 24); else if (id === 'filterCutoff') realVal = val * 8000; else if (id === 'filterResonance') realVal = val * 20; else if (id === 'filterMode') realVal = Math.round(val); else if (id === 'decay') realVal = val * 2; else if (id === 'release') realVal = val * 2; else if (id === 'length') realVal = val * 2; updater({ [id]: realVal });
        // Capture to automation recording buffer if armed (val is already 0-1 normalized from HardwareModule)
        const target: AutomationTarget = isA ? 'synthA' : 'synthB';
        if (automationStore.isParameterArmed(target, id)) {
            const step = automationStore.getState().playbackStep || currentStepRef.current || 0;
            automationStore.recordPoint(target, id, { step, value: Math.max(0, Math.min(1, val)) });
        }
    }, [updateSynthA, updateSynthB]);
    const handleBass2Change = useCallback((id: string, val: number) => { let realVal = val; if (id === 'waveform') realVal = val > 0.5 ? 1 : 0; else if (id === 'cutoff') realVal = val * 8000; else if (id === 'resonance') realVal = val * 20; else if (id === 'filterMode') realVal = Math.round(val); else if (id === 'decay') realVal = val * 2; else if (id === 'pitch') realVal = Math.floor(val * 48 - 24); updateBass2({ [id]: realVal });
        // Bass2 automation recording capture (val is already 0-1 normalized from HardwareModule)
        if (automationStore.isParameterArmed('bass2', id)) {
            const step = automationStore.getState().playbackStep || currentStepRef.current || 0;
            automationStore.recordPoint('bass2', id, { step, value: Math.max(0, Math.min(1, val)) });
        }
    }, [updateBass2]);
    const handleKickChange = useCallback((id: string, val: number) => {
        let realVal = val; if (id === 'pitch') realVal = val * 130 + 20; updateKick({ [id]: realVal });
        if (automationStore.isParameterArmed('kick', id)) {
            const step = automationStore.getState().playbackStep || currentStepRef.current || 0;
            automationStore.recordPoint('kick', id, { step, value: Math.max(0, Math.min(1, val)) });
        }
    }, [updateKick]);
    const handleSnareChange = useCallback((id: string, val: number) => {
        let realVal = val; if (id === 'tone') realVal = val * 300 + 100; else if (id === 'noise') realVal = val * 7000 + 1000; else if (id === 'decay') realVal = val * 0.5; updateSnare({ [id]: realVal });
        if (automationStore.isParameterArmed('snare', id)) {
            const step = automationStore.getState().playbackStep || currentStepRef.current || 0;
            automationStore.recordPoint('snare', id, { step, value: Math.max(0, Math.min(1, val)) });
        }
    }, [updateSnare]);
    const handleClosedHatChange = useCallback((id: string, val: number) => {
        updateClosedHat({ [id]: val });
        if (automationStore.isParameterArmed('closedHat', id)) {
            const step = automationStore.getState().playbackStep || currentStepRef.current || 0;
            automationStore.recordPoint('closedHat', id, { step, value: Math.max(0, Math.min(1, val)) });
        }
    }, [updateClosedHat]);
    const handleOpenHatChange = useCallback((id: string, val: number) => {
        updateOpenHat({ [id]: val });
        if (automationStore.isParameterArmed('openHat', id)) {
            const step = automationStore.getState().playbackStep || currentStepRef.current || 0;
            automationStore.recordPoint('openHat', id, { step, value: Math.max(0, Math.min(1, val)) });
        }
    }, [updateOpenHat]);

    /**
     * Toggle record-arm for a single knob/parameter.
     * If the param is already armed: commit any open recording buffer and disarm.
     * If the param is not armed: arm it and start a recording buffer (when transport is playing).
     */
    const handleKnobRecordToggle = useCallback((target: AutomationTarget, paramId: string) => {
        if (automationStore.isParameterArmed(target, paramId)) {
            // Commit buffer if playing, otherwise discard
            if (schedPlaying) {
                const scope: 'pattern' | 'song' = isSongModeActiveRef.current ? 'song' : 'pattern';
                const patternIdx = isSongModeActiveRef.current ? undefined : (activeTrackSlotsRef.current['partA'] ?? 0);
                automationStore.stopRecording(target, paramId, { scope, patternIndex: patternIdx, name: `${target}.${paramId} (recorded)` });
            } else {
                automationStore.cancelRecording(target, paramId);
            }
            automationStore.disarmParameter(target, paramId);
        } else {
            automationStore.armParameter(target, paramId);
            if (schedPlaying) {
                automationStore.startRecording(target, paramId);
            }
        }
    }, [schedPlaying, isSongModeActiveRef, activeTrackSlotsRef]);

    const handleSamplerChange = useCallback((id: string, val: number) => {
        let realVal = val; if (id === 'playbackSpeed') realVal = val * 4.0; else if (id === 'filterCutoff') realVal = val * 20000; else if (id === 'filterResonance') realVal = val * 20; setSampler(prev => {
            const next = [...prev]; const currentBank = next[activeSamplerBank];
            next[activeSamplerBank] = { ...currentBank, [id]: realVal }; return next;
        });
        // Sampler track param automation recording
        if (automationStore.isParameterArmed('sampler', id)) {
            const step = automationStore.getState().playbackStep || currentStepRef.current || 0;
            let norm = val;
            if (id === 'filterCutoff') norm = Math.max(0, Math.min(1, val / 20000));
            else if (id === 'filterResonance') norm = Math.max(0, Math.min(1, val / 20));
            else if (id === 'volume') norm = Math.max(0, Math.min(1, val));
            automationStore.recordPoint('sampler', id, { step, value: norm });
        }
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
        const bankIdx = activeSamplerBankRef.current;
        let noteIndex = 0;

        let newPattern = prev;
        for (let i = 0; i < 32; i++) {
            const step = prev.sampler[bankIdx].steps[i];
            if (step && step.velocity > 0) {
                newPattern = updateSamplerStep(newPattern, bankIdx, i, (s) => ({ ...s, sliceIndex: noteIndex }));
                noteIndex++;
            }
        }

        updateStorageForTrack('sampler', newPattern.sampler);
        setPattern(newPattern);

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

    const synthAChild = useMemo(() => {
        const is303 = synthA.waveform === '303-saw' || synthA.waveform === '303-sqr';
        const isProphecy = synthA.waveform?.startsWith('prophecy-') ?? false;
        const engine = synthA.engine303 ?? 'open303';
        const currentTypeA: OscillatorType = waveformToOscillatorType(synthA.waveform, synthA.engine303);
        const panelClassesA = getOscillatorPanelClasses(currentTypeA);

        const handleSynthAEngineChange = (e: 'open303' | 'jc303') => {
            updateSynthA({ engine303: e });
            const mgr = audioEngine?.open303Engine;
            if (mgr && 'setLead303Engine' in mgr) (mgr as any).setLead303Engine(e);
            engineTelemetry.registerResolution('synthA-engine303', e, 'user-initiated');
        };

        const handleSynthATypeChange = (newType: OscillatorType) => {
            const nextWave = getDefaultWaveformForType(newType);
            const nextEngine = (newType === 'jc303') ? 'jc303' : (newType === 'open303' ? 'open303' : undefined);
            const update: any = { waveform: nextWave };
            if (nextEngine) update.engine303 = nextEngine;
            updateSynthA(update);
            // If switching to/from 303 family, notify the audio manager
            if (newType === 'open303' || newType === 'jc303') {
                const mgr = audioEngine?.open303Engine;
                if (mgr && 'setLead303Engine' in mgr) (mgr as any).setLead303Engine(nextEngine ?? 'open303');
            }
            engineTelemetry.registerResolution('synthA-oscType', newType, 'user-initiated');
        };

        return (
            <div className={`absolute top-4 right-6 pointer-events-none flex flex-col items-end gap-2 rounded-lg p-1 transition-colors ${panelClassesA}`}>
                <div className="pointer-events-auto flex flex-col items-end gap-2 w-fit">
                {/* New Oscillator Type selector (themed) — primary control per the refactor plan */}
                <OscillatorTypeSelector
                    type={currentTypeA}
                    onChange={handleSynthATypeChange}
                    accentColor="cyan"
                    compact
                />
                {/* Per-type waveform variant selector (Phase 2): replaces the full legacy WaveformSelector popup.
                    Only offers shapes that belong to the chosen oscillator family; keeps the panel theme stable. */}
                <OscillatorVariantSelector
                    type={currentTypeA}
                    selected={synthA.waveform}
                    onChange={(w) => updateSynthA({ waveform: w })}
                    accentColor="cyan"
                />
                {is303 && (
                    <Engine303Selector engine={engine} onChange={handleSynthAEngineChange} accentColor="cyan" />
                )}
                {isProphecy && (
                    <ProphecyPanel
                        vowel={synthA.vowel ?? 0}
                        portamento={synthA.portamento ?? 0}
                        formantShift={synthA.formantShift ?? 0}
                        accentColor="cyan"
                        onVowelChange={(v) => updateSynthA({ vowel: v })}
                        onPortamentoChange={(v) => updateSynthA({ portamento: v })}
                        onFormantShiftChange={(v) => updateSynthA({ formantShift: v })}
                    />
                )}
                </div>
            </div>
        );
    }, [synthA.waveform, synthA.engine303, synthA.vowel, synthA.portamento, synthA.formantShift, updateSynthA, audioEngine]);
    const synthBChild = useMemo(() => {
        const is303 = synthB.waveform === '303-saw' || synthB.waveform === '303-sqr';
        const isProphecy = synthB.waveform?.startsWith('prophecy-') ?? false;
        const engine = synthB.engine303 ?? 'open303';
        const currentTypeB: OscillatorType = waveformToOscillatorType(synthB.waveform, synthB.engine303);
        const panelClassesB = getOscillatorPanelClasses(currentTypeB);

        const handleSynthBEngineChange = (e: 'open303' | 'jc303') => {
            updateSynthB({ engine303: e });
            const mgr = audioEngine?.open303Engine;
            if (mgr && 'setBass1Engine' in mgr) mgr.setBass1Engine(e);
            engineTelemetry.registerResolution('synthB-engine303', e, 'user-initiated');
        };

        const handleSynthBTypeChange = (newType: OscillatorType) => {
            const nextWave = getDefaultWaveformForType(newType);
            const nextEngine = (newType === 'jc303') ? 'jc303' : (newType === 'open303' ? 'open303' : undefined);
            const update: any = { waveform: nextWave };
            if (nextEngine) update.engine303 = nextEngine;
            updateSynthB(update);
            if (newType === 'open303' || newType === 'jc303') {
                const mgr = audioEngine?.open303Engine;
                if (mgr && 'setBass1Engine' in mgr) mgr.setBass1Engine(nextEngine ?? 'open303');
            }
            engineTelemetry.registerResolution('synthB-oscType', newType, 'user-initiated');
        };

        return (
            <div className={`absolute top-4 right-6 pointer-events-none flex flex-col items-end gap-2 rounded-lg p-1 transition-colors ${panelClassesB}`}>
                <div className="pointer-events-auto flex flex-col items-end gap-2 w-fit">
                <OscillatorTypeSelector
                    type={currentTypeB}
                    onChange={handleSynthBTypeChange}
                    accentColor="pink"
                    compact
                />
                {/* Per-type waveform variant selector (Phase 2) */}
                <OscillatorVariantSelector
                    type={currentTypeB}
                    selected={synthB.waveform}
                    onChange={(w) => updateSynthB({ waveform: w })}
                    accentColor="pink"
                />
                {is303 && (
                    <Engine303Selector engine={engine} onChange={handleSynthBEngineChange} accentColor="pink" />
                )}
                {isProphecy && (
                    <ProphecyPanel
                        vowel={synthB.vowel ?? 0}
                        portamento={synthB.portamento ?? 0}
                        formantShift={synthB.formantShift ?? 0}
                        accentColor="pink"
                        onVowelChange={(v) => updateSynthB({ vowel: v })}
                        onPortamentoChange={(v) => updateSynthB({ portamento: v })}
                        onFormantShiftChange={(v) => updateSynthB({ formantShift: v })}
                    />
                )}
                </div>
            </div>
        );
    }, [synthB.waveform, synthB.engine303, synthB.vowel, synthB.portamento, synthB.formantShift, updateSynthB, audioEngine]);
    const bass2Child = useMemo(() => {
        const engine = bass2.engine303 ?? 'open303';
        const handleBass2EngineChange = (e: 'open303' | 'jc303') => {
            updateBass2({ engine303: e });
            const mgr = audioEngine?.open303Engine;
            if (mgr && 'setBass2Engine' in mgr) mgr.setBass2Engine(e);
            engineTelemetry.registerResolution('bass2-engine303', e, 'user-initiated');
        };
        const bass2Type: OscillatorType = engine === 'jc303' ? 'jc303' : 'open303';
        return (
        <div className="absolute top-4 right-6 pointer-events-none">
            <div className="pointer-events-auto flex flex-col gap-2 p-2 rounded-lg bg-zinc-950/80 border border-pink-500/20 w-fit">
                {/* Use the shared per-type variant picker (303 family only) for consistency with synth panels.
                    Active styling will be emerald/teal per engine family. */}
                <OscillatorVariantSelector
                    type={bass2Type}
                    selected={bass2.waveform}
                    onChange={(w) => updateBass2({ waveform: w as '303-saw' | '303-sqr' })}
                    accentColor="pink"
                />
                <Engine303Selector engine={engine} onChange={handleBass2EngineChange} accentColor="pink" />
            </div>
        </div>
        );
    }, [bass2.waveform, bass2.engine303, updateBass2, audioEngine]);
    const samplerChild = useMemo(() => (<div className="absolute top-2 left-[10%] right-[10%] max-h-[38%] h-auto pointer-events-auto z-10 bg-gray-900/90 rounded-lg border border-purple-500/30 backdrop-blur-sm overflow-y-auto"><SamplerPanel params={sampler} onChange={(u) => updateSampler(u)} onParamChange={handleSamplerParamChange} onLoadSample={handleLoadSample} audioContext={audioEngine?.context!} audioEngine={audioEngine || undefined} activeBankIdx={activeSamplerBank} onBankChange={setActiveSamplerBank} onOpenEditor={() => setIsVoiceEditorOpen(true)} isVoiceEditorOpen={isVoiceEditorOpen} ttsPhrases={ttsPhrases} onTtsPhraseChange={handleTtsPhraseChange} onGenerateTTS={handleGenerateTTS} loadedBanks={loadedBanks} sampleBuffer={sampleBuffers[activeSamplerBank]} sliceHighlightRef={sliceHighlightRef} melodicMode={melodicMode} onMelodicModeChange={setMelodicMode} multisampleReady={multisampleReady} multisampleProcessing={multisampleProcessing} alignment={activeAlignment} onAlignmentChange={(newAlignment) => { audioEngine?.setAlignment?.(activeSamplerBank, newAlignment); setActiveAlignment(newAlignment); }} /></div>), [sampler, updateSampler, handleSamplerParamChange, audioEngine, setIsVoiceEditorOpen, isVoiceEditorOpen, activeSamplerBank, handleLoadSample, ttsPhrases, handleTtsPhraseChange, handleGenerateTTS, loadedBanks, sampleBuffers, melodicMode, multisampleReady, multisampleProcessing, activeAlignment, setActiveAlignment]);

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
