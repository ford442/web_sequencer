import React, { useCallback, useEffect, useRef, useState, memo } from 'react'
import { useAudioEngine } from './hooks/useAudioEngine'
import { usePyodideEngine } from './hooks/usePyodideEngine'
import { useScheduler } from './hooks/useScheduler'
import { HardwareModule } from './components/HardwareModule';
import type { KnobConfig } from './components/HardwareModule';
import { WaveformSelector } from './components/WaveformSelector';
import { NoteSelector } from './components/NoteSelector';
import { LiveKeyboard } from './components/LiveKeyboard';
import { SongMode } from './components/SongMode';
import { PatternSelector } from './components/PatternSelector';
import { SamplerPanel } from './components/SamplerPanel';
import { getNoteColor } from './utils/noteColors';
import {
    INITIAL_PATTERN,
    DEFAULT_TEMPO,
    DEFAULT_SYNTH_PARAMS_A,
    DEFAULT_SYNTH_PARAMS_B,
    DEFAULT_KICK_PARAMS,
    DEFAULT_SNARE_PARAMS,
    DEFAULT_CLOSED_HAT_PARAMS,
    DEFAULT_OPEN_HAT_PARAMS,
    DEFAULT_SAMPLER_PARAMS,
} from './constants'
import type { Pattern, SynthParams, KickParams, SnareParams, SamplerParams, PartSequence, LoadedSample, SongStructure } from './types'

// --- TYPES FOR STORAGE ---
type TrackKey = 'partA' | 'partB' | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'sampler';
type SongSnapshot = {
    pattern: Pattern;
    tempo: number;
    ambianceUrl: string;
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

const NUM_BANKS = 4;
const PATTERNS_PER_BANK = 8;
const TOTAL_PATTERN_SLOTS = NUM_BANKS * PATTERNS_PER_BANK;

// --- COMPONENTS ---

const SvgStep = memo(({
                          stepIndex,
                          active,
                          note,
                          isCurrent,
                          rowLabel,
                          zoom,
                          onClick,
                          onContextMenu
                      }: {
    stepIndex: number,
    active: boolean,
    note?: string | null,
    isCurrent: boolean,
    rowLabel: string,
    zoom: number,
    onClick: () => void,
    onContextMenu: (e: React.MouseEvent) => void
}) => {
    // VISUAL: Hardware style buttons (Smaller for 32 steps)
    const baseWidth = 18;
    const width = baseWidth * zoom;
    const height = 50;
    const gap = 4;
    const x = 140 + stepIndex * (width + gap); // Offset for Track Controls

    // Determine color based on note or default cyan
    const color = note ? getNoteColor(note) : '#06b6d4';

    return (
        <g transform={`translate(${x}, 0)`}
           role="button"
           aria-label={`${rowLabel} step ${stepIndex+1}`}
           onClick={() => onClick()}
           onContextMenu={(e) => { e.preventDefault(); onContextMenu(e as any); }}
           cursor="pointer"
           style={{ transition: 'all 0.1s ease' }}
        >
            {/* Outer Glow for Active Steps */}
            {active && <rect x={-4} y={-4} width={width+8} height={height+8} rx={6} fill={isCurrent ? "rgba(255, 255, 255, 0.3)" : color} fillOpacity={0.4} filter="blur(6px)" />}

            {/* --- 3D BEVEL BASE --- */}
            {/* Shadow/Base Offset */}
            <rect x={0} y={0} width={width} height={height} rx={3} fill="#050505" />

            {/* Main Body Gradient Background */}
            <rect
                x={1} y={1} width={width-2} height={height-2} rx={2}
                fill={active ? '#0d1f15' : '#14181c'}
                strokeWidth={0}
            />

            {/* Top/Left Highlight (Bevel Light) */}
            <path d={`M 2 2 L ${width-2} 2 L ${width-4} 4 L 4 4 L 4 ${height-4} L 2 ${height-2} Z`} fill="rgba(255,255,255,0.2)" />

            {/* Bottom/Right Shadow (Bevel Dark) */}
            <path d={`M ${width-2} 2 L ${width-2} ${height-2} L 2 ${height-2} L 4 ${height-4} L ${width-4} ${height-4} L ${width-4} 4 Z`} fill="rgba(0,0,0,0.5)" />

            {/* Inner "Cap" / Surface */}
            <rect
                x={3} y={4} width={width-6} height={height-8} rx={1}
                fill={active ? color : '#1a2026'}
                fillOpacity={active ? 0.6 : 1}
                stroke={isCurrent ? '#ffffff' : (active ? color : 'none')}
                strokeWidth={isCurrent ? 2 : (active ? 1 : 0)}
            />

            {/* Glassy Highlight on Cap */}
            <rect
                x={4} y={5} width={width-8} height={(height-10)/2} rx={1}
                fill="url(#glassGrad)"
                fillOpacity={0.3}
                pointerEvents="none"
            />

            {/* Bottom LED / Status Light (Inside the cap) */}
            <rect
                x={5} y={height - 10} width={width - 10} height={3} rx={1}
                fill={isCurrent ? '#ff3333' : (active ? '#ccffcc' : '#000')}
                fillOpacity={isCurrent ? 1 : (active ? 0.8 : 0.2)}
                filter={active || isCurrent ? "url(#glow)" : "none"}
            />
        </g>
    )
})

// PER-TRACK STORAGE BUTTON (1-8 per bank)
const bankColors = [
    ['#3fa34d', '#234a2e', '#8fa394'], // Bank A (Green)
    ['#3f8fa3', '#233d4a', '#8fb2c0'], // Bank B (Cyan)
    ['#a33f8f', '#4a233d', '#c08fb2'], // Bank C (Magenta)
    ['#a38f3f', '#4a3d23', '#c0b28f'], // Bank D (Yellow)
];

const TrackSlotButton = ({ bank, index, isActive, hasData, onClick }: { bank: number, index: number, isActive: boolean, hasData: boolean, onClick: () => void }) => {
    const [activeColor, hasDataColor, textColor] = bankColors[bank];
    return (
        <g transform={`translate(${index * 22}, 0)`} onClick={() => onClick()} cursor="pointer">
            <rect
                width={18} height={18} rx={2}
                fill={isActive ? activeColor : (hasData ? hasDataColor : '#0f1812')}
                stroke={isActive ? '#fff' : activeColor}
                strokeWidth={1}
            />
            <text x={9} y={13} textAnchor="middle" fontSize={10} fill={isActive ? '#000' : textColor} fontFamily="monospace" fontWeight="bold">
                {index + 1}
            </text>
        </g>
    );
};

const SequencerRow = memo(({
                               rowKey,
                               label,
                               rowIndex,
                               steps,
                               currentStep,
                               isSelected,
                               activeSlot,
                               slotsData,
                               zoom,
                               activeBank,
                               onToggle,
                               onRightClickStep,
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
    slotsData: boolean[],
    zoom: number,
    activeBank: number,
    onToggle: (k: any, i: number) => void,
    onRightClickStep: (k: TrackKey, i: number, e: any) => void,
    onSelectRow: (k: any) => void,
    onSelectSlot: (k: TrackKey, slot: number) => void
}) => {
    // Tighter vertical spacing
    const stepsToShow = 32 / zoom;
    return (
        <g transform={`translate(0, ${rowIndex * 60})`}>
            {/* Row Label / Selector */}
            <g onClick={() => onSelectRow(rowKey)} cursor="pointer">
                {/* Selection Indicator Bar */}
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

            {/* Track Pattern Slots (1-8) */}
            <g transform="translate(-80, 16)">
                {[0, 1, 2, 3, 4, 5, 6, 7].map(slotInBank => {
                    const absoluteSlotIndex = activeBank * PATTERNS_PER_BANK + slotInBank;
                    return (
                        <TrackSlotButton
                            key={slotInBank}
                            bank={activeBank}
                            index={slotInBank}
                            isActive={activeSlot === absoluteSlotIndex}
                            hasData={slotsData[absoluteSlotIndex]}
                            onClick={() => onSelectSlot(rowKey, slotInBank)}
                        />
                    );
                })}
            </g>

            {steps.slice(0, stepsToShow).map((stepData, i) => (
                <SvgStep
                    key={i}
                    stepIndex={i}
                    active={!!stepData}
                    note={stepData ? stepData.note : null}
                    isCurrent={currentStep === i}
                    rowLabel={label}
                    zoom={zoom}
                    onClick={() => onToggle(rowKey, i)}
                    onContextMenu={(e) => onRightClickStep(rowKey, i, e)}
                />
            ))}
        </g>
    )
})

export const ROWS = [
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
    const {
        audioEngine,
        isReady,
        initializeAudio,
        role,
        setRole,
        remoteTracks,
        toggleRemoteTrack,
    } = useAudioEngine(pyodide);


    const isEngineReady = isReady && (isPyodideReady || !!pyodideStatus)

    // --- STATE ---
    const [pattern, setPattern] = useState<Pattern>(INITIAL_PATTERN)
    const [tempo, setTempo] = useState<number>(DEFAULT_TEMPO)
    const [isInitialized, setIsInitialized] = useState(false)
    const [isPlaying, setIsPlaying] = useState(false)
    const [isRecording, setIsRecording] = useState(false)
    const [currentStep, setCurrentStep] = useState(-1)
    const [selectedTrack, setSelectedTrack] = useState<TrackKey>('partA')
    const [zoom, setZoom] = useState(1);
    const [viewMode, setViewMode] = useState<'pattern' | 'song'>('pattern');
    const [ambianceUrl, setAmbianceUrl] = useState<string>('')
    const [masterVolume, setMasterVolume] = useState(0.8)
    const [masterPan, setMasterPan] = useState(0)

    // --- CONTEXT MENU STATE ---
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, track: TrackKey, step: number } | null>(null);
    const [patternSelector, setPatternSelector] = useState<{ x: number, y: number, trackIndex: number, stepIndex: number } | null>(null);

    // --- ANIMATION LOOP FOR LOADING ---
    const [loadingTick, setLoadingTick] = useState(0);
    useEffect(() => {
        if (isPyodideReady) return; // Stop animation when ready
        const interval = setInterval(() => {
            setLoadingTick(t => (t + 1) % 1000);
        }, 100);
        return () => clearInterval(interval);
    }, [isPyodideReady]);

    const getLoadingStepData = (rIdx: number) => {
         return Array(32).fill(null).map((_, i) => {
             // Specific Geometric Pattern: "Digital Scanner" + Diagonal
             // 1. Diagonal sweep
             const diag = (i + rIdx + loadingTick) % 8 === 0;
             // 2. Scanner ping (left to right)
             const scanPos = loadingTick % 32;
             const scanner = (i === scanPos) || (i === 31 - scanPos);

             const active = diag || scanner;
             return active ? { note: 'C4', velocity: 1 } : null;
         });
    }

    // --- STORAGE STATE ---
    const [activeBank, setActiveBank] = useState(0);

    // Per-track storage: Map of TrackKey -> Array[32] of PartSequence
    const [trackStorage, setTrackStorage] = useState<Record<TrackKey, (PartSequence | null)[]>>({
        partA: Array(TOTAL_PATTERN_SLOTS).fill(null),
        partB: Array(TOTAL_PATTERN_SLOTS).fill(null),
        kick: Array(TOTAL_PATTERN_SLOTS).fill(null),
        snare: Array(TOTAL_PATTERN_SLOTS).fill(null),
        closedHat: Array(TOTAL_PATTERN_SLOTS).fill(null),
        openHat: Array(TOTAL_PATTERN_SLOTS).fill(null),
        sampler: Array(TOTAL_PATTERN_SLOTS).fill(null),
    });

    // Active slot visual tracking (stores the absolute index 0-31)
    const [activeTrackSlots, setActiveTrackSlots] = useState<Record<TrackKey, number>>({
        partA: 0, partB: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: 0
    });

    // Global Song Storage (Slots A-D)
    const [songStorage, setSongStorage] = useState<(SongSnapshot | null)[]>([null, null, null, null]);
    const [activeSongSlot, setActiveSongSlot] = useState<number | null>(null);

    // --- SONG MODE STATE ---
    const [song, setSong] = useState<SongStructure>({
        length: 128,
        loop: true,
        loopLength: 16,
        steps: Array(7).fill(null).map(() => Array(128).fill({ patternIndex: null })),
        currentSongStep: -1,
    });
    const [songZoom, setSongZoom] = useState(1);
    const [songScroll, setSongScroll] = useState(0);

    // --- INSTRUMENT STATE ---
    const [synthA, setSynthA] = useState<SynthParams>(DEFAULT_SYNTH_PARAMS_A);
    const synthARef = useRef<SynthParams>(DEFAULT_SYNTH_PARAMS_A);
    const updateSynthA = (updates: Partial<SynthParams>) => { const n = { ...synthA, ...updates }; setSynthA(n); synthARef.current = n; };

    const [synthB, setSynthB] = useState<SynthParams>(DEFAULT_SYNTH_PARAMS_B);
    const synthBRef = useRef<SynthParams>(DEFAULT_SYNTH_PARAMS_B);
    const updateSynthB = (updates: Partial<SynthParams>) => { const n = { ...synthB, ...updates }; setSynthB(n); synthBRef.current = n; };

    const [kick, setKick] = useState<KickParams>(DEFAULT_KICK_PARAMS);
    const kickRef = useRef(DEFAULT_KICK_PARAMS);
    const updateKick = (u: Partial<KickParams>) => { const n = { ...kick, ...u }; setKick(n); kickRef.current = n; };

    const [snare, setSnare] = useState<SnareParams>(DEFAULT_SNARE_PARAMS);
    const snareRef = useRef(DEFAULT_SNARE_PARAMS);
    const updateSnare = (u: Partial<SnareParams>) => { const n = { ...snare, ...u }; setSnare(n); snareRef.current = n; };

    const [closedHat, setClosedHat] = useState(DEFAULT_CLOSED_HAT_PARAMS);
    const closedHatRef = useRef(DEFAULT_CLOSED_HAT_PARAMS);
    const updateClosedHat = (u: Partial<typeof DEFAULT_CLOSED_HAT_PARAMS>) => { const n = { ...closedHat, ...u }; setClosedHat(n); closedHatRef.current = n; };

    const [openHat, setOpenHat] = useState(DEFAULT_OPEN_HAT_PARAMS);
    const openHatRef = useRef(DEFAULT_OPEN_HAT_PARAMS);
    const updateOpenHat = (u: Partial<typeof DEFAULT_OPEN_HAT_PARAMS>) => { const n = { ...openHat, ...u }; setOpenHat(n); openHatRef.current = n; };

    const [sampler, setSampler] = useState(DEFAULT_SAMPLER_PARAMS);
    const samplerRef = useRef(DEFAULT_SAMPLER_PARAMS);
    const updateSampler = (u: Partial<SamplerParams>) => { const n = { ...sampler, ...u }; setSampler(n); samplerRef.current = n; };

    const [loadedSamples, setLoadedSamples] = useState<LoadedSample[]>([]);

    const handleTuneSample = (sampleName: string): Promise<void> => {
        return new Promise(async (resolve, reject) => {
            const sample = loadedSamples.find(s => s.name === sampleName);
            if (audioEngine && sample) {
                const newSpeed = await audioEngine.analyzeAndTuneSample(sample.buffer);
                if (newSpeed) {
                    // This is a tricky one. Do we store the tuned speed globally
                    // or just apply it to the current sampler settings?
                    // For now, let's apply to the current sampler.
                    updateSampler({ playbackSpeed: newSpeed, sampleName: sample.name });
                    resolve();
                } else {
                    reject(new Error("Analysis failed"));
                }
            } else {
                reject(new Error("Audio engine or sample not ready."));
            }
        });
    };

    // --- AUDIO LOOP ---
    const getCurrentTime = useCallback(() => {
        return audioEngine?.context.currentTime || 0;
    }, [audioEngine]);

    const onStep = useCallback((step: { songStep: number, subStep: number }, scheduledTime?: number) => {
        if (!audioEngine) return;
        const time = scheduledTime || audioEngine.context.currentTime;

        if (viewMode === 'pattern') {
            if (pattern.partA.steps[step.subStep]) audioEngine.playSynth(synthARef.current, pattern.partA.steps[step.subStep]!.note, time, undefined, 'partA', step.subStep);
            if (pattern.partB.steps[step.subStep]) audioEngine.playSynth(synthBRef.current, pattern.partB.steps[step.subStep]!.note, time, undefined, 'partB', step.subStep);
            if (pattern.kick.steps[step.subStep]) audioEngine.playDrum('kick', kickRef.current, time);
            if (pattern.snare.steps[step.subStep]) audioEngine.playDrum('snare', snareRef.current, time);
            if (pattern.openHat.steps[step.subStep]) audioEngine.playDrum('openHat', openHatRef.current, time);
            else if (pattern.closedHat.steps[step.subStep]) audioEngine.playDrum('closedHat', closedHatRef.current, time);
            if (pattern.sampler.steps[step.subStep]) audioEngine.playSampler(samplerRef.current, pattern.sampler.steps[step.subStep]!.note, time);
        } else {
            // Song Mode playback
            if (step.songStep < 0) return;
            ROWS.forEach((row, trackIndex) => {
                const patternIndex = song.steps[trackIndex][step.songStep]?.patternIndex;
                if (patternIndex !== null && patternIndex !== undefined) {
                    const patternToPlay = trackStorage[row.key][patternIndex];
                    if (patternToPlay) {
                        const partSequence = patternToPlay;
                        if (partSequence && partSequence.steps[step.subStep]) {
                            const note = partSequence.steps[step.subStep]!.note;
                            switch (row.key) {
                                case 'partA': audioEngine.playSynth(synthARef.current, note, time, undefined, 'partA', step.subStep); break;
                                case 'partB': audioEngine.playSynth(synthBRef.current, note, time, undefined, 'partB', step.subStep); break;
                                case 'kick': audioEngine.playDrum('kick', kickRef.current, time); break;
                                case 'snare': audioEngine.playDrum('snare', snareRef.current, time); break;
                                case 'openHat': audioEngine.playDrum('openHat', openHatRef.current, time); break;
                                case 'closedHat':
                                    // Find if there is an open hat on this step for the openHat track
                                    const openHatTrackIndex = ROWS.findIndex(r => r.key === 'openHat');
                                    const openHatPatternIndex = song.steps[openHatTrackIndex][step.songStep]?.patternIndex;
                                    if (openHatPatternIndex !== null && openHatPatternIndex !== undefined) {
                                        const openHatPattern = trackStorage['openHat'][openHatPatternIndex];
                                        if (!openHatPattern?.steps[step.subStep]) {
                                            audioEngine.playDrum('closedHat', closedHatRef.current, time);
                                        }
                                    } else {
                                        audioEngine.playDrum('closedHat', closedHatRef.current, time);
                                    }
                                    break;
                                case 'sampler': audioEngine.playSampler(samplerRef.current, note, time); break;
                            }
                        }
                    }
                }
            });
        }
    }, [audioEngine, pattern, viewMode, song.steps, trackStorage]);

    const lookahead = role === 'master' ? 0.4 : 0.1;
    const schedulerConfig = {
        mode: viewMode,
        pattern: pattern,
        song: song,
        trackStorage: trackStorage,
    };
    const { isPlaying: schedPlaying, currentSubStep, currentSongStep, setIsPlaying: setSchedPlaying } = useScheduler(tempo, schedulerConfig, onStep, isEngineReady, getCurrentTime, lookahead);

    useEffect(() => setIsPlaying(schedPlaying), [schedPlaying])
    useEffect(() => {
        if (viewMode === 'pattern') {
            setCurrentStep(currentSubStep);
        } else {
            setSong((s: SongStructure) => ({ ...s, currentSongStep }));
        }
    }, [currentSubStep, currentSongStep, viewMode]);

    const handlePlayToggle = async () => {
        if (!isInitialized) { await initializeAudio(); setIsInitialized(true); }
        setSchedPlaying(!schedPlaying)
    }

    // --- LOGIC HANDLERS ---

    const handleMasterVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = parseFloat(e.target.value);
        setMasterVolume(v);
        if (audioEngine) {
            audioEngine.setMasterVolume(v);
        }
    };

    const handleMasterPan = (e: React.ChangeEvent<HTMLInputElement>) => {
        let v = parseFloat(e.target.value);
        // Center Snap
        if (v > -0.1 && v < 0.1) v = 0;

        setMasterPan(v);
        if (audioEngine) {
            audioEngine.setMasterPan(v);
        }
    };

    const toggleStep = useCallback((rowKey: TrackKey, i: number) => {
        setPattern(prev => {
            const copy = JSON.parse(JSON.stringify(prev)) as Pattern
            const arr = copy[rowKey].steps
            // Default note per track type
            const defaultNote = rowKey.startsWith('part') ? (rowKey === 'partA' ? 'C4' : 'C3') : 'C4';
            arr[i] = arr[i] ? null : { note: defaultNote, velocity: 1 }
            return copy
        })
    }, [])

    const handleKeyboardPlay = (note: string) => {
        if (!audioEngine) return;
        const time = audioEngine.context.currentTime;

        // 1. Play Sound Immediately
        if (selectedTrack === 'partA') audioEngine.playSynth(synthARef.current, note, time);
        else if (selectedTrack === 'partB') audioEngine.playSynth(synthBRef.current, note, time);
        else if (selectedTrack === 'kick') audioEngine.playDrum('kick', { ...kickRef.current, pitch: 60 }, time); // Fixed pitch for now or vary?
        else if (selectedTrack === 'snare') audioEngine.playDrum('snare', snareRef.current, time);
        else if (selectedTrack === 'closedHat') audioEngine.playDrum('closedHat', closedHatRef.current, time);
        else if (selectedTrack === 'openHat') audioEngine.playDrum('openHat', openHatRef.current, time);
        else if (selectedTrack === 'sampler') audioEngine.playSampler(samplerRef.current, note, time);

        // 2. Record if enabled
        if (isRecording && isPlaying && currentStep >= 0) {
            // Quantize to current step
            setPattern(prev => {
                const copy = JSON.parse(JSON.stringify(prev)) as Pattern;
                copy[selectedTrack].steps[currentStep] = { note, velocity: 1 };
                return copy;
            });
        }
    };

    const handleRightClickStep = useCallback((track: TrackKey, step: number, e: React.MouseEvent) => {
        const stepData = pattern[track].steps[step];
        // Only show menu if step is active
        if (stepData) {
            setContextMenu({ x: e.clientX, y: e.clientY, track, step });
        }
    }, [pattern]);

    const handleNoteSelect = (note: string) => {
        if (!contextMenu) return;
        setPattern(prev => {
            const copy = JSON.parse(JSON.stringify(prev)) as Pattern;
            const stepData = copy[contextMenu.track].steps[contextMenu.step];
            if (stepData) {
                stepData.note = note;
            }
            return copy;
        });
        setContextMenu(null);
    };

    const handleSongStepRightClick = (trackIndex: number, stepIndex: number, e: React.MouseEvent) => {
        setPatternSelector({ x: e.clientX, y: e.clientY, trackIndex, stepIndex });
    };

    const handlePatternSelect = (patternIndex: number) => {
        if (!patternSelector) return;
        setSong((prev: SongStructure) => {
            const newSteps = prev.steps.map(track => [...track]);
            newSteps[patternSelector.trackIndex][patternSelector.stepIndex] = {
                patternIndex: patternIndex === -1 ? null : patternIndex
            };
            return { ...prev, steps: newSteps };
        });
        setPatternSelector(null);
    };

    const handleClearPattern = () => {
        if (window.confirm("Clear current pattern?")) {
            setPattern({
                length: 32,
                partA: { steps: Array(32).fill(null) },
                partB: { steps: Array(32).fill(null) },
                kick: { steps: Array(32).fill(null) },
                snare: { steps: Array(32).fill(null) },
                closedHat: { steps: Array(32).fill(null) },
                openHat: { steps: Array(32).fill(null) },
                sampler: { steps: Array(32).fill(null) },
            });
        }
    };

    // --- STORAGE LOGIC ---

    const handleTrackSlotClick = (track: TrackKey, slotIndexInBank: number) => {
        const absoluteSlotIndex = activeBank * PATTERNS_PER_BANK + slotIndexInBank;

        const storedPartSequence = trackStorage[track][absoluteSlotIndex];

        if (storedPartSequence) {
            // If the slot is not empty, ask for confirmation to overwrite
            if (window.confirm(`Overwrite pattern ${String.fromCharCode(65 + activeBank)}${slotIndexInBank + 1} for ${track}?`)) {
                // Save the current track's part sequence into the slot
                setTrackStorage(prev => {
                    const newStorage = { ...prev };
                    newStorage[track] = [...prev[track]];
                    newStorage[track][absoluteSlotIndex] = pattern[track];
                    return newStorage;
                });
            } else {
                // Load the stored part sequence into the current pattern for that track
                setPattern(prev => ({
                    ...prev,
                    [track]: storedPartSequence,
                }));
            }
        } else {
            // Save the current track's part sequence into the empty slot
            setTrackStorage(prev => {
                const newStorage = { ...prev };
                newStorage[track] = [...prev[track]];
                newStorage[track][absoluteSlotIndex] = pattern[track];
                return newStorage;
            });
        }
        // Always set the clicked slot as active
        setActiveTrackSlots(prev => ({ ...prev, [track]: absoluteSlotIndex }));
    };

    const saveSong = (slot: number) => {
        const snapshot: SongSnapshot = {
            pattern, tempo, ambianceUrl,
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
        setSynthA(snapshot.params.synthA); synthARef.current = snapshot.params.synthA;
        setSynthB(snapshot.params.synthB); synthBRef.current = snapshot.params.synthB;
        setKick(snapshot.params.kick); kickRef.current = snapshot.params.kick;
        setSnare(snapshot.params.snare); snareRef.current = snapshot.params.snare;
        setClosedHat(snapshot.params.closedHat); closedHatRef.current = snapshot.params.closedHat;
        setOpenHat(snapshot.params.openHat); openHatRef.current = snapshot.params.openHat;
        setSampler(snapshot.params.sampler); samplerRef.current = snapshot.params.sampler;
        setActiveSongSlot(slot);
    };

    // --- MODULE RENDER HELPERS ---
    const getSynthControls = (params: SynthParams): KnobConfig[] => [
         // Row 1: ADSR (Smaller)
         { id: 'attack', label: 'ATK', x: 0.20, y: 0.25, size: 0.08, value: params.attack },
         { id: 'decay', label: 'DEC', x: 0.35, y: 0.25, size: 0.08, value: params.decay / 2 },
         { id: 'sustain', label: 'SUS', x: 0.50, y: 0.25, size: 0.08, value: params.sustain },
         { id: 'release', label: 'REL', x: 0.65, y: 0.25, size: 0.08, value: params.release / 2 },

         // Row 2: Filter (Larger)
         { id: 'filterCutoff', label: 'CUTOFF', x: 0.35, y: 0.60, size: 0.12, value: params.filterCutoff / 8000 },
         { id: 'filterResonance', label: 'RES', x: 0.50, y: 0.60, size: 0.12, value: params.filterResonance / 20 },

         // Sides:
         { id: 'pitch', label: 'TUNE', x: 0.10, y: 0.50, size: 0.09, value: (params.pitch + 24) / 48 },
         { id: 'length', label: 'GATE', x: 0.75, y: 0.50, size: 0.09, value: (params.length || 0.25) / 2 }, // Max 2s

         // Output / FX
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

    const handleSynthChange = (isA: boolean, id: string, val: number) => {
        const updater = isA ? updateSynthA : updateSynthB;
        let realVal = val;
        if (id === 'pitch') realVal = Math.floor(val * 48 - 24);
        else if (id === 'filterCutoff') realVal = val * 8000;
        else if (id === 'filterResonance') realVal = val * 20;
        else if (id === 'decay') realVal = val * 2;
        else if (id === 'release') realVal = val * 2;
        else if (id === 'length') realVal = val * 2;
        updater({ [id]: realVal });
    };

    const handleKickChange = (id: string, val: number) => {
        let realVal = val;
        if (id === 'pitch') realVal = val * 130 + 20;
        updateKick({ [id]: realVal });
    };

    const handleSnareChange = (id: string, val: number) => {
        let realVal = val;
        if (id === 'tone') realVal = val * 300 + 100;
        else if (id === 'noise') realVal = val * 7000 + 1000;
        else if (id === 'decay') realVal = val * 0.5;
        updateSnare({ [id]: realVal });
    };

    const handleClosedHatChange = (id: string, val: number) => updateClosedHat({ [id]: val });
    const handleOpenHatChange = (id: string, val: number) => updateOpenHat({ [id]: val });
    const handleSamplerChange = (u: Partial<SamplerParams>) => updateSampler(u);

    const renderModulePanel = () => {
        const isPartA = selectedTrack === 'partA';
        const isPartB = selectedTrack === 'partB';

        if (isPartA) return <HardwareModule trackId="partA" isRemote={remoteTracks['partA']} onToggleRemote={toggleRemoteTrack} title="SYNTH A // LEAD" colorHex={[0.0, 0.9, 1.0]} controls={getSynthControls(synthA)} onParamChange={(id, v) => handleSynthChange(true, id, v)}><div className="absolute top-4 right-6 pointer-events-auto"><WaveformSelector selected={synthA.waveform} onChange={(w) => updateSynthA({ waveform: w })} accentColor="cyan" /></div></HardwareModule>;
        if (isPartB) return <HardwareModule trackId="partB" isRemote={remoteTracks['partB']} onToggleRemote={toggleRemoteTrack} title="SYNTH B // BASS" colorHex={[1.0, 0.2, 0.8]} controls={getSynthControls(synthB)} onParamChange={(id, v) => handleSynthChange(false, id, v)}><div className="absolute top-4 right-6 pointer-events-auto"><WaveformSelector selected={synthB.waveform} onChange={(w) => updateSynthB({ waveform: w })} accentColor="pink" /></div></HardwareModule>;
        if (selectedTrack === 'kick') return <HardwareModule title="KICK DRUM" colorHex={[1.0, 0.6, 0.0]} controls={getKickControls(kick)} onParamChange={(id, v) => handleKickChange(id, v)} />;
        if (selectedTrack === 'snare') return <HardwareModule title="SNARE DRUM" colorHex={[0.2, 1.0, 0.2]} controls={getSnareControls(snare)} onParamChange={(id, v) => handleSnareChange(id, v)} />;
        if (selectedTrack === 'closedHat') return <HardwareModule title="CLOSED HAT" colorHex={[0.8, 0.8, 0.0]} controls={getClosedHatControls(closedHat)} onParamChange={handleClosedHatChange} />;
        if (selectedTrack === 'openHat') return <HardwareModule title="OPEN HAT" colorHex={[0.9, 0.5, 0.0]} controls={getOpenHatControls(openHat)} onParamChange={handleOpenHatChange} />;
        if (selectedTrack === 'sampler') return <HardwareModule title="SAMPLER" colorHex={[0.6, 0.4, 1.0]} controls={[]} onParamChange={() => {}}><SamplerPanel
            params={sampler}
            onChange={handleSamplerChange}
            loadedSamples={loadedSamples}
            onLoadSample={(name, buffer) => {
                audioEngine?.loadSampleToEngine(name, buffer);
                setLoadedSamples(prev => [...prev, { name, buffer }]);
                updateSampler({ sampleName: name }); // Auto-select the new sample
            }}
            onTuneSample={() => handleTuneSample(sampler.sampleName)}
            audioContext={audioEngine?.context}
            initializeAudio={initializeAudio}
        /></HardwareModule>;
        return null;
    };

    return (
        <div className="flex flex-col h-screen w-screen bg-[#080a0b] text-gray-200 overflow-hidden font-sans">

            {/* --- ROLE SWITCHER UI --- */}
            <div className="fixed bottom-[310px] right-4 z-40 bg-gray-900/50 backdrop-blur-sm border border-gray-700 rounded p-1 flex items-center gap-1">
                <button
                    onClick={() => setRole('master')}
                    className={`px-3 py-1 text-xs font-bold rounded ${role === 'master' ? 'bg-cyan-500 text-black' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                >
                    MASTER
                </button>
                <button
                    onClick={() => setRole('renderer')}
                    className={`px-3 py-1 text-xs font-bold rounded ${role === 'renderer' ? 'bg-purple-500 text-black' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                >
                    RENDERER
                </button>
            </div>


            {/* --- TOP HEADER --- */}
            <header className="h-16 flex items-center justify-between px-4 bg-[#0b0d10] border-b border-gray-800 z-20 shadow-md shrink-0">

                {/* LEFT: Title & Global Song Storage */}
                <div className="flex items-center gap-6">
                    <h1 className="text-lg font-bold font-orbitron text-cyan-500 tracking-wider hidden md:block">ELECTRIBE<span className="text-white">WEB</span></h1>

                        {/* Bank Selectors */}
                        <div className="flex items-center gap-2 bg-gray-900 p-1 rounded border border-gray-700">
                            <span className="text-[10px] text-gray-500 font-mono uppercase px-1">Bank</span>
                            {[0, 1, 2, 3].map(bankIdx => {
                                const color = bankColors[bankIdx][0];
                                return (
                                    <button
                                        key={bankIdx}
                                        onClick={() => setActiveBank(bankIdx)}
                                        className={`w-6 h-6 text-xs font-mono rounded transition-all border`}
                                        style={{
                                            backgroundColor: activeBank === bankIdx ? color : '#1a2026',
                                            borderColor: color,
                                            color: activeBank === bankIdx ? 'black' : color,
                                            boxShadow: activeBank === bankIdx ? `0 0 10px ${color}` : 'none'
                                        }}
                                        title={`Select Pattern Bank ${String.fromCharCode(65 + bankIdx)}`}
                                    >
                                        {String.fromCharCode(65 + bankIdx)}
                                    </button>
                                );
                            })}
                        </div>

                    {/* Global Song Snapshots */}
                    <div className="flex items-center gap-2 bg-gray-900 p-1 rounded border border-gray-700">
                        <span className="text-[10px] text-gray-500 font-mono uppercase px-1">Song</span>
                        {[0, 1, 2, 3].map(slot => (
                            <button
                                key={slot}
                                onClick={() => {
                                    if (songStorage[slot]) loadSong(slot);
                                    else saveSong(slot);
                                }}
                                onContextMenu={(e) => { e.preventDefault(); saveSong(slot); }} // Right click to overwrite
                                className={`w-6 h-6 text-xs font-mono rounded transition-all ${
                                    activeSongSlot === slot ? 'bg-cyan-600 text-white shadow-[0_0_10px_rgba(6,182,212,0.5)]' : 
                                    (songStorage[slot] ? 'bg-cyan-900/30 text-cyan-400 border border-cyan-900' : 'bg-gray-800 text-gray-600 border border-gray-700')
                                }`}
                                title="Click to Load (if empty, Save). Right-Click to Save/Overwrite."
                            >
                                {slot + 1}
                            </button>
                        ))}
                    </div>

                    <button onClick={handleClearPattern} className="text-xs font-bold text-red-400 hover:text-red-300 border border-red-900/50 bg-red-900/10 hover:bg-red-900/30 px-3 py-1 rounded transition-all">
                        CLEAR
                    </button>

                    {/* View Mode Toggle */}
                    <div className="flex items-center bg-gray-900 rounded border border-gray-700 p-1">
                        <button onClick={() => setViewMode('pattern')} className={`px-3 py-1 text-xs rounded ${viewMode === 'pattern' ? 'bg-cyan-500 text-black' : 'hover:bg-gray-800'}`}>PATTERN</button>
                        <button onClick={() => setViewMode('song')} className={`px-3 py-1 text-xs rounded ${viewMode === 'song' ? 'bg-purple-500 text-black' : 'hover:bg-gray-800'}`}>SONG</button>
                    </div>
                </div>

                {/* RIGHT: Transport & Master Volume */}
                <div className="flex items-center gap-4">

                    {/* Master Pan */}
                    <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500 font-mono uppercase">Pan</span>
                        <input
                            type="range" min="-1" max="1" step="0.01"
                            value={masterPan} onChange={handleMasterPan}
                            className="w-24 h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                            title="Global Pan (Left/Right)"
                        />
                    </div>

                    {/* Master Volume */}
                    <div className="flex items-center gap-2 mr-4">
                        <span className="text-[10px] text-gray-500 font-mono uppercase">Vol</span>
                        <input
                            type="range" min="0" max="1.2" step="0.01"
                            value={masterVolume} onChange={handleMasterVolume}
                            className="w-24 h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                        />
                    </div>

                    <div className="flex items-center gap-2">
                         <div className="flex items-center bg-gray-900 rounded border border-gray-700 scale-90">
                            <button onClick={() => setTempo(t => t-1)} className="px-2 py-1 text-cyan-500 font-bold border-r border-gray-700 hover:bg-gray-800">-</button>
                            <span className="w-12 text-center font-mono text-cyan-300 text-sm">{tempo}</span>
                            <button onClick={() => setTempo(t => t+1)} className="px-2 py-1 text-cyan-500 font-bold border-l border-gray-700 hover:bg-gray-800">+</button>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center bg-gray-900 rounded border border-gray-700 scale-90">
                            <button onClick={() => setPattern(p => ({...p, length: Math.max(1, p.length - 1)}))} className="px-2 py-1 text-cyan-500 font-bold border-r border-gray-700 hover:bg-gray-800">-</button>
                            <span className="w-12 text-center font-mono text-cyan-300 text-sm">{pattern.length} STEPS</span>
                            <button onClick={() => setPattern(p => ({...p, length: Math.min(32, p.length + 1)}))} className="px-2 py-1 text-cyan-500 font-bold border-l border-gray-700 hover:bg-gray-800">+</button>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center bg-gray-900 rounded border border-gray-700 scale-90">
                            <button onClick={() => setZoom(z => Math.max(1, z / 2))} className="px-2 py-1 text-cyan-500 font-bold border-r border-gray-700 hover:bg-gray-800">-</button>
                            <span className="w-12 text-center font-mono text-cyan-300 text-sm">ZOOM {zoom}x</span>
                            <button onClick={() => setZoom(z => Math.min(4, z * 2))} className="px-2 py-1 text-cyan-500 font-bold border-l border-gray-700 hover:bg-gray-800">+</button>
                        </div>
                    </div>

                    {/* REC BUTTON */}
                     <button
                        onClick={() => setIsRecording(!isRecording)}
                        className={`w-12 py-1 rounded font-orbitron text-sm font-bold tracking-wide transition-all shadow-lg mr-2 ${
                            isRecording
                            ? 'bg-red-600 text-white border border-red-500 shadow-[0_0_15px_rgba(255,0,0,0.5)] animate-pulse'
                            : 'bg-gray-800 text-red-700 border border-gray-700 hover:bg-gray-700'
                        }`}
                        title="Enable Recording (Input notes from keyboard will be saved to pattern)"
                    >
                        REC
                    </button>

                    <button
                        onClick={handlePlayToggle}
                        className={`w-24 py-1 rounded font-orbitron text-sm font-bold tracking-wide transition-all shadow-lg ${
                            isPlaying 
                            ? 'bg-red-900/20 text-red-400 border border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.2)]' 
                            : 'bg-green-900/20 text-green-400 border border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.2)]'
                        }`}
                    >
                        {isPlaying ? 'STOP' : 'PLAY'}
                    </button>
                </div>
            </header>

            {/* --- SEQUENCER --- */}
            <main className="flex-1 relative bg-gradient-to-b from-[#111827] to-[#050709] shadow-inner flex flex-col justify-start pt-8 pb-4">

                {contextMenu && (
                    <NoteSelector
                        x={contextMenu.x}
                        y={contextMenu.y}
                        trackType={contextMenu.track.startsWith('part') ? 'synth' : 'drum'}
                        currentNote={pattern[contextMenu.track].steps[contextMenu.step]?.note || ''}
                        onSelect={handleNoteSelect}
                        onClose={() => setContextMenu(null)}
                        getNoteColor={getNoteColor}
                    />
                )}

                {patternSelector && (
                    <PatternSelector
                        x={patternSelector.x}
                        y={patternSelector.y}
                        onSelect={handlePatternSelect}
                        onClose={() => setPatternSelector(null)}
                    />
                )}

                {viewMode === 'pattern' ? (
                    <div className="w-full max-w-[920px] mx-auto h-[460px] border border-gray-800 rounded-lg bg-[#080a0c] relative shadow-[0_0_60px_rgba(0,0,0,0.8)_inset] overflow-hidden">
                        {/* Decorative screws */}
                        <div className="absolute top-2 left-2 w-3 h-3 rounded-full bg-gray-800 flex items-center justify-center"><div className="w-full h-[1px] bg-gray-900 rotate-45"></div></div>
                        <div className="absolute top-2 right-2 w-3 h-3 rounded-full bg-gray-800 flex items-center justify-center"><div className="w-full h-[1px] bg-gray-900 rotate-45"></div></div>
                        <div className="absolute bottom-2 left-2 w-3 h-3 rounded-full bg-gray-800 flex items-center justify-center"><div className="w-full h-[1px] bg-gray-900 rotate-45"></div></div>
                        <div className="absolute bottom-2 right-2 w-3 h-3 rounded-full bg-gray-800 flex items-center justify-center"><div className="w-full h-[1px] bg-gray-900 rotate-45"></div></div>

                        <svg viewBox="0 0 920 420" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" className="drop-shadow-lg">
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
                                        slotsData={trackStorage[row.key].map(s => s !== null)}
                                        zoom={zoom}
                                        activeBank={activeBank}
                                        onToggle={toggleStep}
                                        onRightClickStep={handleRightClickStep}
                                        onSelectRow={(k) => setSelectedTrack(k as TrackKey)}
                                        onSelectSlot={handleTrackSlotClick}
                                    />
                                ))}
                            </g>
                        </svg>
                    </div>
                ) : (
                    <SongMode
                        song={song}
                        zoom={songZoom}
                        scroll={songScroll}
                        onZoomChange={setSongZoom}
                        onScrollChange={setSongScroll}
                        onLengthChange={(l) => setSong((s: SongStructure) => ({ ...s, length: l }))}
                        onLoopLengthChange={(l) => setSong((s: SongStructure) => ({ ...s, loopLength: l }))}
                        onLoopToggle={() => setSong((s: SongStructure) => ({ ...s, loop: !s.loop }))}
                        onStepRightClick={handleSongStepRightClick}
                    />
                )}

                {/* --- LIVE KEYBOARD --- */}
                <div className="shrink-0 pb-4">
                     <LiveKeyboard
                        onPlayNote={handleKeyboardPlay}
                        activeTrackColor={
                            selectedTrack.startsWith('part') ? (selectedTrack === 'partA' ? '#06b6d4' : '#d946ef') :
                            selectedTrack === 'kick' ? '#f97316' :
                            selectedTrack === 'snare' ? '#22c55e' :
                            selectedTrack === 'sampler' ? '#a855f7' : '#eab308'
                        }
                     />
                </div>
            </main>

            {/* --- HARDWARE MODULE --- */}
            <div className="h-[300px] bg-[#0f1215] border-t border-gray-800 relative shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-30 shrink-0 fixed bottom-0 w-full">
                <div className="w-full h-full max-w-5xl mx-auto p-2 flex items-center justify-center">
                    <div className="w-full h-full rounded-xl overflow-hidden border border-gray-800 shadow-2xl bg-black">
                        {renderModulePanel()}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default App
