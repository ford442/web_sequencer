import React, { useCallback, useEffect, useRef, useState, memo } from 'react'
import { useAudioEngine } from './hooks/useAudioEngine'
import { usePyodideEngine } from './hooks/usePyodideEngine'
import { useScheduler } from './hooks/useScheduler'
import { HardwareModule } from './components/HardwareModule';
import type { KnobConfig } from './components/HardwareModule';
import { WaveformSelector } from './components/WaveformSelector';
import { NoteSelector } from './components/NoteSelector';
import { LiveKeyboard } from './components/LiveKeyboard';
import { SamplerPanel } from './components/SamplerPanel';
import { SongMode } from './components/SongMode';
import { exportSongToXM } from './utils/xmExport';
import { getNoteColor } from './utils/noteColors';
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

// --- COMPONENTS ---

const SvgStep = memo(({
                          stepIndex,
                          active,
                          note,
                          isCurrent,
                          rowLabel,
                          onClick,
                          onContextMenu
                      }: {
    stepIndex: number,
    active: boolean,
    note?: string | null,
    isCurrent: boolean,
    rowLabel: string,
    onClick: () => void,
    onContextMenu: (e: React.MouseEvent) => void
}) => {
    // VISUAL: Hardware style buttons (Smaller for 32 steps)
    const width = 18;
    const height = 50;
    const gap = 4;
    const x = 220 + stepIndex * (width + gap); // Offset for Track Controls (Increased for 8 slots)

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

// PER-TRACK STORAGE BUTTON (1-4)
const TrackSlotButton = ({ index, isActive, hasData, onClick }: { index: number, isActive: boolean, hasData: boolean, onClick: () => void }) => (
    <g transform={`translate(${index * 22}, 0)`} onClick={() => onClick()} cursor="pointer">
        <rect
            width={18} height={18} rx={2}
            fill={isActive ? '#3fa34d' : (hasData ? '#234a2e' : '#0f1812')}
            stroke={isActive ? '#fff' : '#3fa34d'}
            strokeWidth={1}
        />
        <text x={9} y={13} textAnchor="middle" fontSize={10} fill={isActive ? '#000' : '#8fa394'} fontFamily="monospace" fontWeight="bold">
            {index + 1}
        </text>
    </g>
);

const SequencerRow = memo(({
                               rowKey,
                               label,
                               rowIndex,
                               steps,
                               currentStep,
                               isSelected,
                               activeSlot,
                               slotsData,
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
    onToggle: (k: any, i: number) => void,
    onRightClickStep: (k: TrackKey, i: number, e: any) => void,
    onSelectRow: (k: any) => void,
    onSelectSlot: (k: TrackKey, slot: number) => void
}) => {
    // Tighter vertical spacing
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
            <g transform="translate(30, 16)">
                {[0, 1, 2, 3, 4, 5, 6, 7].map(slot => (
                    <TrackSlotButton
                        key={slot}
                        index={slot}
                        isActive={activeSlot === slot}
                        hasData={slotsData[slot]}
                        onClick={() => onSelectSlot(rowKey, slot)}
                    />
                ))}
            </g>

            {steps.map((stepData, i) => (
                <SvgStep
                    key={i}
                    stepIndex={i}
                    active={!!stepData}
                    note={stepData ? stepData.note : null}
                    isCurrent={currentStep === i}
                    rowLabel={label}
                    onClick={() => onToggle(rowKey, i)}
                    onContextMenu={(e) => onRightClickStep(rowKey, i, e)}
                />
            ))}
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
    const { audioEngine, isReady, initializeAudio } = useAudioEngine(pyodide)

    const isEngineReady = isReady && (isPyodideReady || !!pyodideStatus)

    // --- STATE ---
    const [pattern, setPattern] = useState<Pattern>(INITIAL_PATTERN)
    const [tempo, setTempo] = useState<number>(DEFAULT_TEMPO)
    const [isInitialized, setIsInitialized] = useState(false)
    const [isPlaying, setIsPlaying] = useState(false)
    const [isRecording, setIsRecording] = useState(false)
    const [currentStep, setCurrentStep] = useState(-1)
    const [selectedTrack, setSelectedTrack] = useState<TrackKey>('partA')
    const [ambianceUrl, setAmbianceUrl] = useState<string>('')
    const [masterVolume, setMasterVolume] = useState(0.8)
    const [globalPan, setGlobalPan] = useState(0) // <-- NEW: Global Pan

    // --- SONG MODE STATE ---
    const [isSongModeOpen, setIsSongModeOpen] = useState(false);
    const [isSongModeActive, setIsSongModeActive] = useState(false); // Playback toggle
    const [songStructure, setSongStructure] = useState<({ [key in TrackKey]: number | null })[]>(
        Array(16).fill(null).map(() => ({
            partA: null, partB: null, kick: null, snare: null, closedHat: null, openHat: null, sampler: null
        }))
    );
    const [currentSongMeasure, setCurrentSongMeasure] = useState(0);

    // --- CONTEXT MENU STATE ---
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, track: TrackKey, step: number } | null>(null);

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
    // Per-track storage: Map of TrackKey -> Array[8] of PartSequence
    const [trackStorage, setTrackStorage] = useState<Record<TrackKey, (PartSequence | null)[]>>({
        partA: Array(8).fill(null),
        partB: Array(8).fill(null),
        kick: Array(8).fill(null),
        snare: Array(8).fill(null),
        closedHat: Array(8).fill(null),
        openHat: Array(8).fill(null),
        sampler: Array(8).fill(null),
    });

    // Active slot visual tracking
    const [activeTrackSlots, setActiveTrackSlots] = useState<Record<TrackKey, number>>({
        partA: 0, partB: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: 0
    });

    // Global Song Storage (Slots A-D)
    const [songStorage, setSongStorage] = useState<(SongSnapshot | null)[]>([null, null, null, null]);
    const [activeSongSlot, setActiveSongSlot] = useState<number | null>(null);

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

    // --- AUDIO LOOP ---
    // Ref-based access for Audio Loop to avoid closure staleness without re-creating callback
    const patternRef = useRef(pattern);
    useEffect(() => { patternRef.current = pattern; }, [pattern]);

    const songStructureRef = useRef(songStructure);
    useEffect(() => { songStructureRef.current = songStructure; }, [songStructure]);

    const isSongModeActiveRef = useRef(isSongModeActive);
    useEffect(() => { isSongModeActiveRef.current = isSongModeActive; }, [isSongModeActive]);

    const trackStorageRef = useRef(trackStorage);
    useEffect(() => { trackStorageRef.current = trackStorage; }, [trackStorage]);

    // Track current measure index for playback
    const songMeasureRef = useRef(0);

    const onStep = useCallback((step: number) => {
        if (!audioEngine) return
        const time = audioEngine.context.currentTime

        // 1. Determine Source Pattern
        let activePattern = patternRef.current;

        if (isSongModeActiveRef.current) {
            // Calculate which measure we are in
            // step goes 0..31. We need to increment measure every time step wraps or calculate global time?
            // The scheduler resets step 0..31.
            // We need a way to advance the song pointer.
            // Standard approach: The scheduler just gives 0..31.
            // We can detect wrap-around (step 0) to advance measure.

            if (step === 0) {
                if (isFirstStepRef.current) {
                    isFirstStepRef.current = false;
                } else {
                   // This is start of NEXT measure
                   const nextM = songMeasureRef.current + 1;
                   if (nextM < songStructureRef.current.length) {
                       songMeasureRef.current = nextM;
                       // Sync UI
                       // Note: This is hacky. The UI update might be delayed.
                       // Ideally useScheduler should support measures.
                       // For now, trigger UI update slightly later to align with audio
                       setTimeout(() => setCurrentSongMeasure(nextM), 0);
                   } else {
                       // Loop song or stop? Let's loop song
                       songMeasureRef.current = 0;
                       setTimeout(() => setCurrentSongMeasure(0), 0);
                   }
                }
            }

            const currentMeasureIdx = songMeasureRef.current;
            const measureData = songStructureRef.current[currentMeasureIdx];

            // Construct a composite pattern for this step
            if (measureData) {
                // We need to look up the stored patterns for each track
                // If measureData.partA is null, we play silence? or continue last?
                // Let's assume NULL = Silence / Empty Pattern

                const getSeq = (key: TrackKey) => {
                    const slot = measureData[key];
                    if (slot === null) return { steps: Array(32).fill(null) }; // Empty
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
                } as Pattern; // Casting safe here due to structure
            }
        }

        const p = activePattern;

        if (p.partA.steps[step]) audioEngine.playSynth(synthARef.current, p.partA.steps[step]!.note, time)
        if (p.partB.steps[step]) audioEngine.playSynth(synthBRef.current, p.partB.steps[step]!.note, time)
        if (p.kick.steps[step]) audioEngine.playDrum('kick', kickRef.current, time)
        if (p.snare.steps[step]) audioEngine.playDrum('snare', snareRef.current, time)
        if (p.openHat.steps[step]) audioEngine.playDrum('openHat', openHatRef.current, time)
        else if (p.closedHat.steps[step]) audioEngine.playDrum('closedHat', closedHatRef.current, time)
        if (p.sampler.steps[step]) audioEngine.playSampler(samplerRef.current, p.sampler.steps[step]!.note, time)
    }, [audioEngine]) // No dependencies needed thanks to Refs!

    const { isPlaying: schedPlaying, currentStep: schedStep, setIsPlaying: setSchedPlaying } = useScheduler(tempo, NUM_STEPS, onStep, isEngineReady)

    useEffect(() => setIsPlaying(schedPlaying), [schedPlaying])
    useEffect(() => setCurrentStep(schedStep), [schedStep])

    const isFirstStepRef = useRef(true);

    // Reset on stop
    useEffect(() => {
        if (!schedPlaying) {
            songMeasureRef.current = 0;
            setCurrentSongMeasure(0);
            isFirstStepRef.current = true;
        }
    }, [schedPlaying]);

    // Inject logic into onStep (Redefining it here for clarity, will replace previous onStep block in merge)
    // Actually, I will merge the Ref logic into the `onStep` I wrote above.

    // Let's rewrite the onStep block in the merge below to include the measure advancement.

    const handlePlayToggle = async () => {
        if (!isInitialized) { await initializeAudio(); setIsInitialized(true); }
        setSchedPlaying(!schedPlaying)
    }

    // --- LOGIC HANDLERS ---

    const handleMasterVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = parseFloat(e.target.value);
        setMasterVolume(v);
        if (audioEngine && 'setMasterVolume' in audioEngine) {
            (audioEngine as any).setMasterVolume(v);
        }
    };

    const handleGlobalPan = (e: React.ChangeEvent<HTMLInputElement>) => {
        const p = parseFloat(e.target.value);
        // Center snap
        const val = (p > -0.1 && p < 0.1) ? 0 : p;
        setGlobalPan(val);
        if (audioEngine && 'setGlobalPan' in audioEngine) {
            (audioEngine as any).setGlobalPan(val);
        }
    };

    const toggleStep = useCallback((rowKey: keyof Pattern, i: number) => {
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

    const handleClearPattern = () => {
        if(window.confirm("Clear current pattern?")) {
             setPattern({
                 partA: { steps: Array(16).fill(null) },
                 partB: { steps: Array(16).fill(null) },
                 kick: { steps: Array(16).fill(null) },
                 snare: { steps: Array(16).fill(null) },
                 closedHat: { steps: Array(16).fill(null) },
                 openHat: { steps: Array(16).fill(null) },
                 sampler: { steps: Array(16).fill(null) },
             });
        }
    };

    // --- STORAGE LOGIC ---

    const handleTrackSlotClick = (track: TrackKey, slotIndex: number) => {
        // Behavior: If slot is empty or shift held -> Save current. If slot has data -> Load it.
        // For simplicity: If current active is different, LOAD. If current active is same, SAVE.

        const currentTrackPattern = pattern[track];
        const storedPattern = trackStorage[track][slotIndex];

        // Logic: Load if data exists and we aren't already on this slot
        // Save if we are on this slot (update) or if it's empty

        // Simple behavior for now:
        // 1. If slot has data -> Load it into current pattern
        // 2. If slot empty -> Save current pattern there
        // 3. Right click (context menu) to Force Save? (handled via UI usually, but lets do basic toggle)

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
        if (selectedTrack === 'partA') return <HardwareModule title="SYNTH A // LEAD" colorHex={[0.0, 0.9, 1.0]} controls={getSynthControls(synthA)} onParamChange={(id, v) => handleSynthChange(true, id, v)}><div className="absolute top-4 right-6 pointer-events-auto"><WaveformSelector selected={synthA.waveform} onChange={(w) => updateSynthA({ waveform: w })} accentColor="cyan" /></div></HardwareModule>;
        if (selectedTrack === 'partB') return <HardwareModule title="SYNTH B // BASS" colorHex={[1.0, 0.2, 0.8]} controls={getSynthControls(synthB)} onParamChange={(id, v) => handleSynthChange(false, id, v)}><div className="absolute top-4 right-6 pointer-events-auto"><WaveformSelector selected={synthB.waveform} onChange={(w) => updateSynthB({ waveform: w })} accentColor="pink" /></div></HardwareModule>;
        if (selectedTrack === 'kick') return <HardwareModule title="KICK DRUM" colorHex={[1.0, 0.6, 0.0]} controls={getKickControls(kick)} onParamChange={(id, v) => handleKickChange(id, v)} />;
        if (selectedTrack === 'snare') return <HardwareModule title="SNARE DRUM" colorHex={[0.2, 1.0, 0.2]} controls={getSnareControls(snare)} onParamChange={(id, v) => handleSnareChange(id, v)} />;
        if (selectedTrack === 'closedHat') return <HardwareModule title="CLOSED HAT" colorHex={[0.8, 0.8, 0.0]} controls={getClosedHatControls(closedHat)} onParamChange={handleClosedHatChange} />;
        if (selectedTrack === 'openHat') return <HardwareModule title="OPEN HAT" colorHex={[0.9, 0.5, 0.0]} controls={getOpenHatControls(openHat)} onParamChange={handleOpenHatChange} />;
        if (selectedTrack === 'sampler') return <HardwareModule title="SAMPLER" colorHex={[0.6, 0.4, 1.0]} controls={[]} onParamChange={() => {}}><SamplerPanel params={sampler} onChange={handleSamplerChange} onLoadSample={(n, b) => audioEngine?.loadSampleToEngine(n, b)} audioContext={audioEngine?.context!} /></HardwareModule>;
        return null;
    };

    return (
        <div className="flex flex-col h-screen w-screen bg-[#080a0b] text-gray-200 overflow-hidden font-sans">

            {/* --- TOP HEADER --- */}
            <header className="h-16 flex items-center justify-between px-4 bg-[#0b0d10] border-b border-gray-800 z-20 shadow-md shrink-0">

                {/* LEFT: Title & Global Song Storage */}
                <div className="flex items-center gap-6">
                    <h1 className="text-lg font-bold font-orbitron text-cyan-500 tracking-wider hidden md:block">ELECTRIBE<span className="text-white">WEB</span></h1>

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
                </div>

                {/* RIGHT: Transport & Master Volume */}
                <div className="flex items-center gap-4">

                    {/* Master Volume */}
                    <div className="flex items-center gap-2 mr-4">
                        <span className="text-[10px] text-gray-500 font-mono uppercase">Vol</span>
                        <input
                            type="range" min="0" max="1.2" step="0.01"
                            value={masterVolume} onChange={handleMasterVolume}
                            className="w-24 h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                        />
                    </div>

                    {/* Global Pan */}
                    <div className="flex items-center gap-2 mr-4">
                        <span className="text-[10px] text-gray-500 font-mono uppercase">Pan</span>
                        <input
                            type="range" min="-1" max="1" step="0.01"
                            value={globalPan} onChange={handleGlobalPan}
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
                        onClick={() => { setIsSongModeOpen(!isSongModeOpen); }}
                        className={`w-24 py-1 rounded font-orbitron text-sm font-bold tracking-wide transition-all shadow-lg mr-2 ${
                            isSongModeOpen
                            ? 'bg-purple-900/40 text-purple-300 border border-purple-500'
                            : 'bg-gray-800 text-gray-400 border border-gray-700'
                        }`}
                    >
                        SONG
                    </button>

                    <div className="flex items-center gap-2 mr-2">
                        <label className="text-[10px] text-gray-500 font-mono uppercase">Song Mode</label>
                        <input type="checkbox" checked={isSongModeActive} onChange={(e) => setIsSongModeActive(e.target.checked)} />
                    </div>

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

            <SongMode
                isVisible={isSongModeOpen}
                songStructure={songStructure}
                currentSongStep={currentSongMeasure}
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
                        songStructure,
                        trackStorage,
                        {
                            synthA: synthA, synthB: synthB, kick: kick, snare: snare, closedHat: closedHat, openHat: openHat, sampler: sampler
                        },
                        tempo,
                        pattern
                    );
                }}
            />

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

                {/* Sequencer Container with Hardware finish */}
                <div className="w-full max-w-[920px] mx-auto h-[460px] border border-gray-800 rounded-lg bg-[#080a0c] relative shadow-[0_0_60px_rgba(0,0,0,0.8)_inset] overflow-hidden">

                    {/* Decorative screws */}
                    <div className="absolute top-2 left-2 w-3 h-3 rounded-full bg-gray-800 flex items-center justify-center"><div className="w-full h-[1px] bg-gray-900 rotate-45"></div></div>
                    <div className="absolute top-2 right-2 w-3 h-3 rounded-full bg-gray-800 flex items-center justify-center"><div className="w-full h-[1px] bg-gray-900 rotate-45"></div></div>
                    <div className="absolute bottom-2 left-2 w-3 h-3 rounded-full bg-gray-800 flex items-center justify-center"><div className="w-full h-[1px] bg-gray-900 rotate-45"></div></div>
                    <div className="absolute bottom-2 right-2 w-3 h-3 rounded-full bg-gray-800 flex items-center justify-center"><div className="w-full h-[1px] bg-gray-900 rotate-45"></div></div>

                    <svg viewBox="0 0 920 420" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" className="drop-shadow-lg">
                        <defs>
                            <linearGradient id="trackGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                <stop offset="0%" stopColor="#0b1015" stopOpacity="1" />
                                <stop offset="100%" stopColor="#0b1015" stopOpacity="0" />
                            </linearGradient>
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
                                    onToggle={toggleStep}
                                    onRightClickStep={handleRightClickStep}
                                    onSelectRow={(k) => setSelectedTrack(k as TrackKey)}
                                    onSelectSlot={handleTrackSlotClick}
                                />
                            ))}
                        </g>
                    </svg>
                </div>

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
