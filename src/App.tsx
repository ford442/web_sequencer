import React, { useCallback, useEffect, useRef, useState, memo, useMemo } from 'react'
import { useAudioEngine } from './hooks/useAudioEngine'
import { usePyodideEngine } from './hooks/usePyodideEngine'
import { useScheduler } from './hooks/useScheduler'
import { HardwareModule } from './components/HardwareModule';
import type { KnobConfig } from './components/HardwareModule';
import { WaveformSelector } from './components/WaveformSelector';
import { NoteSelector } from './components/NoteSelector';
import { LiveKeyboard } from './components/LiveKeyboard';

import { VoiceEditor } from './components/VoiceEditor';
import { SamplerPanel } from './components/SamplerPanel';
import { GridIndicators } from './components/GridIndicators';
import { SongMode } from './components/SongMode';
import { CloudLibrary } from './components/CloudLibrary';
import { CloudStatus } from './components/CloudStatus';
import type { CloudItemType } from './services/CloudStorage';
import { exportSongToXM } from './utils/xmExport';
import { getNoteColor } from './utils/noteColors';
import { noteToMidi, midiToNote } from './utils/musicTheory';
import {
    INITIAL_PATTERN,
    NUM_STEPS,
    DEFAULT_TEMPO,
    DEFAULT_SYNTH_PARAMS_A,
    DEFAULT_SYNTH_PARAMS_B,
    DEFAULT_KICK_PARAMS,
    DEFAULT_SNARE_PARAMS,
    DEFAULT_CLOSED_HAT_PARAMS,
    DEFAULT_OPEN_HAT_PARAMS,
    DEFAULT_SAMPLER_PARAMS,
} from './constants'
import type { Pattern, SynthParams, KickParams, SnareParams, SamplerParams, PartSequence } from './types'

// --- TYPES FOR STORAGE ---
type TrackKey = 'partA' | 'partB' | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'sampler';
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

const getInitialTrackStorage = (initialPattern: Pattern): Record<TrackKey, (PartSequence | null)[]> => {
    const storage: Record<TrackKey, (PartSequence | null)[]> = {
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

// Map pattern slot numbers (0-7) to note colors (C4, D4, E4, F4, G4, A4, B4, C5)
const PATTERN_NOTES = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const getPatternColor = (slotIndex: number): string => {
    return getNoteColor(PATTERN_NOTES[slotIndex % PATTERN_NOTES.length]);
};

// --- CONSTANTS FOR MODULE RENDERING ---
const COLOR_LEAD = [0.0, 0.9, 1.0] as [number, number, number];
const COLOR_BASS = [1.0, 0.2, 0.8] as [number, number, number];
const COLOR_KICK = [1.0, 0.6, 0.0] as [number, number, number];
const COLOR_SNARE = [0.2, 1.0, 0.2] as [number, number, number];
const COLOR_CH = [0.8, 0.8, 0.0] as [number, number, number];
const COLOR_OH = [0.9, 0.5, 0.0] as [number, number, number];
const COLOR_SAMPLER = [0.6, 0.4, 1.0] as [number, number, number];

// --- MODULE CONTROL HELPERS ---
const getSynthControls = (params: SynthParams): KnobConfig[] => [
    { id: 'attack', label: 'ATK', x: 0.20, y: 0.25, size: 0.08, value: params.attack },
    { id: 'decay', label: 'DEC', x: 0.35, y: 0.25, size: 0.08, value: params.decay / 2 },
    { id: 'sustain', label: 'SUS', x: 0.50, y: 0.25, size: 0.08, value: params.sustain },
    { id: 'release', label: 'REL', x: 0.65, y: 0.25, size: 0.08, value: params.release / 2 },
    { id: 'filterCutoff', label: 'CUTOFF', x: 0.35, y: 0.60, size: 0.12, value: params.filterCutoff / 8000 },
    { id: 'filterResonance', label: 'RES', x: 0.50, y: 0.60, size: 0.12, value: params.filterResonance / 20 },
    { id: 'pitch', label: 'TUNE', x: 0.10, y: 0.50, size: 0.09, value: (params.pitch + 24) / 48 },
    { id: 'length', label: 'GATE', x: 0.75, y: 0.50, size: 0.09, value: (params.length || 0.25) / 2 },
    { id: 'volume', label: 'LEVEL', x: 0.90, y: 0.50, size: 0.10, value: params.volume },
    { id: 'delayMix', label: 'DLY MIX', x: 0.85, y: 0.80, size: 0.07, value: params.delayMix },
    { id: 'delayTime', label: 'DLY TIME', x: 0.95, y: 0.80, size: 0.07, value: params.delayTime },
];
const getKickControls = (params: KickParams): KnobConfig[] => [
    { id: 'pitch', label: 'TUNE', x: 0.2, y: 0.45, size: 0.13, value: (params.pitch - 20) / 130 },
    { id: 'decay', label: 'DECAY', x: 0.5, y: 0.45, size: 0.13, value: params.decay },
    { id: 'tone', label: 'SNAP', x: 0.8, y: 0.45, size: 0.13, value: params.tone },
    { id: 'volume', label: 'LEVEL', x: 0.9, y: 0.8, size: 0.08, value: params.volume },
];
const getSnareControls = (params: SnareParams): KnobConfig[] => [
    { id: 'tone', label: 'TUNE', x: 0.25, y: 0.45, size: 0.13, value: (params.tone - 100) / 300 },
    { id: 'noise', label: 'SNAPPY', x: 0.5, y: 0.45, size: 0.13, value: (params.noise - 1000) / 7000 },
    { id: 'decay', label: 'DECAY', x: 0.75, y: 0.45, size: 0.11, value: params.decay * 2 },
    { id: 'volume', label: 'LEVEL', x: 0.9, y: 0.8, size: 0.08, value: params.volume },
];
const getClosedHatControls = (params: any): KnobConfig[] => [
    { id: 'decay', label: 'DECAY', x: 0.3, y: 0.45, size: 0.13, value: params.decay },
    { id: 'pitch', label: 'TONE', x: 0.6, y: 0.45, size: 0.13, value: params.pitch / 12000 },
    { id: 'volume', label: 'LEVEL', x: 0.9, y: 0.8, size: 0.08, value: params.volume },
];
const getOpenHatControls = (params: any): KnobConfig[] => [
    { id: 'decay', label: 'DECAY', x: 0.3, y: 0.45, size: 0.13, value: params.decay },
    { id: 'pitch', label: 'TONE', x: 0.6, y: 0.45, size: 0.13, value: params.pitch / 12000 },
    { id: 'volume', label: 'LEVEL', x: 0.9, y: 0.8, size: 0.08, value: params.volume },
];
const getSamplerControls = (params: SamplerParams): KnobConfig[] => [
    { id: 'volume', label: 'LEVEL', x: 0.8, y: 0.25, size: 0.1, value: params.volume },
    { id: 'playbackSpeed', label: 'SPEED', x: 0.2, y: 0.25, size: 0.1, value: (params.playbackSpeed) / 4.0 },
    { id: 'filterCutoff', label: 'CUTOFF', x: 0.2, y: 0.65, size: 0.12, value: params.filterCutoff / 20000 },
    { id: 'filterResonance', label: 'RES', x: 0.4, y: 0.65, size: 0.12, value: params.filterResonance / 20 },
    { id: 'drive', label: 'DRIVE', x: 0.6, y: 0.65, size: 0.12, value: params.drive },
    { id: 'delaySend', label: 'DELAY', x: 0.8, y: 0.65, size: 0.12, value: params.delaySend },
];


// --- COMPONENTS ---

// UPDATED SVG STEP: Supports variable length (morphing) and alternating background groups
// UPDATED: Now supports onMouseDown for drag detection
const SvgStep = memo(({
    stepIndex,
    active,
    note,
    isCurrent,
    rowLabel,
    rowKey,
    onToggle,
    onRightMouseDown,
    length = 1
}: {
    stepIndex: number,
    active: boolean,
    note?: string | null,
    isCurrent: boolean,
    rowLabel: string,
    rowKey: TrackKey,
    onToggle: (k: TrackKey, i: number, e: any) => void,
    onRightMouseDown: (k: TrackKey, i: number, e: React.MouseEvent) => void,
    length?: number
}) => {
    // Dimensions
    const baseWidth = 18;
    const gap = 4;
    const height = 50;

    // Calculate Position
    const x = 220 + stepIndex * (baseWidth + gap);

    // Calculate Morphed Width
    // Width = (bases * length) + (gaps * (length - 1))
    const totalWidth = (baseWidth * length) + (gap * (length - 1));

    // Colors
    const color = note ? getNoteColor(note) : '#06b6d4';

    // Alternating Background Logic (Every 4 steps / Quarter Note)
    const groupIndex = Math.floor(stepIndex / 4);
    const isAltGroup = groupIndex % 2 === 1;
    const baseFill = active ? '#0d1f15' : (isAltGroup ? '#1c2229' : '#14181c');

    return (
        <g transform={`translate(${x}, 0)`}
            role="button"
            tabIndex={0}
            aria-label={`${rowLabel} step ${stepIndex + 1}`}
            onClick={(e) => onToggle(rowKey, stepIndex, e)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggle(rowKey, stepIndex, e);
                }
            }}
            onMouseDown={(e) => {
                if (e.button === 2) {
                    onRightMouseDown(rowKey, stepIndex, e);
                }
            }}
            onContextMenu={(e) => e.preventDefault()}
            cursor="pointer"
            style={{ transition: 'all 0.1s ease' }}
        >
            {/* Active Glow */}
            {active && (
                <rect
                    x={-4} y={-4}
                    width={totalWidth + 8} height={height + 8}
                    rx={6}
                    fill={isCurrent ? "rgba(255, 255, 255, 0.3)" : color}
                    fillOpacity={0.4}
                    filter="blur(6px)"
                />
            )}

            {/* Base/Shadow */}
            <rect x={0} y={0} width={totalWidth} height={height} rx={3} fill="#050505" />

            {/* Main Body */}
            <rect
                x={1} y={1} width={totalWidth - 2} height={height - 2} rx={2}
                fill={baseFill}
                strokeWidth={0}
            />

            {/* Bevel Highlight */}
            <path d={`M 2 2 L ${totalWidth - 2} 2 L ${totalWidth - 4} 4 L 4 4 L 4 ${height - 4} L 2 ${height - 2} Z`} fill="rgba(255,255,255,0.2)" />

            {/* Bevel Shadow */}
            <path d={`M ${totalWidth - 2} 2 L ${totalWidth - 2} ${height - 2} L 2 ${height - 2} L 4 ${height - 4} L ${totalWidth - 4} ${height - 4} L ${totalWidth - 4} 4 Z`} fill="rgba(0,0,0,0.5)" />

            {/* Cap/Surface */}
            <rect
                x={3} y={4} width={totalWidth - 6} height={height - 8} rx={1}
                fill={active ? color : '#1a2026'}
                fillOpacity={active ? 0.6 : 1}
                stroke={isCurrent ? '#ffffff' : (active ? color : 'none')}
                strokeWidth={isCurrent ? 2 : (active ? 1 : 0)}
            />

            {/* Grip Lines for Long Notes */}
            {length > 1 && (
                <g opacity={0.3} fill="#000">
                    <rect x={totalWidth / 2 - 2} y={height / 2 - 10} width={4} height={20} rx={1} />
                    <rect x={totalWidth / 2 - 8} y={height / 2 - 10} width={4} height={20} rx={1} />
                    <rect x={totalWidth / 2 + 4} y={height / 2 - 10} width={4} height={20} rx={1} />
                </g>
            )}

            {/* Glass Shine */}
            <rect
                x={4} y={5} width={totalWidth - 8} height={(height - 10) / 2} rx={1}
                fill="url(#glassGrad)"
                fillOpacity={0.3}
                pointerEvents="none"
            />

            {/* LED */}
            <rect
                x={5} y={height - 10} width={totalWidth - 10} height={3} rx={1}
                fill={isCurrent ? '#ff3333' : (active ? '#ccffcc' : '#000')}
                fillOpacity={isCurrent ? 1 : (active ? 0.8 : 0.2)}
                filter={active || isCurrent ? "url(#glow)" : "none"}
            />
        </g>
    )
})

const TrackSlotButton = memo(({ index, isActive, hasData, trackKey, onSelect }: { index: number, isActive: boolean, hasData: boolean, trackKey: TrackKey, onSelect: (k: TrackKey, i: number) => void }) => {
    const patternColor = getPatternColor(index);
    // Create a darker version for inactive state
    const inactiveColor = hasData ? patternColor : '#0f1812';
    
    return (
        <g
            transform={`translate(${index * 22}, 0)`}
            onClick={() => onSelect(trackKey, index)}
            cursor="pointer"
            role="button"
            tabIndex={0}
            aria-label={`Pattern Slot ${index + 1}`}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(trackKey, index);
                }
            }}
        >
            <rect
                width={18} height={18} rx={2}
                fill={isActive ? patternColor : inactiveColor}
                fillOpacity={isActive ? 1 : (hasData ? 0.4 : 1)}
                stroke={isActive ? '#fff' : patternColor}
                strokeOpacity={isActive ? 1 : 0.6}
                strokeWidth={1}
            />
            <text x={9} y={13} textAnchor="middle" fontSize={10} fill={isActive ? '#000' : patternColor} fontFamily="monospace" fontWeight="bold">
                {index + 1}
            </text>
        </g>
    );
});

// UPDATED SEQUENCER ROW: Adds Grid Markers (Beats/Bars)
const SequencerRow = memo(({
    rowKey,
    label,
    rowIndex,
    steps,
    currentStep,
    isSelected,
    activeSlot,
    trackSlots,
    onToggle,
    onRightMouseDown,
    onSelectRow,
    onSelectSlot
}: {
    rowKey: TrackKey,
    label: string,
    rowIndex: number,
    steps: (any | null)[],
    currentStep: number,
    isSelected: boolean,
    activeSlot: number,
    trackSlots: (PartSequence | null)[],
    onToggle: (k: any, i: number, e: any) => void,
    onRightMouseDown: (k: TrackKey, i: number, e: any) => void,
    onSelectRow: (k: any) => void,
    onSelectSlot: (k: TrackKey, slot: number) => void
}) => {

    // 1. Render Steps (Handling Morphed/Tied Notes)
    const renderedSteps = [];
    let skipCount = 0;

    for (let i = 0; i < 32; i++) {
        if (skipCount > 0) {
            skipCount--;
            continue;
        }

        const stepData = steps[i];
        const length = stepData?.length || 1;

        // Is the playhead currently inside this note's duration?
        const isCurrent = currentStep >= i && currentStep < (i + length);

        renderedSteps.push(
            <SvgStep
                key={i}
                stepIndex={i}
                active={!!stepData}
                note={stepData ? stepData.note : null}
                length={length}
                isCurrent={isCurrent}
                rowLabel={label}
                rowKey={rowKey}
                onToggle={onToggle}
                onRightMouseDown={onRightMouseDown}
            />
        );

        if (stepData && length > 1) {
            skipCount = length - 1;
        }
    }

    return (
        <g transform={`translate(0, ${rowIndex * 60})`}>
            {/* Row Label / Selector */}
            <g
                onClick={() => onSelectRow(rowKey)}
                cursor="pointer"
                role="button"
                tabIndex={0}
                aria-label={`Select ${label} track`}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectRow(rowKey);
                    }
                }}
            >
                {isSelected && <rect x={-10} y={8} width={4} height={36} fill="#3fa34d" rx={2} />}
                <text
                    x={-20} y={30} textAnchor="end"
                    fontFamily="Orbitron, monospace" fontSize={12}
                    fill={isSelected ? '#3fa34d' : '#5a6b60'}
                    fontWeight={isSelected ? 'bold' : 'normal'}
                    style={{ textShadow: isSelected ? '0 0 8px rgba(63,163,77,0.5)' : 'none' }}
                >
                    {label.toUpperCase()}
                </text>
            </g>

            {/* Pattern Slots */}
            <g transform="translate(30, 16)">
                {[0, 1, 2, 3, 4, 5, 6, 7].map(slot => (
                    <TrackSlotButton
                        key={slot}
                        index={slot}
                        isActive={activeSlot === slot}
                        hasData={!!trackSlots[slot]}
                        trackKey={rowKey}
                        onSelect={onSelectSlot}
                    />
                ))}
            </g>

            {/* Render Grid Indicators */}
            <GridIndicators />

            {/* Render Buttons */}
            {renderedSteps}
        </g>
    )
})

const ROWS = [
    { key: 'partA', label: 'Lead' },
    { key: 'partB', label: 'Bass' },
    { key: 'kick', label: 'Kick' },
    { key: 'snare', label: 'Snare' },
    { key: 'closedHat', label: 'CH' },
    { key: 'openHat', label: 'OH' },
    { key: 'sampler', label: 'SMP' },
] as const

export const App: React.FC = () => {
    const { pyodide, isPyodideReady, pyodideStatus } = usePyodideEngine()
    const [isVoiceEditorOpen, setIsVoiceEditorOpen] = useState(false);
    const [isCloudLibraryOpen, setIsCloudLibraryOpen] = useState(false);

    // UPDATED: Destructure init function for auto-load
    const { audioEngine, isReady, initializeAudio } = useAudioEngine(pyodide)

    const isEngineReady = isReady && (isPyodideReady || !!pyodideStatus)

    // --- AUTO INITIALIZE AUDIO ---
    useEffect(() => {
        // Automatically try to init audio engines on mount
        initializeAudio();
    }, [initializeAudio]);

    // --- STATE ---
    const [pattern, setPattern] = useState<Pattern>(INITIAL_PATTERN)
    const [tempo, setTempo] = useState<number>(DEFAULT_TEMPO)
    const [isInitialized, setIsInitialized] = useState(false)
    const [isPlaying, setIsPlaying] = useState(false)
    const [isRecording, setIsRecording] = useState(false)
    const [currentStep, setCurrentStep] = useState(-1)
    const [selectedTrack, setSelectedTrack] = useState<TrackKey>('partA')
    const [ambianceUrl, setAmbianceUrl] = useState<string>('')
    const [backgroundImage, setBackgroundImage] = useState<string>('')
    const [masterVolume, setMasterVolume] = useState(0.8)
    const [globalPan, setGlobalPan] = useState(0)

    // --- SONG MODE STATE ---
    const [isSongModeOpen, setIsSongModeOpen] = useState(false);
    const [isSongModeActive, setIsSongModeActive] = useState(false);
    const [songStructure, setSongStructure] = useState<({ [key in TrackKey]: number | null })[]>(
        Array(16).fill(null).map(() => ({
            partA: null, partB: null, kick: null, snare: null, closedHat: null, openHat: null, sampler: null
        }))
    );
    const [currentSongMeasure, setCurrentSongMeasure] = useState(0);

    // --- CONTEXT MENU STATE ---
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, track: TrackKey, step: number } | null>(null);

    // --- DRAG STATE FOR NOTE CHANGES ---
    const [isNoteDragging, setIsNoteDragging] = useState(false);
    const noteDragRef = useRef<{
        track: TrackKey;
        step: number;
        startY: number;
        startMidi: number;
        hasMoved: boolean;
    } | null>(null);


    // --- ANIMATION LOOP ---
    const [loadingTick, setLoadingTick] = useState(0);
    useEffect(() => {
        if (isPyodideReady) return;
        const interval = setInterval(() => {
            setLoadingTick(t => (t + 1) % 1000);
        }, 100);
        return () => clearInterval(interval);
    }, [isPyodideReady]);

    const getLoadingStepData = (rIdx: number) => {
        return Array(32).fill(null).map((_, i) => {
            const diag = (i + rIdx + loadingTick) % 8 === 0;
            const scanPos = loadingTick % 32;
            const scanner = (i === scanPos) || (i === 31 - scanPos);
            const active = diag || scanner;
            return active ? { note: 'C4', velocity: 1 } : null;
        });
    }

    // --- STORAGE STATE ---
    const [trackStorage, setTrackStorage] = useState<Record<TrackKey, (PartSequence | null)[]>>(
        getInitialTrackStorage(INITIAL_PATTERN)
    );

    const [activeTrackSlots, setActiveTrackSlots] = useState<Record<TrackKey, number>>({
        partA: 0, partB: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: 0
    });
    const activeTrackSlotsRef = useRef(activeTrackSlots);
    useEffect(() => { activeTrackSlotsRef.current = activeTrackSlots; }, [activeTrackSlots]);

    const [songStorage, setSongStorage] = useState<(SongSnapshot | null)[]>([null, null, null, null]);
    const [activeSongSlot, setActiveSongSlot] = useState<number | null>(null);
    const [samplerBuffer, setSamplerBuffer] = useState<AudioBuffer | null>(null);

    // --- INSTRUMENT STATE ---
    const [synthA, setSynthA] = useState<SynthParams>(DEFAULT_SYNTH_PARAMS_A);
    const synthARef = useRef<SynthParams>(DEFAULT_SYNTH_PARAMS_A);
    const updateSynthA = useCallback((updates: Partial<SynthParams>) => {
        setSynthA(prev => {
            const n = { ...prev, ...updates };
            synthARef.current = n;
            return n;
        });
    }, []);

    const [synthB, setSynthB] = useState<SynthParams>(DEFAULT_SYNTH_PARAMS_B);
    const synthBRef = useRef<SynthParams>(DEFAULT_SYNTH_PARAMS_B);
    const updateSynthB = useCallback((updates: Partial<SynthParams>) => {
        setSynthB(prev => {
            const n = { ...prev, ...updates };
            synthBRef.current = n;
            return n;
        });
    }, []);

    const [kick, setKick] = useState<KickParams>(DEFAULT_KICK_PARAMS);
    const kickRef = useRef(DEFAULT_KICK_PARAMS);
    const updateKick = useCallback((u: Partial<KickParams>) => {
        setKick(prev => {
            const n = { ...prev, ...u };
            kickRef.current = n;
            return n;
        });
    }, []);

    const [snare, setSnare] = useState<SnareParams>(DEFAULT_SNARE_PARAMS);
    const snareRef = useRef(DEFAULT_SNARE_PARAMS);
    const updateSnare = useCallback((u: Partial<SnareParams>) => {
        setSnare(prev => {
            const n = { ...prev, ...u };
            snareRef.current = n;
            return n;
        });
    }, []);

    const [closedHat, setClosedHat] = useState(DEFAULT_CLOSED_HAT_PARAMS);
    const closedHatRef = useRef(DEFAULT_CLOSED_HAT_PARAMS);
    const updateClosedHat = useCallback((u: Partial<typeof DEFAULT_CLOSED_HAT_PARAMS>) => {
        setClosedHat(prev => {
            const n = { ...prev, ...u };
            closedHatRef.current = n;
            return n;
        });
    }, []);

    const [openHat, setOpenHat] = useState(DEFAULT_OPEN_HAT_PARAMS);
    const openHatRef = useRef(DEFAULT_OPEN_HAT_PARAMS);
    const updateOpenHat = useCallback((u: Partial<typeof DEFAULT_OPEN_HAT_PARAMS>) => {
        setOpenHat(prev => {
            const n = { ...prev, ...u };
            openHatRef.current = n;
            return n;
        });
    }, []);

    const [sampler, setSampler] = useState(DEFAULT_SAMPLER_PARAMS);
    const samplerRef = useRef(DEFAULT_SAMPLER_PARAMS);
    const updateSampler = useCallback((u: Partial<SamplerParams>) => {
        setSampler(prev => {
            const n = { ...prev, ...u };
            samplerRef.current = n;
            return n;
        });
    }, []);

    // --- TEMPO HOLD-TO-SCROLL ---
    const tempoHoldIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const tempoRef = useRef(tempo);
    useEffect(() => { tempoRef.current = tempo; }, [tempo]);

    const adjustTempo = useCallback((direction: number) => {
        setTempo(t => Math.max(30, Math.min(300, t + direction)));
    }, []);

    const handleTempoHoldStart = useCallback((direction: number) => {
        // First immediate change
        adjustTempo(direction);
        
        // Start interval for continuous change after 300ms
        const timeout = setTimeout(() => {
            tempoHoldIntervalRef.current = setInterval(() => {
                adjustTempo(direction);
            }, 50); // Change every 50ms while held
        }, 300);
        
        // Store timeout so we can clear it
        (tempoHoldIntervalRef as any).timeout = timeout;
    }, [adjustTempo]);

    const handleTempoHoldEnd = useCallback(() => {
        if ((tempoHoldIntervalRef as any).timeout) {
            clearTimeout((tempoHoldIntervalRef as any).timeout);
        }
        if (tempoHoldIntervalRef.current) {
            clearInterval(tempoHoldIntervalRef.current);
            tempoHoldIntervalRef.current = null;
        }
    }, []);

    const handleTempoKeyDown = useCallback((e: React.KeyboardEvent, direction: number) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            adjustTempo(direction);
        }
    }, [adjustTempo]);

    const handlePanic = useCallback(() => {
        if (!audioEngine || !audioEngine.stopAllNotes) return;
        audioEngine.stopAllNotes();
        // Also clear the app's tracking map
        activeKeyboardNotesRef.current.clear();
        console.log("Panic triggered: All notes stopped.");
    }, [audioEngine]);

    // --- AUDIO LOOP ---
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
        if (!audioEngine) return
        const time = audioEngine.context.currentTime

        // 1. Determine Source Pattern
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
                    if (slot === null) return { steps: Array(32).fill(null) };
                    const stored = trackStorageRef.current[key][slot];
                    return stored || { steps: Array(32).fill(null) };
                };

                activePattern = {
                    partA: getSeq('partA'),
                    partB: getSeq('partB'),
                    kick: getSeq('kick'),
                    snare: getSeq('snare'),
                    closedHat: getSeq('closedHat'),
                    openHat: getSeq('openHat'),
                    sampler: getSeq('sampler'),
                } as Pattern;
            }
        }

        const p = activePattern;
        const stepTime = 60 / tempo / 4;

        // UPDATED PLAY CALLS: Pass length and stepTime for duration
        if (p.partA.steps[step]) audioEngine.playSynth(synthARef.current, p.partA.steps[step]!.note, time, p.partA.steps[step]!.length, stepTime)
        if (p.partB.steps[step]) audioEngine.playSynth(synthBRef.current, p.partB.steps[step]!.note, time, p.partB.steps[step]!.length, stepTime)

        if (p.kick.steps[step]) audioEngine.playDrum('kick', kickRef.current, time)
        if (p.snare.steps[step]) audioEngine.playDrum('snare', snareRef.current, time)
        if (p.openHat.steps[step]) audioEngine.playDrum('openHat', openHatRef.current, time)
        else if (p.closedHat.steps[step]) audioEngine.playDrum('closedHat', closedHatRef.current, time)

        if (p.sampler.steps[step]) audioEngine.playSampler(samplerRef.current, p.sampler.steps[step]!.note, time, p.sampler.steps[step]!.length, stepTime)
    }, [audioEngine, tempo])

    const { isPlaying: schedPlaying, currentStep: schedStep, setIsPlaying: setSchedPlaying } = useScheduler(tempo, NUM_STEPS, onStep, isEngineReady)

    useEffect(() => setIsPlaying(schedPlaying), [schedPlaying])
    useEffect(() => setCurrentStep(schedStep), [schedStep])

    const currentStepRef = useRef(currentStep);
    useEffect(() => { currentStepRef.current = currentStep; }, [currentStep]);

    useEffect(() => {
        if (!schedPlaying) {
            songMeasureRef.current = 0;
            setCurrentSongMeasure(0);
            isFirstStepRef.current = true;
        }
    }, [schedPlaying]);

    const handlePlayToggle = async () => {
        if (!isInitialized) { await initializeAudio(); setIsInitialized(true); }
        setSchedPlaying(!schedPlaying)
    }

    // --- LOGIC HANDLERS ---

    const handleMasterVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = parseFloat(e.target.value);
        setMasterVolume(v);
        audioEngine?.setMasterVolume(v);
    };

    const handleGlobalPan = (e: React.ChangeEvent<HTMLInputElement>) => {
        const p = parseFloat(e.target.value);
        const val = (p > -0.1 && p < 0.1) ? 0 : p;
        setGlobalPan(val);
        audioEngine?.setGlobalPan(val);
    };

    const updateStorageForTrack = useCallback((track: TrackKey, sequence: PartSequence) => {
        setTrackStorage(prev => {
            const copy = { ...prev };
            copy[track] = [...copy[track]];
            copy[track][activeTrackSlotsRef.current[track]] = sequence;
            return copy;
        });
    }, []);

    // UPDATED TOGGLE STEP: Handles Tie Creation (Shift+Click)
    const toggleStep = useCallback((rowKey: keyof Pattern, i: number, e: React.MouseEvent) => {
        setPattern(prev => {
            // OPTIMIZATION: Shallow copy instead of deep clone to preserve references for untouched tracks
            const copy = { ...prev };
            // Deep copy only the target track sequence
            copy[rowKey] = {
                ...prev[rowKey],
                steps: [...prev[rowKey].steps]
            };

            const steps = copy[rowKey].steps;
            const existing = steps[i];

            // TIE LOGIC: If Shift is held, extend previous note
            if (e.shiftKey) {
                let prevIdx = -1;
                // Look backwards for the closest note start
                for (let k = i - 1; k >= 0; k--) {
                    if (steps[k]) {
                        prevIdx = k;
                        break;
                    }
                }

                if (prevIdx !== -1) {
                    // Clone the previous note object before mutation
                    steps[prevIdx] = { ...steps[prevIdx]! };
                    const prevNote = steps[prevIdx]!;
                    const newLength = i - prevIdx + 1;

                    // Update length
                    prevNote.length = newLength;

                    // Clear steps covered by the new length
                    for (let k = prevIdx + 1; k <= i; k++) {
                        steps[k] = null;
                    }

                    updateStorageForTrack(rowKey, copy[rowKey]);
                    return copy;
                }
            }

            // Standard Toggle
            if (existing) {
                steps[i] = null;
            } else {
                const defaultNote = rowKey.startsWith('part') ? (rowKey === 'partA' ? 'C4' : 'C3') : 'C4';
                steps[i] = { note: defaultNote, velocity: 1, length: 1 };
            }

            updateStorageForTrack(rowKey, copy[rowKey]);
            return copy;
        })
    }, [updateStorageForTrack])

    const activeKeyboardNotesRef = useRef<Map<string, number>>(new Map());

    const handleKeyboardPlay = useCallback((note: string) => {
        if (!audioEngine) return;
        const time = audioEngine.context.currentTime;
        if (selectedTrack === 'partA') {
            const maybe = audioEngine.noteOnSynth?.(synthARef.current, note, time);
            Promise.resolve(maybe).then((id) => { if (id) activeKeyboardNotesRef.current.set(note, id); });
        } else if (selectedTrack === 'partB') {
            const maybe = audioEngine.noteOnSynth?.(synthBRef.current, note, time);
            Promise.resolve(maybe).then((id) => { if (id) activeKeyboardNotesRef.current.set(note, id); });
        }
        else if (selectedTrack === 'kick') audioEngine.playDrum('kick', { ...kickRef.current, pitch: 60 }, time);
        else if (selectedTrack === 'snare') audioEngine.playDrum('snare', snareRef.current, time);
        else if (selectedTrack === 'closedHat') audioEngine.playDrum('closedHat', closedHatRef.current, time);
        else if (selectedTrack === 'openHat') audioEngine.playDrum('openHat', openHatRef.current, time);
        else if (selectedTrack === 'sampler') {
            const id = audioEngine.noteOnSampler?.(samplerRef.current, note, time) ?? null;
            if (id) activeKeyboardNotesRef.current.set(note, id);
        }

        const step = currentStepRef.current;
        if (isRecording && isPlaying && step >= 0) {
            setPattern(prev => {
                const copy = JSON.parse(JSON.stringify(prev)) as Pattern;
                copy[selectedTrack].steps[step] = { note, velocity: 1, length: 1 };
                updateStorageForTrack(selectedTrack, copy[selectedTrack]);
                return copy;
            });
        }
    }, [audioEngine, selectedTrack, isRecording, isPlaying, updateStorageForTrack]);

    const handleKeyboardStop = useCallback((note: string) => {
        // For now we don't have per-note stop in the AudioEngine for scheduled envelopes.
        // This function exists so keyboard UI can notify engine implementations that support note-off (e.g., SustainProcessor)
        // If a future engine exposes stopSynth/stopSampler methods, call them here.
        if (!audioEngine) return;
        const id = activeKeyboardNotesRef.current.get(note);
        if (!id) return;
        if (selectedTrack === 'partA' || selectedTrack === 'partB') {
            audioEngine.noteOffSynth?.(id);
        } else if (selectedTrack === 'sampler') {
            audioEngine.noteOffSampler?.(id);
        }
        activeKeyboardNotesRef.current.delete(note);
        // Right now, the keyboard will rely on envelope lengths managed by the engine.
        return;
    }, [audioEngine, selectedTrack]);

    const handleRightMouseDown = useCallback((track: TrackKey, step: number, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const stepData = patternRef.current[track].steps[step];
        if (!stepData) return;

        setIsNoteDragging(true);
        noteDragRef.current = {
            track,
            step,
            startY: e.clientY,
            startMidi: noteToMidi(stepData.note),
            hasMoved: false
        };
        document.body.style.cursor = 'ns-resize';
    }, []);

    const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
        if (!isNoteDragging || !noteDragRef.current) return;

        const { track, step, startY, startMidi } = noteDragRef.current;
        const dy = startY - e.clientY; // Positive = Drag Up

        // Check for threshold
        if (!noteDragRef.current.hasMoved && Math.abs(dy) > 5) {
            noteDragRef.current.hasMoved = true;
        }

        if (noteDragRef.current.hasMoved) {
            const semitoneChange = Math.round(dy / 10); // 10px per semitone
            if (semitoneChange !== 0) {
                const newMidi = startMidi + semitoneChange;
                // Clamp midi
                const clampedMidi = Math.max(24, Math.min(108, newMidi)); // C1 to C8
                const newNote = midiToNote(clampedMidi);

                setPattern(prev => {
                    const copy = JSON.parse(JSON.stringify(prev)) as Pattern;
                    if (copy[track].steps[step]) {
                        copy[track].steps[step]!.note = newNote;
                    }
                    updateStorageForTrack(track, copy[track]);
                    return copy;
                });
            }
        }
    }, [isNoteDragging]);

    const handleGlobalMouseUp = useCallback((e: MouseEvent) => {
        if (!isNoteDragging || !noteDragRef.current) return;

        // If short click, open menu
        if (!noteDragRef.current.hasMoved) {
            const { track, step } = noteDragRef.current;
            setContextMenu({ x: e.clientX, y: e.clientY, track, step });
        }

        setIsNoteDragging(false);
        noteDragRef.current = null;
        document.body.style.cursor = 'default';
    }, [isNoteDragging]);

    useEffect(() => {
        if (isNoteDragging) {
            window.addEventListener('mousemove', handleGlobalMouseMove);
            window.addEventListener('mouseup', handleGlobalMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleGlobalMouseMove);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, [isNoteDragging, handleGlobalMouseMove, handleGlobalMouseUp]);


    const handleNoteSelect = (note: string) => {
        if (!contextMenu) return;
        setPattern(prev => {
            const copy = JSON.parse(JSON.stringify(prev)) as Pattern;
            const stepData = copy[contextMenu.track].steps[contextMenu.step];
            if (stepData) {
                stepData.note = note;
            }
            updateStorageForTrack(contextMenu.track, copy[contextMenu.track]);
            return copy;
        });
        setContextMenu(null);
    };

    const handleClearPattern = () => {
        if (window.confirm("Clear current pattern?")) {
            const emptyPattern = {
                partA: { steps: Array(32).fill(null) },
                partB: { steps: Array(32).fill(null) },
                kick: { steps: Array(32).fill(null) },
                snare: { steps: Array(32).fill(null) },
                closedHat: { steps: Array(32).fill(null) },
                openHat: { steps: Array(32).fill(null) },
                sampler: { steps: Array(32).fill(null) },
            } as Pattern;

            setPattern(emptyPattern);

            setTrackStorage(prevStorage => {
                const storageCopy = { ...prevStorage };
                (Object.keys(storageCopy) as TrackKey[]).forEach(key => {
                    storageCopy[key] = [...storageCopy[key]];
                    storageCopy[key][activeTrackSlots[key]] = emptyPattern[key];
                });
                return storageCopy;
            });
        }
    };

    const handleTrackSlotClick = useCallback((track: TrackKey, slotIndex: number) => {
        const currentTrackPattern = patternRef.current[track];
        const storedPattern = trackStorageRef.current[track][slotIndex];

        if (storedPattern) {
            setPattern(prev => ({ ...prev, [track]: storedPattern }));
            setActiveTrackSlots(prev => ({ ...prev, [track]: slotIndex }));
        } else {
            setTrackStorage(prev => {
                const copy = { ...prev };
                copy[track] = [...prev[track]];
                copy[track][slotIndex] = currentTrackPattern;
                return copy;
            });
            setActiveTrackSlots(prev => ({ ...prev, [track]: slotIndex }));
        }
    }, []);

    const handleSelectRow = useCallback((k: any) => setSelectedTrack(k as TrackKey), []);

    const saveSong = (slot: number) => {
        const snapshot: SongSnapshot = {
            pattern, tempo, ambianceUrl, backgroundImage,
            params: {
                synthA: synthA, synthB: synthB, kick: kick, snare: snare, closedHat: closedHat, openHat: openHat, sampler: sampler
            }
        };
        setSongStorage(prev => {
            const copy = [...prev];
            copy[slot] = snapshot;
            return copy;
        });
        setActiveSongSlot(slot);
    };

    const loadSong = (slot: number) => {
        const snapshot = songStorage[slot];
        if (!snapshot) return;
        setPattern(snapshot.pattern);
        setTempo(snapshot.tempo);
        setAmbianceUrl(snapshot.ambianceUrl);
        setBackgroundImage(snapshot.backgroundImage || '');
        setSynthA(snapshot.params.synthA); synthARef.current = snapshot.params.synthA;
        setSynthB(snapshot.params.synthB); synthBRef.current = snapshot.params.synthB;
        setKick(snapshot.params.kick); kickRef.current = snapshot.params.kick;
        setSnare(snapshot.params.snare); snareRef.current = snapshot.params.snare;
        setClosedHat(snapshot.params.closedHat); closedHatRef.current = snapshot.params.closedHat;
        setOpenHat(snapshot.params.openHat); openHatRef.current = snapshot.params.openHat;
        setSampler(snapshot.params.sampler); samplerRef.current = snapshot.params.sampler;
        setActiveSongSlot(slot);
    };

    // --- DATA EXTRACTORS FOR CLOUD ---
    // 1. Full Song
    const getSongData = useCallback(() => {
        return {
            version: 1,
            pattern,
            tempo,
            ambianceUrl,
            backgroundImage,
            params: { synthA, synthB, kick, snare, closedHat, openHat, sampler },
            trackStorage,
            activeTrackSlots,
            songStructure
        };
    }, [pattern, tempo, ambianceUrl, backgroundImage, synthA, synthB, kick, snare, closedHat, openHat, sampler, trackStorage, activeTrackSlots, songStructure]);

    // 2. Pattern Bank (Just the storage)
    const getBankData = useCallback(() => {
        return {
            type: 'bank',
            trackStorage
        };
    }, [trackStorage]);

    // 3. Single Pattern (Current active)
    const getPatternData = useCallback(() => {
        return {
            type: 'pattern',
            pattern
        };
    }, [pattern]);

    // --- DATA LOADER ---
    const loadCloudData = useCallback((data: any, type: CloudItemType) => {
        console.log("Loading Cloud Data:", type, data);

        if (type === 'song') {
            // Full Song Load (Same as file import)
            if (data.pattern) setPattern(data.pattern);
            if (data.tempo) setTempo(data.tempo);
            if (data.ambianceUrl !== undefined) setAmbianceUrl(data.ambianceUrl);
            if (data.backgroundImage !== undefined) setBackgroundImage(data.backgroundImage);
            
            if (data.params) {
                if (data.params.synthA) { setSynthA(data.params.synthA); synthARef.current = data.params.synthA; }
                if (data.params.synthB) { setSynthB(data.params.synthB); synthBRef.current = data.params.synthB; }
                if (data.params.kick) { setKick(data.params.kick); kickRef.current = data.params.kick; }
                if (data.params.snare) { setSnare(data.params.snare); snareRef.current = data.params.snare; }
                if (data.params.closedHat) { setClosedHat(data.params.closedHat); closedHatRef.current = data.params.closedHat; }
                if (data.params.openHat) { setOpenHat(data.params.openHat); openHatRef.current = data.params.openHat; }
                if (data.params.sampler) { setSampler(data.params.sampler); samplerRef.current = data.params.sampler; }
            }
            
            if (data.trackStorage) setTrackStorage(data.trackStorage);
            if (data.activeTrackSlots) setActiveTrackSlots(data.activeTrackSlots);
            if (data.songStructure) setSongStructure(data.songStructure);
            alert("Song loaded!");

        } else if (type === 'bank') {
            // Load Bank (Replace all patterns in storage)
            if (data.trackStorage) {
                setTrackStorage(data.trackStorage);
                alert("Pattern Bank loaded! Check your pattern slots.");
            }

        } else if (type === 'pattern') {
            // Load Single Pattern (Replace CURRENT pattern)
            if (data.pattern) {
                setPattern(data.pattern);
                alert("Pattern loaded into current view!");
            }
        }
    }, []);

    const exportSongToFile = useCallback(() => {
        const songData = getSongData();
        
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
                
                        loadCloudData(songData, 'song');
                
                alert('Song loaded successfully!');
            } catch (err) {
                console.error('Failed to load song:', err);
                alert('Failed to load song file. Make sure it\'s a valid JSON file.');
            }
        };
        input.click();
    }, [loadCloudData]);

    // --- MODULE RENDER HELPERS ---
    const handleSynthChange = useCallback((isA: boolean, id: string, val: number) => {
        const updater = isA ? updateSynthA : updateSynthB;
        let realVal = val;
        if (id === 'pitch') realVal = Math.floor(val * 48 - 24);
        else if (id === 'filterCutoff') realVal = val * 8000;
        else if (id === 'filterResonance') realVal = val * 20;
        else if (id === 'decay') realVal = val * 2;
        else if (id === 'release') realVal = val * 2;
        else if (id === 'length') realVal = val * 2;
        updater({ [id]: realVal });
    }, [updateSynthA, updateSynthB]);

    const handleKickChange = useCallback((id: string, val: number) => {
        let realVal = val;
        if (id === 'pitch') realVal = val * 130 + 20;
        updateKick({ [id]: realVal });
    }, [updateKick]);

    const handleSnareChange = useCallback((id: string, val: number) => {
        let realVal = val;
        if (id === 'tone') realVal = val * 300 + 100;
        else if (id === 'noise') realVal = val * 7000 + 1000;
        else if (id === 'decay') realVal = val * 0.5;
        updateSnare({ [id]: realVal });
    }, [updateSnare]);

    const handleClosedHatChange = useCallback((id: string, val: number) => updateClosedHat({ [id]: val }), [updateClosedHat]);
    const handleOpenHatChange = useCallback((id: string, val: number) => updateOpenHat({ [id]: val }), [updateOpenHat]);
    const handleSamplerChange = useCallback((id: string, val: number) => {
        let realVal = val;
        if (id === 'playbackSpeed') realVal = val * 4.0;
        else if (id === 'filterCutoff') realVal = val * 20000;
        else if (id === 'filterResonance') realVal = val * 20;
        updateSampler({ [id]: realVal });
    }, [updateSampler]);

    // Create stable handlers for synth A and B
    const onSynthAParamChange = useCallback((id: string, v: number) => handleSynthChange(true, id, v), [handleSynthChange]);
    const onSynthBParamChange = useCallback((id: string, v: number) => handleSynthChange(false, id, v), [handleSynthChange]);

    // Memoize controls arrays to prevent re-creation on every render
    const synthAControls = useMemo(() => getSynthControls(synthA), [synthA]);
    const synthBControls = useMemo(() => getSynthControls(synthB), [synthB]);
    const kickControls = useMemo(() => getKickControls(kick), [kick]);
    const snareControls = useMemo(() => getSnareControls(snare), [snare]);
    const closedHatControls = useMemo(() => getClosedHatControls(closedHat), [closedHat]);
    const openHatControls = useMemo(() => getOpenHatControls(openHat), [openHat]);
    const samplerControls = useMemo(() => getSamplerControls(sampler), [sampler]);

    // Memoize complex children (e.g. WaveformSelectors and SamplerPanel)
    const synthAChild = useMemo(() => (
        <div className="absolute top-4 right-6 pointer-events-auto">
            <WaveformSelector selected={synthA.waveform} onChange={(w) => updateSynthA({ waveform: w })} accentColor="cyan" />
        </div>
    ), [synthA.waveform, updateSynthA]);

    const synthBChild = useMemo(() => (
        <div className="absolute top-4 right-6 pointer-events-auto">
            <WaveformSelector selected={synthB.waveform} onChange={(w) => updateSynthB({ waveform: w })} accentColor="pink" />
        </div>
    ), [synthB.waveform, updateSynthB]);

    const samplerChild = useMemo(() => (
        <div className="absolute top-4 left-[30%] w-[40%] h-[120px] pointer-events-auto z-10 bg-gray-900/80 rounded-lg border border-purple-500/30 backdrop-blur-sm">
            <SamplerPanel
                params={sampler}
                onChange={(u) => updateSampler(u)}
                onLoadSample={(n, b) => {
                    audioEngine?.loadSampleToEngine(n, b);
                    setSamplerBuffer(b); // Save buffer for XM export
                }}
                audioContext={audioEngine?.context!}
                onOpenEditor={() => setIsVoiceEditorOpen(true)}
            />
        </div>
    ), [sampler, updateSampler, audioEngine, setIsVoiceEditorOpen]);

    const renderModulePanel = () => {
        if (selectedTrack === 'partA') return <HardwareModule title="SYNTH A // LEAD" colorHex={COLOR_LEAD} controls={synthAControls} onParamChange={onSynthAParamChange}>{synthAChild}</HardwareModule>;
        if (selectedTrack === 'partB') return <HardwareModule title="SYNTH B // BASS" colorHex={COLOR_BASS} controls={synthBControls} onParamChange={onSynthBParamChange}>{synthBChild}</HardwareModule>;
        if (selectedTrack === 'kick') return <HardwareModule title="KICK DRUM" colorHex={COLOR_KICK} controls={kickControls} onParamChange={handleKickChange} />;
        if (selectedTrack === 'snare') return <HardwareModule title="SNARE DRUM" colorHex={COLOR_SNARE} controls={snareControls} onParamChange={handleSnareChange} />;
        if (selectedTrack === 'closedHat') return <HardwareModule title="CLOSED HAT" colorHex={COLOR_CH} controls={closedHatControls} onParamChange={handleClosedHatChange} />;
        if (selectedTrack === 'openHat') return <HardwareModule title="OPEN HAT" colorHex={COLOR_OH} controls={openHatControls} onParamChange={handleOpenHatChange} />;

        if (selectedTrack === 'sampler') {
            return (
                <HardwareModule
                    title="SAMPLER // TTS"
                    colorHex={COLOR_SAMPLER}
                    controls={samplerControls}
                    onParamChange={handleSamplerChange}
                >
                    {samplerChild}
                </HardwareModule>
            );
        }
        return null;
    };

    return (
        <div
            className="flex flex-col h-screen w-screen bg-gradient-to-br from-[#050709] via-[#080a0b] to-[#0a0c0f] text-gray-200 overflow-hidden font-sans relative bg-cover bg-center"
            style={{ backgroundImage: backgroundImage ? `url(${backgroundImage})` : undefined }}
        >
            {/* Dark overlay for readability if BG image is set */}
            {backgroundImage && <div className="absolute inset-0 bg-black/60 pointer-events-none z-0"></div>}

            <CloudLibrary 
                isOpen={isCloudLibraryOpen} 
                onClose={() => setIsCloudLibraryOpen(false)}
                onLoadData={loadCloudData}
                getSongData={getSongData}
                getBankData={getBankData}
                getPatternData={getPatternData}
            />

            {isVoiceEditorOpen && (
                <VoiceEditor onClose={() => setIsVoiceEditorOpen(false)} />
            )}

            {/* --- TOP HEADER --- */}
            <header className="h-16 flex items-center justify-between px-6 bg-gradient-to-r from-[#0b0d10] to-[#0d0f12] border-b-2 border-cyan-900/30 z-20 shadow-2xl shrink-0 relative backdrop-blur-sm">
                <div className="flex items-center gap-6">
                    <h1 className="text-xl font-bold font-orbitron text-cyan-400 tracking-widest hidden md:block drop-shadow-[0_0_10px_rgba(6,182,212,0.5)]">
                        HYPHON
                    </h1>
                    <div className="flex items-center gap-2 bg-gradient-to-r from-gray-900 to-gray-800 p-2 rounded-lg border border-cyan-900/30 shadow-lg">
                        <span className="text-[10px] text-gray-500 font-mono uppercase px-1">Song</span>
                        {[0, 1, 2, 3].map(slot => (
                            <button
                                key={slot}
                                onClick={() => { if (songStorage[slot]) loadSong(slot); else saveSong(slot); }}
                                onContextMenu={(e) => { e.preventDefault(); saveSong(slot); }}
                                className={`w-6 h-6 text-xs font-mono rounded transition-all ${activeSongSlot === slot ? 'bg-cyan-600 text-white shadow-[0_0_10px_rgba(6,182,212,0.5)]' : (songStorage[slot] ? 'bg-cyan-900/30 text-cyan-400 border border-cyan-900' : 'bg-gray-800 text-gray-600 border border-gray-700')}`}
                            >
                                {slot + 1}
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={exportSongToFile} className="text-[10px] font-bold text-green-400 hover:text-green-300 border border-green-900/50 bg-gradient-to-r from-green-900/10 to-green-900/20 hover:bg-green-900/40 px-2 py-1 rounded transition-all" title="Export song to file" aria-label="Export song to file">
                            💾
                        </button>
                        <button onClick={importSongFromFile} className="text-[10px] font-bold text-blue-400 hover:text-blue-300 border border-blue-900/50 bg-gradient-to-r from-blue-900/10 to-blue-900/20 hover:bg-blue-900/40 px-2 py-1 rounded transition-all" title="Import song from file" aria-label="Import song from file">
                            📂
                        </button>
                        <button onClick={() => setIsCloudLibraryOpen(true)} className="text-[10px] font-bold text-purple-400 hover:text-purple-300 border border-purple-900/50 bg-gradient-to-r from-purple-900/10 to-purple-900/20 hover:bg-purple-900/40 px-2 py-1 rounded transition-all" title="Cloud Library" aria-label="Cloud Library">
                            ☁️
                        </button>
                        <CloudStatus />
                    </div>
                    <button onClick={handleClearPattern} className="text-xs font-bold text-red-400 hover:text-red-300 border border-red-900/50 bg-gradient-to-r from-red-900/10 to-red-900/20 hover:bg-red-900/40 px-4 py-2 rounded-lg transition-all shadow-md">
                        CLEAR
                    </button>
                </div>

                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 mr-4">
                        <label htmlFor="master-volume" className="text-[10px] text-gray-500 font-mono uppercase">Vol</label>
                        <input id="master-volume" type="range" min="0" max="1.2" step="0.01" value={masterVolume} onChange={handleMasterVolume} className="w-24 h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-500" aria-label="Master Volume" />
                    </div>
                    <div className="flex items-center gap-2 mr-4">
                        <label htmlFor="global-pan" className="text-[10px] text-gray-500 font-mono uppercase">Pan</label>
                        <input id="global-pan" type="range" min="-1" max="1" step="0.01" value={globalPan} onChange={handleGlobalPan} className="w-24 h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-500" aria-label="Global Pan" />
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center bg-gray-900 rounded border border-gray-700 scale-90">
                            <button 
                                onMouseDown={() => handleTempoHoldStart(-1)}
                                onMouseUp={handleTempoHoldEnd}
                                onMouseLeave={handleTempoHoldEnd}
                                onKeyDown={(e) => handleTempoKeyDown(e, -1)}
                                className="px-2 py-1 text-cyan-500 font-bold border-r border-gray-700 hover:bg-gray-800 select-none"
                                aria-label="Decrease Tempo"
                            >-</button>
                            <span className="w-12 text-center font-mono text-cyan-300 text-sm" aria-label={`Current Tempo: ${tempo} BPM`}>{tempo}</span>
                            <button 
                                onMouseDown={() => handleTempoHoldStart(1)}
                                onMouseUp={handleTempoHoldEnd}
                                onMouseLeave={handleTempoHoldEnd}
                                onKeyDown={(e) => handleTempoKeyDown(e, 1)}
                                className="px-2 py-1 text-cyan-500 font-bold border-l border-gray-700 hover:bg-gray-800 select-none"
                                aria-label="Increase Tempo"
                            >+</button>
                        </div>
                    </div>
                    <button onClick={handlePanic} className="w-8 h-8 rounded-full bg-red-900/50 border border-red-500/50 text-red-500 hover:bg-red-800 hover:text-white flex items-center justify-center font-bold text-xs mr-2 shadow-inner" title="PANIC: Stop All Notes" aria-label="Panic Stop All Notes">!</button>
                    <button onClick={() => setIsRecording(!isRecording)} aria-label={isRecording ? "Stop Recording" : "Start Recording"} className={`w-12 py-1 rounded font-orbitron text-sm font-bold tracking-wide transition-all shadow-lg mr-2 ${isRecording ? 'bg-red-600 text-white border border-red-500 shadow-[0_0_15px_rgba(255,0,0,0.5)] animate-pulse' : 'bg-gray-800 text-red-700 border border-gray-700 hover:bg-gray-700'}`}>REC</button>
                    <button onClick={() => { setIsSongModeOpen(!isSongModeOpen); }} aria-label={isSongModeOpen ? "Close Song Mode" : "Open Song Mode"} className={`w-24 py-1 rounded font-orbitron text-sm font-bold tracking-wide transition-all shadow-lg mr-2 ${isSongModeOpen ? 'bg-purple-900/40 text-purple-300 border border-purple-500' : 'bg-gray-800 text-gray-400 border border-gray-700'}`}>SONG</button>
                    <div className="flex items-center gap-2 mr-2">
                        <label htmlFor="song-mode-toggle" className="text-[10px] text-gray-500 font-mono uppercase">Song Mode</label>
                        <input id="song-mode-toggle" type="checkbox" checked={isSongModeActive} onChange={(e) => setIsSongModeActive(e.target.checked)} />
                    </div>
                    <button onClick={handlePlayToggle} className={`w-24 py-1 rounded font-orbitron text-sm font-bold tracking-wide transition-all shadow-lg ${isPlaying ? 'bg-red-900/20 text-red-400 border border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.2)]' : 'bg-green-900/20 text-green-400 border border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.2)]'}`}>{isPlaying ? 'STOP' : 'PLAY'}</button>
                </div>
            </header>

            <SongMode
                isVisible={isSongModeOpen}
                songStructure={songStructure}
                currentSongStep={currentSongMeasure}
                backgroundImage={backgroundImage}
                onSetBackgroundImage={setBackgroundImage}
                onToggle={() => setIsSongModeOpen(!isSongModeOpen)}
                onUpdateStep={(idx, key, val) => {
                    setSongStructure(prev => {
                        const copy = [...prev];
                        copy[idx] = { ...copy[idx], [key]: val };
                        return copy;
                    });
                }}
                onAddMeasure={() => setSongStructure(prev => [...prev, { partA: null, partB: null, kick: null, snare: null, closedHat: null, openHat: null, sampler: null }])}
                onRemoveMeasure={() => setSongStructure(prev => prev.slice(0, -1))}
                onExportXM={() => {
                    exportSongToXM(
                        songStructure, trackStorage,
                        { synthA: synthA, synthB: synthB, kick: kick, snare: snare, closedHat: closedHat, openHat: openHat, sampler: sampler },
                        tempo, pattern,
                        { webGpuEngine: audioEngine?.webGpuEngine, wasmEngine: audioEngine?.wasmEngine, pyodide: pyodide },
                        samplerBuffer // Pass sampler buffer for export
                    );
                }}
            />

            {/* --- SEQUENCER --- */}
            <main className="flex-1 relative bg-gradient-to-b from-[#0a0e14] via-[#111827] to-[#050709] shadow-inner flex flex-col justify-start pt-10 pb-6 z-10">
                {contextMenu && (
                        <NoteSelector
                            x={contextMenu.x}
                            y={contextMenu.y}
                            trackType={(contextMenu.track.startsWith('part') || contextMenu.track === 'sampler') ? 'synth' : 'drum'}
                            currentNote={pattern?.[contextMenu.track]?.steps?.[contextMenu.step]?.note ?? ''}
                            onSelect={handleNoteSelect}
                            onClose={() => setContextMenu(null)}
                            getNoteColor={getNoteColor}
                        />
                )}

                <div className="w-full max-w-[1000px] mx-auto h-[480px] border-2 border-gray-700 rounded-xl bg-gradient-to-br from-[#0a0d10] to-[#080a0c] relative shadow-[0_0_80px_rgba(0,0,0,0.9)_inset,0_20px_60px_rgba(0,0,0,0.8)] overflow-hidden">
                    <div className="absolute inset-0 rounded-xl border-2 border-cyan-900/10 pointer-events-none"></div>
                    <div className="absolute inset-2 rounded-lg border border-gray-800/50 pointer-events-none shadow-[inset_0_2px_10px_rgba(0,0,0,0.8)]"></div>
                    {/* Screws */}
                    <div className="absolute top-3 left-3 w-4 h-4 rounded-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center shadow-md border border-gray-600"><div className="w-2.5 h-[1.5px] bg-gray-800 rotate-45"></div></div>
                    <div className="absolute top-3 right-3 w-4 h-4 rounded-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center shadow-md border border-gray-600"><div className="w-2.5 h-[1.5px] bg-gray-800 rotate-45"></div></div>
                    <div className="absolute bottom-3 left-3 w-4 h-4 rounded-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center shadow-md border border-gray-600"><div className="w-2.5 h-[1.5px] bg-gray-800 rotate-45"></div></div>
                    <div className="absolute bottom-3 right-3 w-4 h-4 rounded-full bg-gradient-to-br from-gray-700 to-gray-900 flex items-center justify-center shadow-md border border-gray-600"><div className="w-2.5 h-[1.5px] bg-gray-800 rotate-45"></div></div>

                    <svg viewBox="0 0 1050 420" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" className="drop-shadow-lg">
                        <defs>
                            <linearGradient id="glassGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                                <stop offset="0%" stopColor="white" stopOpacity="0.5" />
                                <stop offset="100%" stopColor="white" stopOpacity="0" />
                            </linearGradient>
                        </defs>

                        <g transform="translate(100, 40)">
                            {ROWS.map((row, rIdx) => (
                                <SequencerRow
                                    key={row.key}
                                    rowKey={row.key}
                                    label={row.label}
                                    rowIndex={rIdx}
                                    steps={!isPyodideReady ? getLoadingStepData(rIdx) : (pattern as any)[row.key].steps}
                                    currentStep={currentStep}
                                    isSelected={selectedTrack === row.key}
                                    activeSlot={activeTrackSlots[row.key]}
                                    trackSlots={trackStorage[row.key]}
                                    onToggle={toggleStep}
                                    onRightMouseDown={handleRightMouseDown}
                                    onSelectRow={handleSelectRow}
                                    onSelectSlot={handleTrackSlotClick}
                                />
                            ))}
                        </g>
                    </svg>
                </div>

                <div className="shrink-0 pb-4 mt-6 max-w-[1000px] mx-auto w-full">
                    <div className="border-2 border-gray-700/50 rounded-xl overflow-hidden shadow-2xl bg-gradient-to-b from-[#0d1015] to-[#080a0c]">
                        <LiveKeyboard
                            onPlayNote={handleKeyboardPlay}
                            onStopNote={handleKeyboardStop}
                            activeTrackColor={selectedTrack.startsWith('part') ? (selectedTrack === 'partA' ? '#06b6d4' : '#d946ef') : selectedTrack === 'kick' ? '#f97316' : selectedTrack === 'snare' ? '#22c55e' : selectedTrack === 'sampler' ? '#a855f7' : '#eab308'}
                        />
                    </div>
                </div>
            </main>

            {/* --- HARDWARE MODULE --- */}
            <div className="h-[320px] bg-gradient-to-b from-[#0d0f12] to-[#0f1215] border-t-2 border-cyan-900/30 relative shadow-[0_-10px_60px_rgba(0,0,0,0.8),inset_0_1px_0_rgba(6,182,212,0.1)] z-30 shrink-0 fixed bottom-0 w-full">
                <div className="absolute top-0 left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent"></div>
                <div className="w-full h-full max-w-6xl mx-auto p-4 flex items-center justify-center">
                    <div className="w-full h-full rounded-2xl overflow-hidden border-2 border-gray-700 shadow-[0_0_40px_rgba(0,0,0,0.9),inset_0_2px_4px_rgba(0,0,0,0.5)] bg-gradient-to-br from-black to-[#0a0c0f] relative">
                        <div className="absolute inset-0 rounded-2xl border-2 border-cyan-900/10 pointer-events-none"></div>
                        {renderModulePanel()}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default App