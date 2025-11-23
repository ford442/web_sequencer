import React, { useCallback, useEffect, useRef, useState, memo } from 'react'
import { useAudioEngine } from './hooks/useAudioEngine'
import { usePyodideEngine } from './hooks/usePyodideEngine'
import { useScheduler } from './hooks/useScheduler'
import { HardwareModule } from './components/HardwareModule';
import type { KnobConfig } from './components/HardwareModule';
import { WaveformSelector } from './components/WaveformSelector';
import { NoteSelector } from './components/NoteSelector';
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
} from './constants'
import type { Pattern, SynthParams, KickParams, SnareParams, PartSequence } from './types'

// --- TYPES FOR STORAGE ---
type TrackKey = 'partA' | 'partB' | 'kick' | 'snare' | 'closedHat' | 'openHat';
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
    // VISUAL: Hardware style buttons
    const width = 34;
    const height = 50;
    const gap = 6;
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

            {/* Main Button Body - Beveled Look */}
            <rect
                x={0} y={0} width={width} height={height} rx={3}
                fill={active ? '#0e2a1b' : '#080c10'}
                stroke={isCurrent ? '#ffffff' : (active ? color : '#1e293b')}
                strokeWidth={isCurrent ? 2 : (active ? 1.5 : 1)}
            />

            {/* Inner "Light" Area */}
            <rect
                x={4} y={4} width={width-8} height={height-18} rx={1}
                fill={active ? color : '#0f1720'}
                fillOpacity={active ? 0.8 : 1}
                className="transition-colors duration-100"
            />

            {/* Bottom LED Strip */}
            <rect
                x={6} y={height - 8} width={width - 12} height={4} rx={1}
                fill={isCurrent ? '#ff3333' : (active ? color : '#1a2332')}
                fillOpacity={isCurrent ? 1 : 0.5}
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

            {/* Track Pattern Slots (1-4) */}
            <g transform="translate(30, 16)">
                {[0, 1, 2, 3].map(slot => (
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
    const [currentStep, setCurrentStep] = useState(-1)
    const [selectedTrack, setSelectedTrack] = useState<TrackKey>('partA')
    const [ambianceUrl, setAmbianceUrl] = useState<string>('')
    const [masterVolume, setMasterVolume] = useState(0.8)

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
         return Array(16).fill(null).map((_, i) => {
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
    // Per-track storage: Map of TrackKey -> Array[4] of PartSequence
    const [trackStorage, setTrackStorage] = useState<Record<TrackKey, (PartSequence | null)[]>>({
        partA: [null, null, null, null],
        partB: [null, null, null, null],
        kick: [null, null, null, null],
        snare: [null, null, null, null],
        closedHat: [null, null, null, null],
        openHat: [null, null, null, null],
    });

    // Active slot visual tracking
    const [activeTrackSlots, setActiveTrackSlots] = useState<Record<TrackKey, number>>({
        partA: 0, partB: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0
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

    // --- AUDIO LOOP ---
    const onStep = useCallback((step: number) => {
        if (!audioEngine) return
        const time = audioEngine.context.currentTime
        if (pattern.partA.steps[step]) audioEngine.playSynth(synthARef.current, pattern.partA.steps[step]!.note, time)
        if (pattern.partB.steps[step]) audioEngine.playSynth(synthBRef.current, pattern.partB.steps[step]!.note, time)
        if (pattern.kick.steps[step]) audioEngine.playDrum('kick', kickRef.current, time)
        if (pattern.snare.steps[step]) audioEngine.playDrum('snare', snareRef.current, time)
        if (pattern.openHat.steps[step]) audioEngine.playDrum('openHat', openHatRef.current, time)
        else if (pattern.closedHat.steps[step]) audioEngine.playDrum('closedHat', closedHatRef.current, time)
    }, [audioEngine, pattern])

    const { isPlaying: schedPlaying, currentStep: schedStep, setIsPlaying: setSchedPlaying } = useScheduler(tempo, NUM_STEPS, onStep, isEngineReady)

    useEffect(() => setIsPlaying(schedPlaying), [schedPlaying])
    useEffect(() => setCurrentStep(schedStep), [schedStep])

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

    const toggleStep = useCallback((rowKey: keyof Pattern, i: number) => {
        setPattern(prev => {
            const copy = JSON.parse(JSON.stringify(prev)) as Pattern
            const arr = copy[rowKey].steps
            // Default note per track type
            const defaultNote = rowKey.startsWith('part') ? (rowKey === 'partA' ? 'C4' : 'C3') : 'C2';
            arr[i] = arr[i] ? null : { note: defaultNote, velocity: 1 }
            return copy
        })
    }, [])

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
                synthA: synthA, synthB: synthB, kick: kick, snare: snare, closedHat: closedHat, openHat: openHat
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
        setActiveSongSlot(slot);
    };

    // --- MODULE RENDER HELPERS ---
    const getSynthControls = (params: SynthParams): KnobConfig[] => [
         { id: 'pitch', label: 'TUNE', x: 0.15, y: 0.35, size: 0.10, value: (params.pitch + 24) / 48 },
         { id: 'filterCutoff', label: 'CUTOFF', x: 0.35, y: 0.35, size: 0.12, value: params.filterCutoff / 8000 },
         { id: 'filterResonance', label: 'RES', x: 0.55, y: 0.35, size: 0.08, value: params.filterResonance / 20 },
         { id: 'attack', label: 'ATK', x: 0.75, y: 0.35, size: 0.08, value: params.attack },
         { id: 'decay', label: 'DEC', x: 0.15, y: 0.75, size: 0.08, value: params.decay / 2 },
         { id: 'delayMix', label: 'DLY MIX', x: 0.35, y: 0.75, size: 0.08, value: params.delayMix },
         { id: 'delayTime', label: 'DLY TIME', x: 0.55, y: 0.75, size: 0.08, value: params.delayTime },
         { id: 'volume', label: 'LEVEL', x: 0.85, y: 0.55, size: 0.11, value: params.volume },
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


    const renderModulePanel = () => {
        if (selectedTrack === 'partA') return <HardwareModule title="SYNTH A // LEAD" colorHex={[0.0, 0.9, 1.0]} controls={getSynthControls(synthA)} onParamChange={(id, v) => handleSynthChange(true, id, v)}><div className="absolute top-4 right-6 pointer-events-auto"><WaveformSelector selected={synthA.waveform} onChange={(w) => updateSynthA({ waveform: w })} accentColor="cyan" /></div></HardwareModule>;
        if (selectedTrack === 'partB') return <HardwareModule title="SYNTH B // BASS" colorHex={[1.0, 0.2, 0.8]} controls={getSynthControls(synthB)} onParamChange={(id, v) => handleSynthChange(false, id, v)}><div className="absolute top-4 right-6 pointer-events-auto"><WaveformSelector selected={synthB.waveform} onChange={(w) => updateSynthB({ waveform: w })} accentColor="pink" /></div></HardwareModule>;
        if (selectedTrack === 'kick') return <HardwareModule title="KICK DRUM" colorHex={[1.0, 0.6, 0.0]} controls={getKickControls(kick)} onParamChange={(id, v) => handleKickChange(id, v)} />;
        if (selectedTrack === 'snare') return <HardwareModule title="SNARE DRUM" colorHex={[0.2, 1.0, 0.2]} controls={getSnareControls(snare)} onParamChange={(id, v) => handleSnareChange(id, v)} />;
        if (selectedTrack === 'closedHat') return <HardwareModule title="CLOSED HAT" colorHex={[0.8, 0.8, 0.0]} controls={getClosedHatControls(closedHat)} onParamChange={handleClosedHatChange} />;
        if (selectedTrack === 'openHat') return <HardwareModule title="OPEN HAT" colorHex={[0.9, 0.5, 0.0]} controls={getOpenHatControls(openHat)} onParamChange={handleOpenHatChange} />;
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

                    <div className="flex items-center gap-2">
                         <div className="flex items-center bg-gray-900 rounded border border-gray-700 scale-90">
                            <button onClick={() => setTempo(t => t-1)} className="px-2 py-1 text-cyan-500 font-bold border-r border-gray-700 hover:bg-gray-800">-</button>
                            <span className="w-12 text-center font-mono text-cyan-300 text-sm">{tempo}</span>
                            <button onClick={() => setTempo(t => t+1)} className="px-2 py-1 text-cyan-500 font-bold border-l border-gray-700 hover:bg-gray-800">+</button>
                        </div>
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
                            <filter id="glow">
                                <feGaussianBlur stdDeviation="2.5" result="coloredBlur"/>
                                <feMerge>
                                    <feMergeNode in="coloredBlur"/>
                                    <feMergeNode in="SourceGraphic"/>
                                </feMerge>
                            </filter>
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
            </main>

            {/* --- HARDWARE MODULE --- */}
            <div className="h-[300px] bg-[#0f1215] border-t border-gray-800 relative shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-10 shrink-0">
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
