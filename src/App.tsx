import React, { useCallback, useEffect, useRef, useState, useMemo, lazy, Suspense } from 'react'
import { useAudioEngine } from './hooks/useAudioEngine'
import { usePyodideEngine } from './hooks/usePyodideEngine'
import { useScheduler } from './hooks/useScheduler'
import { useGamepad } from './hooks/useGamepad';
import { useStableKnobConfig } from './hooks/useStableKnobConfig';
import { GamepadDebugger } from './components/GamepadDebugger';
import { HardwareModule } from './components/HardwareModule';
import type { KnobConfig } from './components/HardwareModule';
import { WaveformSelector } from './components/WaveformSelector';
import { NoteSelector } from './components/NoteSelector';
import { LiveKeyboard } from './components/LiveKeyboard';

import { VoiceEditor } from './components/VoiceEditor';
import { SamplerPanel } from './components/SamplerPanel';
import { SongMode } from './components/SongMode';
import { CloudLibrary } from './components/CloudLibrary';
import { CloudStatus } from './components/CloudStatus';
import { Toast } from './components/Toast';
import type { CloudItemType } from './services/CloudStorage';
import { exportSongToXM } from './utils/xmExport';
import { getNoteColor } from './utils/noteColors';
import { noteToMidi, midiToNote } from './utils/musicTheory';
import { audioBufferToWav, blobToBase64 } from './utils/audioExport';
import { copySteps, pasteSteps } from './utils/clipboardUtils';
import { MainSequencer } from './components/MainSequencer';
import type { MainSequencerHandle } from './components/MainSequencer';

const Studio3D = lazy(() => import('./components/Studio3D').then(module => ({ default: module.Studio3D })));

import {
    noteToFrequency,
    INITIAL_PATTERN,
    NUM_STEPS,
    DEFAULT_TEMPO,
    DEFAULT_SYNTH_PARAMS_A,
    DEFAULT_SYNTH_PARAMS_B,
    DEFAULT_KICK_PARAMS,
    DEFAULT_SNARE_PARAMS,
    DEFAULT_CLOSED_HAT_PARAMS,
    DEFAULT_OPEN_HAT_PARAMS,
} from './constants'
import type { Pattern, SynthParams, KickParams, SnareParams, SamplerParams, SamplerBankParams, PartSequence, SavedSongData, Note, TrackKey } from './types'

// --- CONSTANTS ---
const DEFAULT_SAMPLER_BANK_PARAMS: SamplerBankParams = {
    sampleName: 'bank_0',
    playbackSpeed: 1.0,
    volume: 1.0,
    filterCutoff: 20000,
    filterResonance: 0,
    drive: 0,
    delaySend: 0,
    mode: 'loop',
    grainSize: 4410
};

const INITIAL_SAMPLER_PARAMS: SamplerParams = Array.from({ length: 8 }, (_, i) => ({
    ...DEFAULT_SAMPLER_BANK_PARAMS,
    sampleName: `bank_${i}`
}));

const UPDATED_INITIAL_PATTERN: Pattern = {
    ...INITIAL_PATTERN,
    sampler: Array.from({ length: 8 }, () => ({ steps: Array(NUM_STEPS).fill(null) }))
};

// --- TYPES FOR STORAGE ---
type SongSnapshot = {
    pattern: Pattern;
    tempo: number;
    ambianceUrl: string;
    backgroundImage: string;
    params: {
        synthA: SynthParams;
        synthB: SynthParams;
        kick: KickParams;
        snare: SnareParams;
        closedHat: any;
        openHat: any;
        sampler: SamplerParams;
    }
};

const getInitialTrackStorage = (initialPattern: Pattern): Record<TrackKey, (PartSequence | PartSequence[] | null)[]> => {
    const storage: any = {
        partA: Array(8).fill(null),
        partB: Array(8).fill(null),
        kick: Array(8).fill(null),
        snare: Array(8).fill(null),
        closedHat: Array(8).fill(null),
        openHat: Array(8).fill(null),
        sampler: Array(8).fill(null),
    };

    (Object.keys(storage) as TrackKey[]).forEach(key => {
        storage[key][0] = JSON.parse(JSON.stringify(initialPattern[key]));
    });

    return storage;
};

const COLOR_LEAD = [0.0, 0.9, 1.0] as [number, number, number];
const COLOR_BASS = [1.0, 0.2, 0.8] as [number, number, number];
const COLOR_KICK = [1.0, 0.6, 0.0] as [number, number, number];
const COLOR_SNARE = [0.2, 1.0, 0.2] as [number, number, number];
const COLOR_CH = [0.8, 0.8, 0.0] as [number, number, number];
const COLOR_OH = [0.9, 0.5, 0.0] as [number, number, number];
const COLOR_SAMPLER = [0.6, 0.4, 1.0] as [number, number, number];

const EMPTY_STEPS = Array(32).fill(null);
const EMPTY_SEQ = { steps: EMPTY_STEPS };
const EMPTY_SAMPLER_SEQUENCE = Array.from({ length: 8 }, () => ({ steps: EMPTY_STEPS }));

const ROWS = [
    { key: 'partA', label: 'Lead' },
    { key: 'partB', label: 'Bass' },
    { key: 'kick', label: 'Kick' },
    { key: 'snare', label: 'Snare' },
    { key: 'closedHat', label: 'CH' },
    { key: 'openHat', label: 'OH' },
    { key: 'sampler', label: 'SMP' },
] as const;

// --- MODULE CONTROL HELPERS ---
const getSynthControls = (params: SynthParams): KnobConfig[] => {
    const filterModeValue = params.filterMode ?? 0;
    return [
        { id: 'attack', label: 'ATK', x: 0.20, y: 0.25, size: 0.08, value: params.attack, valueDisplay: `${params.attack.toFixed(2)}s` },
        { id: 'decay', label: 'DEC', x: 0.35, y: 0.25, size: 0.08, value: params.decay / 2, valueDisplay: `${params.decay.toFixed(2)}s` },
        { id: 'sustain', label: 'SUS', x: 0.50, y: 0.25, size: 0.08, value: params.sustain, valueDisplay: `${Math.round(params.sustain * 100)}%` },
        { id: 'release', label: 'REL', x: 0.65, y: 0.25, size: 0.08, value: params.release / 2, valueDisplay: `${params.release.toFixed(2)}s` },
        { id: 'filterCutoff', label: 'CUTOFF', x: 0.35, y: 0.60, size: 0.12, value: params.filterCutoff / 8000, valueDisplay: `${Math.round(params.filterCutoff)}Hz` },
        { id: 'filterResonance', label: 'RES', x: 0.50, y: 0.60, size: 0.12, value: params.filterResonance / 20, valueDisplay: `${params.filterResonance.toFixed(1)}` },
        { id: 'filterMode', label: 'MODE', x: 0.65, y: 0.60, size: 0.08, value: filterModeValue, valueDisplay: filterModeValue > 0 ? '24dB' : '18dB' },
        { id: 'pitch', label: 'TUNE', x: 0.10, y: 0.50, size: 0.09, value: (params.pitch + 24) / 48, valueDisplay: `${params.pitch > 0 ? '+' : ''}${params.pitch.toFixed(1)}st` },
        { id: 'length', label: 'GATE', x: 0.75, y: 0.50, size: 0.09, value: (params.length || 0.25) / 2, valueDisplay: `${(params.length || 0.25).toFixed(2)}s` },
        { id: 'volume', label: 'LEVEL', x: 0.90, y: 0.50, size: 0.10, value: params.volume, valueDisplay: `${Math.round(params.volume * 100)}%` },
        { id: 'delayMix', label: 'DLY MIX', x: 0.85, y: 0.80, size: 0.07, value: params.delayMix, valueDisplay: `${Math.round(params.delayMix * 100)}%` },
        { id: 'delayTime', label: 'DLY TIME', x: 0.95, y: 0.80, size: 0.07, value: params.delayTime, valueDisplay: `${params.delayTime.toFixed(2)}s` },
    ];
};
const getKickControls = (params: KickParams): KnobConfig[] => [
    { id: 'pitch', label: 'TUNE', x: 0.2, y: 0.45, size: 0.13, value: (params.pitch - 20) / 130, valueDisplay: `${Math.round(params.pitch)}Hz` },
    { id: 'decay', label: 'DECAY', x: 0.5, y: 0.45, size: 0.13, value: params.decay, valueDisplay: `${params.decay.toFixed(2)}s` },
    { id: 'tone', label: 'SNAP', x: 0.8, y: 0.45, size: 0.13, value: params.tone, valueDisplay: `${Math.round(params.tone * 100)}%` },
    { id: 'volume', label: 'LEVEL', x: 0.9, y: 0.8, size: 0.08, value: params.volume, valueDisplay: `${Math.round(params.volume * 100)}%` },
];
const getSnareControls = (params: SnareParams): KnobConfig[] => [
    { id: 'tone', label: 'TUNE', x: 0.25, y: 0.45, size: 0.13, value: (params.tone - 100) / 300, valueDisplay: `${Math.round(params.tone)}Hz` },
    { id: 'noise', label: 'SNAPPY', x: 0.5, y: 0.45, size: 0.13, value: (params.noise - 1000) / 7000, valueDisplay: `${Math.round(params.noise)}Hz` },
    { id: 'decay', label: 'DECAY', x: 0.75, y: 0.45, size: 0.11, value: params.decay * 2, valueDisplay: `${params.decay.toFixed(2)}s` },
    { id: 'volume', label: 'LEVEL', x: 0.9, y: 0.8, size: 0.08, value: params.volume, valueDisplay: `${Math.round(params.volume * 100)}%` },
];
const getClosedHatControls = (params: any): KnobConfig[] => [
    { id: 'decay', label: 'DECAY', x: 0.3, y: 0.45, size: 0.13, value: params.decay, valueDisplay: `${params.decay.toFixed(2)}s` },
    { id: 'pitch', label: 'TONE', x: 0.6, y: 0.45, size: 0.13, value: params.pitch / 12000, valueDisplay: `${(params.pitch / 1000).toFixed(1)}kHz` },
    { id: 'volume', label: 'LEVEL', x: 0.9, y: 0.8, size: 0.08, value: params.volume, valueDisplay: `${Math.round(params.volume * 100)}%` },
];
const getOpenHatControls = (params: any): KnobConfig[] => [
    { id: 'decay', label: 'DECAY', x: 0.3, y: 0.45, size: 0.13, value: params.decay, valueDisplay: `${params.decay.toFixed(2)}s` },
    { id: 'pitch', label: 'TONE', x: 0.6, y: 0.45, size: 0.13, value: params.pitch / 12000, valueDisplay: `${(params.pitch / 1000).toFixed(1)}kHz` },
    { id: 'volume', label: 'LEVEL', x: 0.9, y: 0.8, size: 0.08, value: params.volume, valueDisplay: `${Math.round(params.volume * 100)}%` },
];
const getSamplerControls = (params: SamplerBankParams): KnobConfig[] => [
    { id: 'volume', label: 'LEVEL', x: 0.8, y: 0.25, size: 0.1, value: params.volume, valueDisplay: `${Math.round(params.volume * 100)}%` },
    { id: 'playbackSpeed', label: 'SPEED', x: 0.2, y: 0.25, size: 0.1, value: (params.playbackSpeed) / 4.0, valueDisplay: `${params.playbackSpeed.toFixed(2)}x` },
    { id: 'filterCutoff', label: 'CUTOFF', x: 0.2, y: 0.65, size: 0.12, value: params.filterCutoff / 20000, valueDisplay: `${Math.round(params.filterCutoff)}Hz` },
    { id: 'filterResonance', label: 'RES', x: 0.4, y: 0.65, size: 0.12, value: params.filterResonance / 20, valueDisplay: `${params.filterResonance.toFixed(1)}` },
    { id: 'drive', label: 'DRIVE', x: 0.6, y: 0.65, size: 0.12, value: params.drive, valueDisplay: `${Math.round(params.drive * 100)}%` },
    { id: 'delaySend', label: 'DELAY', x: 0.8, y: 0.65, size: 0.12, value: params.delaySend, valueDisplay: `${Math.round(params.delaySend * 100)}%` },
    { id: 'glitchChance', label: 'GLITCH', x: 0.5, y: 0.85, size: 0.08, value: params.glitchChance || 0, valueDisplay: `${Math.round((params.glitchChance || 0) * 100)}%` },
];

const StartOverlay = ({ onStart, isReady }: { onStart: () => void, isReady: boolean }) => {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#111827] bg-opacity-95 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="start-overlay-title">
            <div className="text-center p-8 bg-[#1f2937] border-2 border-cyan-500 rounded-2xl shadow-2xl max-w-lg w-full">
                <h1 id="start-overlay-title" className="text-4xl font-bold font-orbitron text-cyan-400 mb-2 tracking-widest drop-shadow-[0_0_10px_rgba(6,182,212,0.8)]">HYPHON</h1>
                <p className="text-gray-400 mb-8 font-mono text-sm tracking-wide">BROWSER AUDIO WORKSTATION</p>
                <div className="mb-8 p-4 bg-gray-800 rounded-lg border border-gray-700 text-left font-mono text-xs text-gray-300" role="status" aria-live="polite">
                    <p className="mb-2 text-cyan-500 font-bold">SYSTEM CHECK:</p>
                    <div className="flex justify-between mb-1"><span>AUDIO ENGINE:</span><span className="text-green-400">READY</span></div>
                    <div className="flex justify-between mb-1"><span>WEBGPU:</span><span className="text-green-400">DETECTED</span></div>
                    <div className="flex justify-between"><span>CORE (PYODIDE):</span>{isReady ? <span className="text-green-400">LOADED</span> : <span className="text-yellow-400 animate-pulse">LOADING...</span>}</div>
                </div>
                <button onClick={onStart} disabled={!isReady} aria-busy={!isReady} className={`w-full py-4 rounded-xl font-orbitron text-xl font-bold tracking-widest transition-all duration-300 ${isReady ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_20px_rgba(6,182,212,0.6)] hover:shadow-[0_0_30px_rgba(6,182,212,0.8)] border border-cyan-400 cursor-pointer transform hover:scale-[1.02]' : 'bg-gray-700 text-gray-500 cursor-wait border border-gray-600'}`}>{isReady ? 'INITIALIZE SYSTEM' : 'LOADING RESOURCES...'}</button>
            </div>
        </div>
    );
};

export const App: React.FC = () => {
    const { pyodide, isPyodideReady, pyodideStatus } = usePyodideEngine()
    const [isVoiceEditorOpen, setIsVoiceEditorOpen] = useState(false);
    const [isCloudLibraryOpen, setIsCloudLibraryOpen] = useState(false);
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
    const { audioEngine, isReady, initializeAudio, onParamChange } = useAudioEngine(pyodide, forceScriptProcessorFallback)
    const isEngineReady = isReady && (isPyodideReady || !!pyodideStatus)

    // NEW: Automation View State
    const [viewMode, setViewMode] = useState<'notes' | 'automation'>('notes');
    const [automationParam, setAutomationParam] = useState('formantShift');

    const handleStart = async () => {
        console.log("Initialization sequence started...");
        try {
            // We set hasStarted immediately or use a timeout to ensure
            // the UI unblocks even if a non-critical engine part is slow.
            setHasStarted(true);

            await initializeAudio();
            setIsInitialized(true);
            console.log("Audio Engine Initialized");
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
    const [globalPan, setGlobalPan] = useState(0)

    const [isSongModeOpen, setIsSongModeOpen] = useState(false);
    const [isSongModeActive, setIsSongModeActive] = useState(false);
    const [songStructure, setSongStructure] = useState<({ [key in TrackKey]: number | null })[]>(
        Array(16).fill(null).map(() => ({
            partA: null, partB: null, kick: null, snare: null, closedHat: null, openHat: null, sampler: null
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
        partA: 0, partB: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: 0
    });
    const activeTrackSlotsRef = useRef(activeTrackSlots);
    useEffect(() => { activeTrackSlotsRef.current = activeTrackSlots; }, [activeTrackSlots]);

    const [songStorage, setSongStorage] = useState<(SongSnapshot | null)[]>([null, null, null, null]);
    const [activeSongSlot, setActiveSongSlot] = useState<number | null>(null);

    const [activeSamplerBank, setActiveSamplerBank] = useState(0);
    const activeSamplerBankRef = useRef(activeSamplerBank);
    useEffect(() => { activeSamplerBankRef.current = activeSamplerBank; }, [activeSamplerBank]);

    const [sampleBuffers, setSampleBuffers] = useState<(AudioBuffer | null)[]>(new Array(8).fill(null));
    const loadedBanks = useMemo(() => sampleBuffers.map(b => !!b), [sampleBuffers]);
    const [ttsPhrases, setTtsPhrases] = useState<string[]>(Array(8).fill("Hello World"));

    const [synthA, setSynthA] = useState<SynthParams>(DEFAULT_SYNTH_PARAMS_A);
    const synthARef = useRef<SynthParams>(DEFAULT_SYNTH_PARAMS_A);
    const updateSynthA = useCallback((updates: Partial<SynthParams>) => { setSynthA(prev => { const n = { ...prev, ...updates }; synthARef.current = n; return n; }); }, []);

    const [synthB, setSynthB] = useState<SynthParams>(DEFAULT_SYNTH_PARAMS_B);
    const synthBRef = useRef<SynthParams>(DEFAULT_SYNTH_PARAMS_B);
    const updateSynthB = useCallback((updates: Partial<SynthParams>) => { setSynthB(prev => { const n = { ...prev, ...updates }; synthBRef.current = n; return n; }); }, []);

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

    const onStep = useCallback((step: number) => {
        currentStepRef.current = step;

        // UPDATED: Use MainSequencer ref
        mainSequencerRef.current?.setHighlight(step);

        if (!audioEngine) return
        const time = audioEngine.context.currentTime
        let activePattern = patternRef.current;

        if (isSongModeActiveRef.current) {
            if (step === 0) {
                if (isFirstStepRef.current) {
                    isFirstStepRef.current = false;
                } else {
                    const nextM = songMeasureRef.current + 1;
                    if (nextM < songStructureRef.current.length) {
                        songMeasureRef.current = nextM;
                        setTimeout(() => setCurrentSongMeasure(nextM), 0);
                    } else {
                        songMeasureRef.current = 0;
                        setTimeout(() => setCurrentSongMeasure(0), 0);
                    }
                }
            }
            const currentMeasureIdx = songMeasureRef.current;
            const measureData = songStructureRef.current[currentMeasureIdx];
            if (measureData) {
                const getSeq = (key: TrackKey) => {
                    const slot = measureData[key];
                    if (slot === null) { return key === 'sampler' ? EMPTY_SAMPLER_SEQUENCE : EMPTY_SEQ; }
                    const stored = trackStorageRef.current[key][slot];
                    if (!stored) { return key === 'sampler' ? EMPTY_SAMPLER_SEQUENCE : EMPTY_SEQ; }
                    return stored;
                };
                activePattern = { partA: getSeq('partA'), partB: getSeq('partB'), kick: getSeq('kick'), snare: getSeq('snare'), closedHat: getSeq('closedHat'), openHat: getSeq('openHat'), sampler: getSeq('sampler') } as Pattern;
            }
        }

        const p = activePattern;
        const stepTime = 60 / tempo / 4;

        const triggerSynth = (trackKey: 'partA' | 'partB', params: SynthParams) => {
            const stepData = p[trackKey].steps[step];
            if (stepData) {
                // Probability Check
                if (stepData.probability !== undefined && Math.random() > stepData.probability) return;

                const currentBaseFreq = noteToFrequency(stepData.note) * Math.pow(2, params.pitch / 12);
                let slideFrom: number | undefined = undefined;
                if (stepData.slide && lastFreqRef.current[trackKey] > 0) { slideFrom = lastFreqRef.current[trackKey]; }
                const notes = stepData.chord ? [stepData.note, ...stepData.chord] : stepData.note;

                const noteParams = { timbre: stepData.timbre, microtiming: stepData.microtiming };

                audioEngine.playSynth(params, notes, time, stepData.length, stepTime, slideFrom, trackKey, noteParams);
                lastFreqRef.current[trackKey] = currentBaseFreq;
            }
        };

        triggerSynth('partA', synthARef.current);
        triggerSynth('partB', synthBRef.current);

        // Drums (Basic probability check)
        const playDrumIfActive = (trackKey: 'kick' | 'snare' | 'closedHat' | 'openHat', sound: any, params: any) => {
            const stepData = p[trackKey].steps[step];
            if (stepData) {
                 if (stepData.probability !== undefined && Math.random() > stepData.probability) return;
                 // Drums don't support timbre/microtiming yet in this simplified call, but we could add it
                 // For now just probability
                 audioEngine.playDrum(sound, params, time);
            }
        };

        playDrumIfActive('kick', 'kick', kickRef.current);
        playDrumIfActive('snare', 'snare', snareRef.current);
        playDrumIfActive('openHat', 'openHat', openHatRef.current);
        if (!p.openHat.steps[step]) playDrumIfActive('closedHat', 'closedHat', closedHatRef.current); // Only closed if open not playing

        p.sampler.forEach((seq, bankIdx) => {
            const stepData = seq.steps[step];
            if (stepData) {
                if (stepData.probability !== undefined && Math.random() > stepData.probability) return;
                const noteParams = { timbre: stepData.timbre, microtiming: stepData.microtiming, reverse: stepData.reverse, sliceIndex: stepData.sliceIndex };
                audioEngine.playSampler(samplerRef.current[bankIdx], stepData.note, time, stepData.length, stepTime, noteParams);
            }
        });

        // Visual Slice Feedback for Active Bank
        if (sliceHighlightRef.current) {
            const bankIdx = activeSamplerBankRef.current;
            const bankParams = samplerRef.current[bankIdx];

            // Only update if we are in Phoneme Slice Mode (and bank exists)
            if (bankParams && bankParams.sliceMode === 'phoneme') {
                 let activeSlice = -1;
                 // Look back to find sustaining note
                 for (let i = step; i >= Math.max(0, step - 15); i--) {
                     const s = patternRef.current.sampler[bankIdx]?.steps[i];
                     if (s && s.note) {
                         const len = s.length || 1;
                         if (i + len > step) {
                             if (s.sliceIndex !== undefined) {
                                 activeSlice = s.sliceIndex;
                             } else {
                                 activeSlice = noteToMidi(s.note) - 60;
                             }
                             break;
                         }
                     }
                 }
                 sliceHighlightRef.current(activeSlice);
            }
        }

        // Apply Automation
        if (onParamChange) {
            const bankIdx = activeSamplerBankRef.current;
            const bankSeq = p.sampler[bankIdx];
            if (bankSeq && bankSeq.automation) {
                // Formant Shift
                const formantVal = bankSeq.automation['formantShift']?.[step];
                if (formantVal !== undefined && formantVal !== null) {
                     // Map 0-1 to -12 to +12
                     const mapped = (formantVal * 24) - 12;
                     onParamChange(bankIdx, 'formantShift', mapped);
                }

                // Vibrato Depth
                const vibVal = bankSeq.automation['vibratoDepth']?.[step];
                if (vibVal !== undefined && vibVal !== null) {
                     onParamChange(bankIdx, 'vibratoDepth', vibVal * 100);
                }

                // Pitch Scale (e.g. 0.5 to 2.0) - centered at 0.5 (1.0)
                // Let's assume automation 0-1 maps to 0.5x to 2.0x?
                // Or just keep simple for now. Formant is main goal.
            }
        }

    }, [audioEngine, tempo, onParamChange])

    const { isPlaying: schedPlaying, setIsPlaying: setSchedPlaying } = useScheduler(tempo, NUM_STEPS, onStep, isEngineReady)
    useEffect(() => setIsPlaying(schedPlaying), [schedPlaying])

    // UPDATED: Ref for MainSequencer
    const mainSequencerRef = useRef<MainSequencerHandle>(null);
    const currentStepRef = useRef(-1);

    useEffect(() => {
        if (!schedPlaying) {
            songMeasureRef.current = 0;
            setCurrentSongMeasure(0);
            isFirstStepRef.current = true;
            // UPDATED: Use ref
            mainSequencerRef.current?.setHighlight(-1);
            currentStepRef.current = -1;
        }
    }, [schedPlaying]);

    const handlePlayToggle = async () => {
        if (!isInitialized) { await initializeAudio(); setIsInitialized(true); }
        setSchedPlaying(!schedPlaying)
    }

    const handleMasterVolume = (e: React.ChangeEvent<HTMLInputElement>) => { const v = parseFloat(e.target.value); setMasterVolume(v); audioEngine?.setMasterVolume(v); };
    const handleMasterVolumeKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setMasterVolume(0.8); audioEngine?.setMasterVolume(0.8); } };
    const handleMasterVolumeReset = () => { setMasterVolume(0.8); audioEngine?.setMasterVolume(0.8); };

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
        else if (selectedTrack === 'kick') audioEngine.playDrum('kick', { ...kickRef.current, pitch: 60 }, time);
        else if (selectedTrack === 'snare') audioEngine.playDrum('snare', snareRef.current, time);
        else if (selectedTrack === 'closedHat') audioEngine.playDrum('closedHat', closedHatRef.current, time);
        else if (selectedTrack === 'openHat') audioEngine.playDrum('openHat', openHatRef.current, time);
        else if (selectedTrack === 'sampler') { const bankParams = samplerRef.current[activeSamplerBank]; const id = audioEngine.noteOnSampler?.(bankParams, note, time) ?? null; if (id) activeKeyboardNotesRef.current.set(note, id); }
        const step = currentStepRef.current;
        if (isRecording && isPlaying && step >= 0) { setPattern(prev => { const copy = JSON.parse(JSON.stringify(prev)) as Pattern; if (selectedTrack === 'sampler') { copy.sampler[activeSamplerBank].steps[step] = { note, velocity: 1, length: 1 }; updateStorageForTrack('sampler', copy.sampler); } else { copy[selectedTrack].steps[step] = { note, velocity: 1, length: 1 }; updateStorageForTrack(selectedTrack, copy[selectedTrack]); } return copy; }); }
    }, [audioEngine, selectedTrack, isRecording, isPlaying, updateStorageForTrack, activeSamplerBank]);

    const handleKeyboardStop = useCallback((note: string) => { if (!audioEngine) return; const id = activeKeyboardNotesRef.current.get(note); if (!id) return; if (selectedTrack === 'partA' || selectedTrack === 'partB') { audioEngine.noteOffSynth?.(id); } else if (selectedTrack === 'sampler') { audioEngine.noteOffSampler?.(id); } activeKeyboardNotesRef.current.delete(note); }, [audioEngine, selectedTrack]);
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

    const handleNotePropertyChange = (key: 'timbre' | 'probability' | 'microtiming' | 'reverse', value: number | boolean) => {
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

    const handleClearPattern = () => { if (window.confirm("Clear current pattern?")) { const emptyPattern = { partA: { steps: Array(32).fill(null) }, partB: { steps: Array(32).fill(null) }, kick: { steps: Array(32).fill(null) }, snare: { steps: Array(32).fill(null) }, closedHat: { steps: Array(32).fill(null) }, openHat: { steps: Array(32).fill(null) }, sampler: Array.from({ length: 8 }, () => ({ steps: Array(32).fill(null) })), } as any as Pattern; setPattern(emptyPattern); setTrackStorage(prevStorage => { const storageCopy = { ...prevStorage }; (Object.keys(storageCopy) as TrackKey[]).forEach(key => { storageCopy[key] = [...storageCopy[key]]; storageCopy[key][activeTrackSlots[key]] = emptyPattern[key]; }); return storageCopy; }); } };
    const handleTrackSlotClick = useCallback((track: TrackKey, slotIndex: number) => { const currentTrackPattern = track === 'sampler' ? patternRef.current.sampler : patternRef.current[track]; const storedPattern = trackStorageRef.current[track][slotIndex]; if (storedPattern) { setPattern(prev => ({ ...prev, [track]: storedPattern })); setActiveTrackSlots(prev => ({ ...prev, [track]: slotIndex })); } else { setTrackStorage(prev => { const copy = { ...prev }; copy[track] = [...prev[track]]; copy[track][slotIndex] = currentTrackPattern; return copy; }); setActiveTrackSlots(prev => ({ ...prev, [track]: slotIndex })); } }, []);
    const handleSelectRow = useCallback((k: any) => setSelectedTrack(k as TrackKey), []);
    const handleEditLength = useCallback((k: TrackKey, i: number, len: number) => { handlePatternChange(k, i, undefined, { length: len }); }, [handlePatternChange]);
    const handleSongModeToggle = useCallback(() => setIsSongModeOpen(prev => !prev), []);
    const handleSongStructureUpdate = useCallback((idx: number, key: TrackKey, val: number | null) => { setSongStructure(prev => { const copy = [...prev]; copy[idx] = { ...copy[idx], [key]: val }; return copy; }); }, []);
    const handleAddMeasure = useCallback(() => setSongStructure(prev => [...prev, { partA: null, partB: null, kick: null, snare: null, closedHat: null, openHat: null, sampler: null }]), []);
    const handleExportXM = useCallback(() => { exportSongToXM(songStructureRef.current, trackStorageRef.current, { synthA: synthARef.current, synthB: synthBRef.current, kick: kickRef.current, snare: snareRef.current, closedHat: closedHatRef.current, openHat: openHatRef.current, sampler: samplerRef.current }, tempoRef.current, patternRef.current, { webGpuEngine: audioEngine?.webGpuEngine, wasmEngine: audioEngine?.wasmEngine, pyodide: pyodide }, sampleBuffers); }, [audioEngine, pyodide, sampleBuffers]);
    const handleRemoveMeasure = useCallback(() => { const currentStructure = songStructure; if (currentStructure.length === 0) return; const last = currentStructure[currentStructure.length - 1]; const hasData = Object.values(last).some(v => v !== null); if (hasData) { if (!window.confirm("The last measure contains patterns. Are you sure you want to remove it?")) return; } setSongStructure(prev => prev.slice(0, -1)); }, [songStructure]);
    const handleLoadSample = useCallback((name: string, buffer: AudioBuffer) => {
        if (!audioEngine) return;
        audioEngine.loadSampleToEngine(name, buffer);
        setSampleBuffers(prev => { const next = [...prev]; next[activeSamplerBank] = buffer; return next; });
        const bankName = `bank_${activeSamplerBank}`;
        setSampler(prev => { const newParams = [...prev]; newParams[activeSamplerBank] = { ...newParams[activeSamplerBank], sampleName: bankName }; return newParams; });

        if (audioEngine.prepareVocal) {
            const text = ttsPhrases[activeSamplerBank] || "Hello World";
            audioEngine.prepareVocal(activeSamplerBank, text);
        }
    }, [audioEngine, activeSamplerBank, ttsPhrases]);

    const handleSaveSong = async (slot: number) => { const encodedSamples: { [k: number]: string } = {}; await Promise.all(sampleBuffers.map(async (buf, idx) => { if (buf) { const wavBlob = audioBufferToWav(buf); const b64 = await blobToBase64(wavBlob); encodedSamples[idx] = b64; } })); const snapshot: SongSnapshot = { pattern, tempo, ambianceUrl, backgroundImage, params: { synthA, synthB, kick, snare, closedHat, openHat, sampler } }; setSongStorage(prev => { const copy = [...prev]; copy[slot] = snapshot; return copy; }); setActiveSongSlot(slot); };
    const loadSong = useCallback((slot: number) => { const snapshot = songStorage[slot]; if (!snapshot) return; setPattern(snapshot.pattern); setTempo(snapshot.tempo); setAmbianceUrl(snapshot.ambianceUrl); setBackgroundImage(snapshot.backgroundImage); setSynthA(snapshot.params.synthA); setSynthB(snapshot.params.synthB); setKick(snapshot.params.kick); setSnare(snapshot.params.snare); setClosedHat(snapshot.params.closedHat); setOpenHat(snapshot.params.openHat); setSampler(snapshot.params.sampler); setActiveSongSlot(slot); synthARef.current = snapshot.params.synthA; synthBRef.current = snapshot.params.synthB; kickRef.current = snapshot.params.kick; snareRef.current = snapshot.params.snare; closedHatRef.current = snapshot.params.closedHat; openHatRef.current = snapshot.params.openHat; samplerRef.current = snapshot.params.sampler; }, [songStorage]);
    const getSongData = useCallback(async () => { const encodedSamples: { [k: number]: string } = {}; await Promise.all(sampleBuffers.map(async (buf, idx) => { if (buf) { const wavBlob = audioBufferToWav(buf); const b64 = await blobToBase64(wavBlob); encodedSamples[idx] = b64; } })); return { version: 1, pattern: patternRef.current, tempo: tempoRef.current, ambianceUrl, backgroundImage, params: { synthA: synthARef.current, synthB: synthBRef.current, kick: kickRef.current, snare: snareRef.current, closedHat: closedHatRef.current, openHat: openHatRef.current, sampler: samplerRef.current }, trackStorage: trackStorageRef.current, activeTrackSlots: activeTrackSlotsRef.current, songStructure: songStructureRef.current, embeddedSamples: encodedSamples, ttsPhrases } as SavedSongData; }, [ambianceUrl, backgroundImage, sampleBuffers, ttsPhrases]);
    const getBankData = useCallback(() => { return { type: 'bank', trackStorage }; }, [trackStorage]);
    const getPatternData = useCallback(() => { return { type: 'pattern', pattern }; }, [pattern]);
    const loadCloudData = useCallback(async (data: any, type: CloudItemType) => { console.log("Loading Cloud Data:", type, data); if (type === 'song') { const songData = data as SavedSongData; if (songData.pattern) setPattern(songData.pattern); if (songData.tempo) setTempo(songData.tempo); if (songData.ambianceUrl !== undefined) setAmbianceUrl(songData.ambianceUrl); if (songData.backgroundImage !== undefined) setBackgroundImage(songData.backgroundImage); if (songData.params) { if (songData.params.synthA) { setSynthA(songData.params.synthA); synthARef.current = songData.params.synthA; } if (songData.params.synthB) { setSynthB(songData.params.synthB); synthBRef.current = songData.params.synthB; } if (songData.params.kick) { setKick(songData.params.kick); kickRef.current = songData.params.kick; } if (songData.params.snare) { setSnare(songData.params.snare); snareRef.current = songData.params.snare; } if (songData.params.closedHat) { setClosedHat(songData.params.closedHat); closedHatRef.current = songData.params.closedHat; } if (songData.params.openHat) { setOpenHat(songData.params.openHat); openHatRef.current = songData.params.openHat; } if (songData.params.sampler) { const samplerWithMode = songData.params.sampler.map(bank => ({ ...bank, mode: (bank.mode || 'loop') as 'loop' | 'stretch' | 'wavetable' })); setSampler(samplerWithMode); samplerRef.current = samplerWithMode; } } if (songData.trackStorage) setTrackStorage(songData.trackStorage as unknown as Record<TrackKey, (PartSequence | PartSequence[] | null)[]>); if (songData.activeTrackSlots) setActiveTrackSlots(songData.activeTrackSlots as unknown as Record<TrackKey, number>); if (songData.songStructure) setSongStructure(songData.songStructure as unknown as ({ [key in TrackKey]: number | null })[]); if (songData.ttsPhrases && Array.isArray(songData.ttsPhrases) && songData.ttsPhrases.length === 8) { setTtsPhrases(songData.ttsPhrases); } else if (songData.ttsPhrases && Array.isArray(songData.ttsPhrases)) { const normalized = Array(8).fill("Hello World"); songData.ttsPhrases.forEach((phrase, idx) => { if (idx < 8) normalized[idx] = phrase || "Hello World"; }); setTtsPhrases(normalized); } else { setTtsPhrases(Array(8).fill("Hello World")); } if (songData.embeddedSamples && audioEngine) { const loadedBuffers = new Array(8).fill(null); await Promise.all(Object.entries(songData.embeddedSamples).map(async ([idx, b64]) => { try { const fetchRes = await fetch(b64); const arrayBuf = await fetchRes.arrayBuffer(); const audioBuf = await audioEngine.context.decodeAudioData(arrayBuf); const bankIdx = parseInt(idx); const bankName = `bank_${bankIdx}`; audioEngine.loadSampleToEngine(bankName, audioBuf); loadedBuffers[bankIdx] = audioBuf; } catch (e) { console.error(`Failed to load sample bank ${idx}`, e); } })); setSampleBuffers(loadedBuffers); } showToast("Song loaded!", "success"); } else if (type === 'bank') { if (data.trackStorage) { setTrackStorage(data.trackStorage); showToast("Pattern Bank loaded!", "success"); } } else if (type === 'pattern') { if (data.pattern) { setPattern(data.pattern); showToast("Pattern loaded!", "success"); } } }, [audioEngine, sampleBuffers, showToast]);
    const exportSongToFile = useCallback(async () => { const songData = await getSongData(); const jsonStr = JSON.stringify(songData, null, 2); const blob = new Blob([jsonStr], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `hyphon-song-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); }, [getSongData]);
    const importSongFromFile = useCallback(() => { const input = document.createElement('input'); input.type = 'file'; input.accept = '.json'; input.onchange = async (e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (!file) return; try { const text = await file.text(); const songData = JSON.parse(text); await loadCloudData(songData, 'song'); } catch (err) { console.error('Failed to load song:', err); showToast("Failed to load song file.", "error"); } }; input.click(); }, [loadCloudData, showToast]);

    const handleSynthChange = useCallback((isA: boolean, id: string, val: number) => { const updater = isA ? updateSynthA : updateSynthB; let realVal = val; if (id === 'pitch') realVal = Math.floor(val * 48 - 24); else if (id === 'filterCutoff') realVal = val * 8000; else if (id === 'filterResonance') realVal = val * 20; else if (id === 'filterMode') realVal = Math.round(val); else if (id === 'decay') realVal = val * 2; else if (id === 'release') realVal = val * 2; else if (id === 'length') realVal = val * 2; updater({ [id]: realVal }); }, [updateSynthA, updateSynthB]);
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
            audioEngine.prepareVocal(activeSamplerBank, text);
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

    const handleLyricApply = useCallback(async (text: string, mapToSelection: boolean) => {
        try {
            await handleGenerateTTS(text);

            // Update phrases state
            const newPhrases = [...ttsPhrases];
            newPhrases[activeSamplerBankRef.current] = text;
            setTtsPhrases(newPhrases);

            if (mapToSelection && selection && selection.trackKey === 'sampler') {
                const { startStep, endStep } = selection;
                const low = Math.min(startStep, endStep);
                const high = Math.max(startStep, endStep);

                const prev = patternRef.current;
                const copy = JSON.parse(JSON.stringify(prev)) as Pattern;
                const bankIdx = activeSamplerBankRef.current;
                const bank = copy.sampler[bankIdx];

                let noteIndex = 0;
                for (let i = low; i <= high; i++) {
                    if (!bank.steps[i]) {
                         bank.steps[i] = { note: 'C4', velocity: 1, length: 1 };
                    }
                    if (bank.steps[i]) {
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

                showToast("Lyrics Mapped!", "success");
            }
        } catch (e) {
            // Error handled in handleGenerateTTS
        }
    }, [handleGenerateTTS, ttsPhrases, selection, setPattern, setSampler, updateStorageForTrack, showToast]);

    const onSynthAParamChange = useCallback((id: string, v: number) => handleSynthChange(true, id, v), [handleSynthChange]);
    const onSynthBParamChange = useCallback((id: string, v: number) => handleSynthChange(false, id, v), [handleSynthChange]);

    const synthAControls = useStableKnobConfig(getSynthControls, synthA);
    const synthBControls = useStableKnobConfig(getSynthControls, synthB);
    const kickControls = useStableKnobConfig(getKickControls, kick);
    const snareControls = useStableKnobConfig(getSnareControls, snare);
    const closedHatControls = useStableKnobConfig(getClosedHatControls, closedHat);
    const openHatControls = useStableKnobConfig(getOpenHatControls, openHat);
    const samplerControls = useStableKnobConfig(getSamplerControls, sampler[activeSamplerBank]);

    const synthAChild = useMemo(() => (<div className="absolute top-4 right-6 pointer-events-auto"><WaveformSelector selected={synthA.waveform} onChange={(w) => updateSynthA({ waveform: w })} accentColor="cyan" /></div>), [synthA.waveform, updateSynthA]);
    const synthBChild = useMemo(() => (<div className="absolute top-4 right-6 pointer-events-auto"><WaveformSelector selected={synthB.waveform} onChange={(w) => updateSynthB({ waveform: w })} accentColor="pink" /></div>), [synthB.waveform, updateSynthB]);
    const samplerChild = useMemo(() => (<div className="absolute top-2 left-[25%] w-[50%] max-h-[280px] h-auto pointer-events-auto z-10 bg-gray-900/90 rounded-lg border border-purple-500/30 backdrop-blur-sm overflow-hidden"><SamplerPanel params={sampler} onChange={(u) => updateSampler(u)} onParamChange={handleSamplerParamChange} onLoadSample={handleLoadSample} audioContext={audioEngine?.context!} audioEngine={audioEngine || undefined} activeBankIdx={activeSamplerBank} onBankChange={setActiveSamplerBank} onOpenEditor={() => setIsVoiceEditorOpen(true)} ttsPhrases={ttsPhrases} onTtsPhraseChange={handleTtsPhraseChange} onGenerateTTS={handleGenerateTTS} loadedBanks={loadedBanks} sampleBuffer={sampleBuffers[activeSamplerBank]} sliceHighlightRef={sliceHighlightRef} /></div>), [sampler, updateSampler, handleSamplerParamChange, audioEngine, setIsVoiceEditorOpen, activeSamplerBank, handleLoadSample, ttsPhrases, handleGenerateTTS, loadedBanks, sampleBuffers]);

    // --- RENDER PARTS FOR 3D ---
    // Extract parts so they can be passed to either normal view or 3D view

    // PERFORMANCE: Memoize main UI sections to prevent unnecessary VDOM regeneration
    // when unrelated state updates (e.g. playing a sequence vs editing a pattern).
    const headerNode = useMemo(() => (
        <header className="h-16 flex items-center justify-between px-6 bg-gradient-to-r from-[#0b0d10] to-[#0d0f12] border-b-2 border-cyan-900/30 shadow-2xl shrink-0 relative backdrop-blur-sm w-full">
            <div className="flex items-center gap-6">
                <h1 className="text-xl font-bold font-orbitron text-cyan-400 tracking-widest hidden md:block drop-shadow-[0_0_10px_rgba(6,182,212,0.5)]">HYPHON</h1>
                <div className="flex items-center gap-2 bg-gradient-to-r from-gray-900 to-gray-800 p-2 rounded-lg border border-cyan-900/30 shadow-lg">
                    <span className="text-[10px] text-gray-500 font-mono uppercase px-1">Song</span>
                    {[0, 1, 2, 3].map(slot => {
                        const isSaved = !!songStorage[slot];
                        const isActive = activeSongSlot === slot;
                        return (<button key={slot} onClick={() => { if (isSaved) loadSong(slot); else handleSaveSong(slot); }} onContextMenu={(e) => { e.preventDefault(); handleSaveSong(slot); }} className={`w-6 h-6 text-xs font-mono rounded transition-all ${isActive ? 'bg-cyan-600 text-white shadow-[0_0_10px_rgba(6,182,212,0.5)]' : (isSaved ? 'bg-cyan-900/30 text-cyan-400 border border-cyan-900' : 'bg-gray-800 text-gray-600 border border-gray-700')}`} aria-label={`Song Slot ${slot + 1}`} aria-pressed={isActive}>{slot + 1}</button>);
                    })}
                </div>
                {/* File Ops */}
                <div className="flex items-center gap-1">
                    <button onClick={exportSongToFile} className="text-[10px] font-bold text-green-400 bg-gradient-to-r from-green-900/10 to-green-900/20 px-2 py-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400" aria-label="Save Song to File" title="Save to JSON">💾</button>
                    <button onClick={importSongFromFile} className="text-[10px] font-bold text-blue-400 bg-gradient-to-r from-blue-900/10 to-blue-900/20 px-2 py-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400" aria-label="Load Song from File" title="Load from JSON">📂</button>
                    <button onClick={() => setIsCloudLibraryOpen(true)} className="text-[10px] font-bold text-purple-400 bg-gradient-to-r from-purple-900/10 to-purple-900/20 px-2 py-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400" aria-label="Open Cloud Library" title="Cloud Library">☁️</button>
                    <CloudStatus />
                </div>
                <button onClick={handleClearPattern} className="text-xs font-bold text-red-400 border border-red-900/50 bg-gradient-to-r from-red-900/10 to-red-900/20 px-4 py-2 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400" aria-label="Clear Current Pattern" title="Clear Current Pattern">CLEAR</button>
            </div>

            <div className="flex items-center gap-4">
                {/* Volume & Pan */}
                <div className="flex items-center gap-2 mr-4">
                    <label htmlFor="master-volume" className="text-[10px] text-gray-500 font-mono uppercase">Vol</label>
                    <div className="flex items-center gap-1">
                        <input id="master-volume" type="range" min="0" max="1.2" step="0.01" value={masterVolume} onChange={handleMasterVolume} onKeyDown={handleMasterVolumeKeyDown} className="w-24 h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-500" aria-label="Master Volume" />
                        {Math.abs(masterVolume - 0.8) > 0.01 && (
                            <button onClick={handleMasterVolumeReset} className="text-gray-500 hover:text-white px-1 text-[10px]" aria-label="Reset Volume" title="Reset to 80%">✕</button>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2 mr-4">
                    <label htmlFor="global-pan" className="text-[10px] text-gray-500 font-mono uppercase">Pan</label>
                    <div className="flex items-center gap-1">
                        <input id="global-pan" type="range" min="-1" max="1" step="0.01" value={globalPan} onChange={handleGlobalPan} onKeyDown={handleGlobalPanKeyDown} className="w-24 h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-500" aria-label="Global Pan" />
                        {Math.abs(globalPan) > 0.01 && (
                            <button onClick={handleGlobalPanReset} className="text-gray-500 hover:text-white px-1 text-[10px]" aria-label="Reset Pan" title="Reset to Center">✕</button>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="flex items-center bg-gray-900 rounded border border-gray-700 scale-90">
                        <button
                            onMouseDown={() => handleTempoHoldStart(-1)}
                            onMouseUp={handleTempoHoldEnd}
                            onMouseLeave={handleTempoHoldEnd}
                            onKeyDown={(e) => handleTempoKeyDown(e, -1)}
                            className="px-2 py-1 text-cyan-500 font-bold border-r border-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                            aria-label="Decrease Tempo"
                        >-</button>
                        <span className="w-12 text-center font-mono text-cyan-300 text-sm" role="status" aria-live="polite" aria-label={`Tempo: ${tempo} BPM`}>{tempo}</span>
                        <button
                            onMouseDown={() => handleTempoHoldStart(1)}
                            onMouseUp={handleTempoHoldEnd}
                            onMouseLeave={handleTempoHoldEnd}
                            onKeyDown={(e) => handleTempoKeyDown(e, 1)}
                            className="px-2 py-1 text-cyan-500 font-bold border-l border-gray-700 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                            aria-label="Increase Tempo"
                        >+</button>
                    </div>
                </div>
                <button onClick={handlePanic} aria-label="Panic Stop All Notes" className="w-8 h-8 rounded-full bg-red-900/50 text-red-500 flex items-center justify-center font-bold text-xs mr-2">!</button>
                <button onClick={() => setIsRecording(!isRecording)} aria-pressed={isRecording} aria-label="Toggle Recording" className={`w-12 py-1 rounded font-orbitron text-sm font-bold tracking-wide mr-2 ${isRecording ? 'bg-red-600 text-white animate-pulse' : 'bg-gray-800 text-red-700'}`}>REC</button>
                <button onClick={() => setIsLyricMapperOpen(!isLyricMapperOpen)} aria-pressed={isLyricMapperOpen} aria-label="Open Lyric Mapper" className={`w-20 py-1 rounded font-orbitron text-sm font-bold tracking-wide mr-2 ${isLyricMapperOpen ? 'bg-cyan-900/40 text-cyan-300' : 'bg-gray-800 text-gray-400'}`}>LYRICS</button>
                <button onClick={() => setIsSongModeOpen(!isSongModeOpen)} aria-pressed={isSongModeOpen} aria-label="Toggle Song Mode" className={`w-24 py-1 rounded font-orbitron text-sm font-bold tracking-wide mr-2 ${isSongModeOpen ? 'bg-purple-900/40 text-purple-300' : 'bg-gray-800 text-gray-400'}`}>SONG</button>
                <button onClick={handlePlayToggle} aria-pressed={isPlaying} aria-label={isPlaying ? "Stop Playback" : "Start Playback"} className={`w-24 py-1 rounded font-orbitron text-sm font-bold tracking-wide ${isPlaying ? 'bg-red-900/20 text-red-400' : 'bg-green-900/20 text-green-400'}`}>{isPlaying ? 'STOP' : 'PLAY'}</button>

                {/* VIEW MODE TOGGLE */}
                <div className="ml-2 flex items-center bg-gray-900 rounded border border-gray-700">
                    <button
                        onClick={() => setViewMode('notes')}
                        className={`px-3 py-1 text-[10px] font-bold ${viewMode === 'notes' ? 'bg-cyan-900/50 text-cyan-400' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        NOTES
                    </button>
                    <button
                        onClick={() => setViewMode('automation')}
                        className={`px-3 py-1 text-[10px] font-bold ${viewMode === 'automation' ? 'bg-pink-900/50 text-pink-400' : 'text-gray-500 hover:text-gray-300'}`}
                    >
                        AUTO
                    </button>
                </div>
                {viewMode === 'automation' && (
                     <select
                        value={automationParam}
                        onChange={(e) => setAutomationParam(e.target.value)}
                        className="ml-2 bg-gray-900 text-xs text-gray-300 border border-gray-700 rounded px-2 py-1 outline-none focus:border-cyan-500"
                     >
                         <option value="formantShift">Formant</option>
                         <option value="vibratoDepth">Vibrato</option>
                     </select>
                )}

                {/* 3D TOGGLE */}
                <button
                    onClick={() => setIs3DMode(!is3DMode)}
                    aria-pressed={is3DMode}
                    aria-label="Toggle 3D Studio View"
                    className={`ml-2 px-3 py-1 rounded font-orbitron text-xs font-bold border transition-all ${is3DMode ? 'bg-cyan-600 text-white border-cyan-400 shadow-[0_0_10px_cyan]' : 'bg-gray-800 text-cyan-500 border-cyan-900'}`}
                >
                    3D
                </button>

                {/* Gamepad Debug Toggle */}
                <button
                    onClick={() => setShowGamepadDebug(true)}
                    className="ml-2 p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 transition-colors border border-transparent hover:border-slate-600"
                    title="Gamepad Debugger"
                >
                    <span role="img" aria-label="joystick" className="text-lg">🎮</span>
                </button>
                
                {/* AudioWorklet Fallback Toggle */}
                <button
                    onClick={() => {
                        const newValue = !forceScriptProcessorFallback;
                        setForceScriptProcessorFallback(newValue);
                        // Persist preference to localStorage
                        localStorage.setItem('forceScriptProcessorFallback', String(newValue));
                        showToast(
                            newValue
                                ? "ScriptProcessor fallback enabled. Refresh page to apply." 
                                : "AudioWorklet mode enabled. Refresh page to apply.",
                            'success'
                        );
                    }}
                    className={`ml-2 px-2 py-1 rounded text-xs font-mono border transition-all ${forceScriptProcessorFallback ? 'bg-yellow-900/20 text-yellow-400 border-yellow-900/50' : 'bg-gray-800 text-gray-500 border-gray-700'}`}
                    title={forceScriptProcessorFallback ? "Using ScriptProcessor fallback (click to disable)" : "Using AudioWorklet (click to force fallback)"}
                >
                    {forceScriptProcessorFallback ? '⚠️ FALLBACK' : '🔊 AWN'}
                </button>
            </div>
        </header>
    ), [is3DMode, forceScriptProcessorFallback, songStorage, activeSongSlot, masterVolume, globalPan, tempo, isRecording, isPlaying, isSongModeOpen, loadSong, handleSaveSong, exportSongToFile, importSongFromFile, handleClearPattern, handleMasterVolume, handleMasterVolumeKeyDown, handleGlobalPan, handleGlobalPanKeyDown, handleTempoHoldStart, handleTempoHoldEnd, handleTempoKeyDown, handlePanic, handlePlayToggle, setIsRecording, setIsSongModeOpen, setIs3DMode, setIsCloudLibraryOpen, showToast]);

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
                ref={mainSequencerRef}
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
            >
                {contextMenu && (
                    <div style={{ position: 'fixed', top: 0, left: 0, zIndex: 9999 }}>
                        <NoteSelector
                            x={contextMenu.x} y={contextMenu.y} trackType={(contextMenu.track.startsWith('part') || contextMenu.track === 'sampler') ? 'synth' : 'drum'}
                            currentNote={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.note ?? '' : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.note ?? ''}
                            currentLength={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.length ?? 1 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.length ?? 1}
                            currentTimbre={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.timbre ?? 0 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.timbre ?? 0}
                            currentProbability={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.probability ?? 1 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.probability ?? 1}
                            currentMicrotiming={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.microtiming ?? 0 : pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.microtiming ?? 0}
                            currentReverse={contextMenu.track === 'sampler' ? pattern.sampler[activeSamplerBank]?.steps[contextMenu.step]?.reverse ?? false : false}
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
    }, [isSongModeOpen, is3DMode, songStructure, currentSongMeasure, backgroundImage, isSongModeActive, pattern, activeSamplerBank, selectedTrack, activeTrackSlots, trackStorage, contextMenu, selection, isDrawing, handleSongModeToggle, handleSongStructureUpdate, handleAddMeasure, handleRemoveMeasure, handleExportXM, setIsSongModeActive, setBackgroundImage, handleStepToggle, handleRightMouseDown, handleEditLength, handleSelectRow, handleTrackSlotClick, handleNoteSelect, handleNoteLengthChange, handleSelectionStart, handleSelectionEnter, handleDrawEnter]);

    const keyboardNode = useMemo(() => (
        <div className="w-full bg-[#0d1015] border-2 border-gray-700/50 rounded-xl overflow-hidden shadow-2xl p-2">
            <LiveKeyboard onPlayNote={handleKeyboardPlay} onStopNote={handleKeyboardStop} activeTrackColor={selectedTrack.startsWith('part') ? (selectedTrack === 'partA' ? '#06b6d4' : '#d946ef') : selectedTrack === 'kick' ? '#f97316' : selectedTrack === 'snare' ? '#22c55e' : selectedTrack === 'sampler' ? '#a855f7' : '#eab308'} />
        </div>
    ), [selectedTrack, handleKeyboardPlay, handleKeyboardStop]);

    const rackNode = useMemo(() => {
        // PERFORMANCE: Inline conditional rendering to avoid dependency on unstable function reference.
        // This ensures the Rack only re-renders when relevant props/state change.
        let modulePanel = null;
        if (selectedTrack === 'partA') modulePanel = <HardwareModule title="SYNTH A // LEAD" colorHex={COLOR_LEAD} controls={synthAControls} onParamChange={onSynthAParamChange} is3D={is3DMode}>{synthAChild}</HardwareModule>;
        else if (selectedTrack === 'partB') modulePanel = <HardwareModule title="SYNTH B // BASS" colorHex={COLOR_BASS} controls={synthBControls} onParamChange={onSynthBParamChange} is3D={is3DMode}>{synthBChild}</HardwareModule>;
        else if (selectedTrack === 'kick') modulePanel = <HardwareModule title="KICK DRUM" colorHex={COLOR_KICK} controls={kickControls} onParamChange={handleKickChange} is3D={is3DMode} />;
        else if (selectedTrack === 'snare') modulePanel = <HardwareModule title="SNARE DRUM" colorHex={COLOR_SNARE} controls={snareControls} onParamChange={handleSnareChange} is3D={is3DMode} />;
        else if (selectedTrack === 'closedHat') modulePanel = <HardwareModule title="CLOSED HAT" colorHex={COLOR_CH} controls={closedHatControls} onParamChange={handleClosedHatChange} is3D={is3DMode} />;
        else if (selectedTrack === 'openHat') modulePanel = <HardwareModule title="OPEN HAT" colorHex={COLOR_OH} controls={openHatControls} onParamChange={handleOpenHatChange} is3D={is3DMode} />;
        else if (selectedTrack === 'sampler') { modulePanel = (<HardwareModule title={`SAMPLER // BANK ${activeSamplerBank + 1}`} colorHex={COLOR_SAMPLER} controls={samplerControls} onParamChange={handleSamplerChange} is3D={is3DMode}>{samplerChild}</HardwareModule>); }

        return (
            <div className="w-full h-full bg-gradient-to-br from-black to-[#0a0c0f] rounded-2xl border-2 border-gray-700 relative flex flex-col">
                <div className="absolute inset-0 rounded-2xl border-2 border-cyan-900/10 pointer-events-none"></div>

                {is3DMode && (
                    <div className="flex items-center justify-center gap-2 p-2 bg-[#050709] border-b border-gray-800 shrink-0 z-50 relative pointer-events-auto">
                        {ROWS.map(row => (
                            <button
                                key={row.key}
                                onClick={() => setSelectedTrack(row.key)}
                                className={`px-4 py-2 rounded text-xs font-bold font-orbitron border transition-all ${selectedTrack === row.key ? 'bg-cyan-900/50 text-cyan-400 border-cyan-500 shadow-[0_0_10px_cyan]' : 'bg-gray-800 text-gray-500 border-gray-700 hover:bg-gray-700 hover:text-gray-300'}`}
                            >
                                {row.label.toUpperCase()}
                            </button>
                        ))}
                    </div>
                )}

                <div className="flex-1 relative">
                    {modulePanel}
                </div>
            </div>
        );
    }, [is3DMode, selectedTrack, activeSamplerBank, synthAControls, synthBControls, kickControls, snareControls, closedHatControls, openHatControls, samplerControls, onSynthAParamChange, onSynthBParamChange, handleKickChange, handleSnareChange, handleClosedHatChange, handleOpenHatChange, handleSamplerChange, synthAChild, synthBChild, samplerChild]);

    // --- MAIN RENDER ---
    if (is3DMode) {
        return (
            <Suspense fallback={<div className="flex items-center justify-center h-screen w-screen bg-black text-cyan-400 font-orbitron text-xl tracking-widest animate-pulse">LOADING 3D STUDIO...</div>}>
                <Studio3D
                    header={headerNode}
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
            {/* SEQUENCER_STYLES is now inside MainSequencer */}
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
            {backgroundImage && <div className="absolute inset-0 bg-black/60 pointer-events-none z-0"></div>}
            {!hasStarted && <StartOverlay onStart={handleStart} isReady={isPyodideReady} />}
            <CloudLibrary isOpen={isCloudLibraryOpen} onClose={() => setIsCloudLibraryOpen(false)} onLoadData={loadCloudData} onShowToast={showToast} getSongData={getSongData} getBankData={getBankData} getPatternData={getPatternData} />
            <LyricMapper isOpen={isLyricMapperOpen} onClose={() => setIsLyricMapperOpen(false)} onApply={handleLyricApply} initialText={ttsPhrases[activeSamplerBank] || ""} isGenerating={isGenerating} hasSelection={!!selection && selection.trackKey === 'sampler'} />
            {isVoiceEditorOpen && (<VoiceEditor onClose={() => setIsVoiceEditorOpen(false)} />)}
            {showGamepadDebug && (<GamepadDebugger onClose={() => setShowGamepadDebug(false)} />)}

            {/* Standard 2D Layout */}
            {headerNode}
            <SongMode isVisible={isSongModeOpen} songStructure={songStructure} currentSongStep={currentSongMeasure} backgroundImage={backgroundImage} onSetBackgroundImage={setBackgroundImage} onToggle={handleSongModeToggle} onUpdateStep={handleSongStructureUpdate} onAddMeasure={handleAddMeasure} onRemoveMeasure={handleRemoveMeasure} onExportXM={handleExportXM} isSongModeActive={isSongModeActive} onSetIsSongModeActive={setIsSongModeActive} />

            <main className="flex-1 relative bg-gradient-to-b from-[#0a0e14] via-[#111827] to-[#050709] shadow-inner flex flex-col justify-start pt-10 pb-6 z-10">
                <div className="w-full max-w-[1000px] mx-auto h-[480px]">
                    {sequencerNode}
                </div>
                <div className="shrink-0 pb-4 mt-6 max-w-[1000px] mx-auto w-full">
                    {keyboardNode}
                </div>
            </main>

            <div className="h-[320px] bg-gradient-to-b from-[#0d0f12] to-[#0f1215] border-t-2 border-cyan-900/30 relative shadow-[0_-10px_60px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(6,182,212,0.1)] z-30 shrink-0 fixed bottom-0 w-full">
                <div className="absolute top-0 left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent"></div>
                <div className="w-full h-full max-w-6xl mx-auto p-4 flex items-center justify-center">
                    {rackNode}
                </div>
            </div>
        </div>
    )
}

export default App
