import React, { useCallback, useEffect, useRef, useState, memo, useMemo } from 'react'
import { useAudioEngine } from './hooks/useAudioEngine'
import { usePyodideEngine } from './hooks/usePyodideEngine'
import { useScheduler } from './hooks/useScheduler'
import { HardwareModule } from './components/HardwareModule';
import type { KnobConfig } from './components/HardwareModule';
import { WaveformSelector } from './components/WaveformSelector';
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
import type { Pattern, SynthParams, KickParams, SnareParams, PartSequence, KnobAutomation, SongStructure } from './types'

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
                          isCurrent,
                          rowLabel,
                          onClick
                      }: {
    stepIndex: number,
    active: boolean,
    isCurrent: boolean,
    rowLabel: string,
    onClick: () => void
}) => {
    // REDUCED SIZE: 32px width instead of 38px, tighter spacing (38px instead of 44px)
    // Starting X pushed to accommodate track slots
    const x = 140 + stepIndex * 38
    return (
        <g transform={`translate(${x}, 0)`}
           role="button"
           aria-label={`${rowLabel} step ${stepIndex+1}`}
           onClick={(e) => { e.stopPropagation(); onClick(); }}
           cursor="pointer"
        >
            <rect
                x={0} y={0} width={30} height={44} rx={4}
                fill={active ? '#3fa34d' : '#111f15'}
                stroke={isCurrent ? '#fff' : '#234a2e'}
                strokeWidth={isCurrent ? 2 : 1}
                className="transition-colors duration-150"
            />
            {/* Simplified indicator if needed, or just color */}
        </g>
    )
})

// PER-TRACK STORAGE BUTTON
const TrackSlotButton = ({ index, isActive, hasData, onClick }: { index: number, isActive: boolean, hasData: boolean, onClick: () => void }) => (
    <g transform={`translate(${index * 22}, 0)`} onClick={(e) => { e.stopPropagation(); onClick() }} cursor="pointer">
        <rect
            width={18} height={18} rx={2}
            fill={isActive ? '#3fa34d' : (hasData ? '#234a2e' : '#0f1812')}
            stroke={isActive ? '#fff' : '#3fa34d'}
            strokeWidth={1}
        />
        <text x={9} y={13} textAnchor="middle" fontSize={10} fill={isActive ? '#000' : '#8fa394'} fontFamily="monospace">{index + 1}</text>
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
    onSelectRow: (k: any) => void,
    onSelectSlot: (k: TrackKey, slot: number) => void
}) => {
    // Tighter vertical spacing
    return (
        <g transform={`translate(0, ${rowIndex * 60})`}>
            {/* Row Label / Selector */}
            <g onClick={() => onSelectRow(rowKey)} cursor="pointer">
                {/* Selection Indicator */}
                {isSelected && <rect x={-10} y={10} width={4} height={30} fill="#3fa34d" rx={2} />}

                <text 
                    x={-20} y={30} textAnchor="end"
                    fontFamily="Orbitron, monospace" fontSize={12}
                    fill={isSelected ? '#3fa34d' : '#8fa394'}
                    fontWeight={isSelected ? 'bold' : 'normal'}
                >
                    {label.toUpperCase()}
                </text>
            </g>

            {/* Track Slots (1-4) */}
            <g transform="translate(30, 13)">
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
                    isCurrent={currentStep === i}
                    rowLabel={label}
                    onClick={() => onToggle(rowKey, i)}
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
    // Currently active slot per track (default -1 means none loaded/edited, or 0 based)
    // Let's just use a visual indicator or auto-save.
    // Simpler approach: The buttons act as Save/Load.
    // Let's track "Last Loaded Slot" per track.
    const [activeTrackSlots, setActiveTrackSlots] = useState<Record<TrackKey, number>>({
        partA: 0, partB: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0
    });

    // Global Song Storage
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

    // --- SONG STRUCTURE & AUTOMATION ---
    const [songStructure, setSongStructure] = useState<SongStructure>({
        length: 16,
        steps: Array(16).fill(null).map(() => ({ patternIndex: 0 })),
        currentSongStep: 0
    });
    
    const [automations, setAutomations] = useState<KnobAutomation[]>([]);
    const automationsRef = useRef<KnobAutomation[]>([]);
    
    useEffect(() => {
        automationsRef.current = automations;
    }, [automations]);

    // --- AUDIO LOOP ---
    const onStep = useCallback((step: number) => {
        if (!audioEngine) return
        const time = audioEngine.context.currentTime
        
        // Advance song step every 16 steps (one full pattern)
        if (step === 0 && isPlaying) {
            setSongStructure(s => {
                const nextStep = (s.currentSongStep + 1) % s.length;
                return { ...s, currentSongStep: nextStep };
            });
        }
        
        if (pattern.partA.steps[step]) audioEngine.playSynth(synthARef.current, pattern.partA.steps[step]!.note, time)
        if (pattern.partB.steps[step]) audioEngine.playSynth(synthBRef.current, pattern.partB.steps[step]!.note, time)
        if (pattern.kick.steps[step]) audioEngine.playDrum('kick', kickRef.current, time)
        if (pattern.snare.steps[step]) audioEngine.playDrum('snare', snareRef.current, time)
        if (pattern.openHat.steps[step]) audioEngine.playDrum('openHat', openHatRef.current, time)
        else if (pattern.closedHat.steps[step]) audioEngine.playDrum('closedHat', closedHatRef.current, time)
    }, [audioEngine, pattern, isPlaying])

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
        // Behavior: If slot is empty, Save current. If slot has data, Load it.
        // To overwrite, maybe Shift+Click? For now, simple logic:
        // If we click a different slot, load it. If empty, save current to it.
        // If we click the SAME active slot, save current to it.

        const currentTrackPattern = pattern[track];
        const storedPattern = trackStorage[track][slotIndex];

        if (storedPattern) {
            // Load
            setPattern(prev => ({ ...prev, [track]: storedPattern }));
            setActiveTrackSlots(prev => ({ ...prev, [track]: slotIndex }));
        } else {
            // Save
            setTrackStorage(prev => {
                const copy = { ...prev };
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

    // --- AUTOMATION RECORDING ---
    const recordAutomation = useCallback((trackKey: TrackKey, paramId: string, val: number) => {
        const automation = automationsRef.current.find(a => a.trackKey === trackKey && a.paramId === paramId);
        if (automation && automation.isRecording && isPlaying) {
            // Only record if value changed or it's a new step (performance optimization)
            const lastPoint = automation.points[automation.points.length - 1];
            const shouldRecord = !lastPoint || 
                                lastPoint.step !== songStructure.currentSongStep || 
                                Math.abs(lastPoint.value - val) > 0.001;
            
            if (shouldRecord) {
                setAutomations(prev => prev.map(a => 
                    a.trackKey === trackKey && a.paramId === paramId
                        ? { ...a, points: [...a.points, { step: songStructure.currentSongStep, value: val }] }
                        : a
                ));
            }
        }
    }, [isPlaying, songStructure.currentSongStep]);

    const handleRecordToggle = useCallback((trackKey: TrackKey, paramId: string) => {
        setAutomations(prev => {
            const existing = prev.find(a => a.trackKey === trackKey && a.paramId === paramId);
            if (existing) {
                // Toggle recording state
                return prev.map(a => 
                    a.trackKey === trackKey && a.paramId === paramId
                        ? { ...a, isRecording: !a.isRecording }
                        : a
                );
            } else {
                // Create new automation
                return [...prev, {
                    paramId,
                    trackKey,
                    points: [],
                    isRecording: true
                }];
            }
        });
    }, []);

    const getKnobRecordingState = useCallback((trackKey: TrackKey, paramId: string): boolean => {
        const automation = automations.find(a => a.trackKey === trackKey && a.paramId === paramId);
        return automation?.isRecording ?? false;
    }, [automations]);

    // --- MODULE RENDER HELPERS ---
    const getSynthControls = (params: SynthParams, trackKey: TrackKey): KnobConfig[] => [
         { id: 'pitch', label: 'TUNE', x: 0.15, y: 0.35, size: 0.10, value: (params.pitch + 24) / 48, isRecording: getKnobRecordingState(trackKey, 'pitch') },
         { id: 'filterCutoff', label: 'CUTOFF', x: 0.35, y: 0.35, size: 0.12, value: params.filterCutoff / 8000, isRecording: getKnobRecordingState(trackKey, 'filterCutoff') },
         { id: 'filterResonance', label: 'RES', x: 0.55, y: 0.35, size: 0.08, value: params.filterResonance / 20, isRecording: getKnobRecordingState(trackKey, 'filterResonance') },
         { id: 'attack', label: 'ATK', x: 0.75, y: 0.35, size: 0.08, value: params.attack, isRecording: getKnobRecordingState(trackKey, 'attack') },
         { id: 'decay', label: 'DEC', x: 0.15, y: 0.75, size: 0.08, value: params.decay / 2, isRecording: getKnobRecordingState(trackKey, 'decay') },
         { id: 'delayMix', label: 'DLY MIX', x: 0.35, y: 0.75, size: 0.08, value: params.delayMix, isRecording: getKnobRecordingState(trackKey, 'delayMix') },
         { id: 'delayTime', label: 'DLY TIME', x: 0.55, y: 0.75, size: 0.08, value: params.delayTime, isRecording: getKnobRecordingState(trackKey, 'delayTime') },
         { id: 'volume', label: 'LEVEL', x: 0.85, y: 0.55, size: 0.11, value: params.volume, isRecording: getKnobRecordingState(trackKey, 'volume') },
    ];
    const getKickControls = (params: KickParams): KnobConfig[] => [
        { id: 'pitch', label: 'TUNE', x: 0.2, y: 0.45, size: 0.13, value: (params.pitch - 20) / 130, isRecording: getKnobRecordingState('kick', 'pitch') },
        { id: 'decay', label: 'DECAY', x: 0.5, y: 0.45, size: 0.13, value: params.decay, isRecording: getKnobRecordingState('kick', 'decay') },
        { id: 'tone', label: 'SNAP', x: 0.8, y: 0.45, size: 0.13, value: params.tone, isRecording: getKnobRecordingState('kick', 'tone') },
        { id: 'volume', label: 'LEVEL', x: 0.9, y: 0.8, size: 0.08, value: params.volume, isRecording: getKnobRecordingState('kick', 'volume') },
    ];
    const getSnareControls = (params: SnareParams): KnobConfig[] => [
        { id: 'tone', label: 'TUNE', x: 0.25, y: 0.45, size: 0.13, value: (params.tone - 100) / 300, isRecording: getKnobRecordingState('snare', 'tone') },
        { id: 'noise', label: 'SNAPPY', x: 0.5, y: 0.45, size: 0.13, value: (params.noise - 1000) / 7000, isRecording: getKnobRecordingState('snare', 'noise') },
        { id: 'decay', label: 'DECAY', x: 0.75, y: 0.45, size: 0.11, value: params.decay * 2, isRecording: getKnobRecordingState('snare', 'decay') },
        { id: 'volume', label: 'LEVEL', x: 0.9, y: 0.8, size: 0.08, value: params.volume, isRecording: getKnobRecordingState('snare', 'volume') },
    ];
    const getClosedHatControls = (params: any): KnobConfig[] => [
        { id: 'decay', label: 'DECAY', x: 0.3, y: 0.45, size: 0.13, value: params.decay, isRecording: getKnobRecordingState('closedHat', 'decay') },
        { id: 'pitch', label: 'TONE', x: 0.6, y: 0.45, size: 0.13, value: params.pitch / 12000, isRecording: getKnobRecordingState('closedHat', 'pitch') },
        { id: 'volume', label: 'LEVEL', x: 0.9, y: 0.8, size: 0.08, value: params.volume, isRecording: getKnobRecordingState('closedHat', 'volume') },
    ];
    const getOpenHatControls = (params: any): KnobConfig[] => [
        { id: 'decay', label: 'DECAY', x: 0.3, y: 0.45, size: 0.13, value: params.decay, isRecording: getKnobRecordingState('openHat', 'decay') },
        { id: 'pitch', label: 'TONE', x: 0.6, y: 0.45, size: 0.13, value: params.pitch / 12000, isRecording: getKnobRecordingState('openHat', 'pitch') },
        { id: 'volume', label: 'LEVEL', x: 0.9, y: 0.8, size: 0.08, value: params.volume, isRecording: getKnobRecordingState('openHat', 'volume') },
    ];

    const handleSynthChange = useCallback((isA: boolean, id: string, val: number) => {
        const updater = isA ? updateSynthA : updateSynthB;
        const trackKey = isA ? 'partA' : 'partB';
        let realVal = val;
        if (id === 'pitch') realVal = Math.floor(val * 48 - 24);
        else if (id === 'filterCutoff') realVal = val * 8000;
        else if (id === 'filterResonance') realVal = val * 20;
        else if (id === 'decay') realVal = val * 2;
        updater({ [id]: realVal });
        recordAutomation(trackKey, id, val);
    }, [updateSynthA, updateSynthB, recordAutomation]);

    const handleKickChange = useCallback((id: string, val: number) => {
        let realVal = val;
        if (id === 'pitch') realVal = val * 130 + 20;
        updateKick({ [id]: realVal });
        recordAutomation('kick', id, val);
    }, [recordAutomation]);

    const handleSnareChange = useCallback((id: string, val: number) => {
        let realVal = val;
        if (id === 'tone') realVal = val * 300 + 100;
        else if (id === 'noise') realVal = val * 7000 + 1000;
        else if (id === 'decay') realVal = val * 0.5;
        updateSnare({ [id]: realVal });
        recordAutomation('snare', id, val);
    }, [recordAutomation]);

    const handleClosedHatChange = useCallback((id: string, val: number) => {
        updateClosedHat({ [id]: val });
        recordAutomation('closedHat', id, val);
    }, [recordAutomation]);
    
    const handleOpenHatChange = useCallback((id: string, val: number) => {
        updateOpenHat({ [id]: val });
        recordAutomation('openHat', id, val);
    }, [recordAutomation]);

    // Memoize controls for each module to prevent unnecessary re-renders
    const synthAControls = useMemo(() => getSynthControls(synthA, 'partA'), [synthA, getKnobRecordingState]);
    const synthBControls = useMemo(() => getSynthControls(synthB, 'partB'), [synthB, getKnobRecordingState]);
    const kickControls = useMemo(() => getKickControls(kick), [kick, getKnobRecordingState]);
    const snareControls = useMemo(() => getSnareControls(snare), [snare, getKnobRecordingState]);
    const closedHatControls = useMemo(() => getClosedHatControls(closedHat), [closedHat, getKnobRecordingState]);
    const openHatControls = useMemo(() => getOpenHatControls(openHat), [openHat, getKnobRecordingState]);

    const handleSynthAChange = useCallback((id: string, val: number) => {
        handleSynthChange(true, id, val);
    }, [handleSynthChange]);

    const handleSynthBChange = useCallback((id: string, val: number) => {
        handleSynthChange(false, id, val);
    }, [handleSynthChange]);

    const renderModulePanel = useMemo(() => {
        if (selectedTrack === 'partA') return <HardwareModule title="SYNTH A // LEAD" colorHex={[0.0, 0.9, 1.0]} controls={synthAControls} onParamChange={handleSynthAChange} onRecordToggle={(id) => handleRecordToggle('partA', id)}><div className="absolute top-4 right-6 pointer-events-auto"><WaveformSelector selected={synthA.waveform} onChange={(w) => updateSynthA({ waveform: w })} accentColor="cyan" /></div></HardwareModule>;
        if (selectedTrack === 'partB') return <HardwareModule title="SYNTH B // BASS" colorHex={[1.0, 0.2, 0.8]} controls={synthBControls} onParamChange={handleSynthBChange} onRecordToggle={(id) => handleRecordToggle('partB', id)}><div className="absolute top-4 right-6 pointer-events-auto"><WaveformSelector selected={synthB.waveform} onChange={(w) => updateSynthB({ waveform: w })} accentColor="pink" /></div></HardwareModule>;
        if (selectedTrack === 'kick') return <HardwareModule title="KICK DRUM" colorHex={[1.0, 0.6, 0.0]} controls={kickControls} onParamChange={handleKickChange} onRecordToggle={(id) => handleRecordToggle('kick', id)} />;
        if (selectedTrack === 'snare') return <HardwareModule title="SNARE DRUM" colorHex={[0.2, 1.0, 0.2]} controls={snareControls} onParamChange={handleSnareChange} onRecordToggle={(id) => handleRecordToggle('snare', id)} />;
        if (selectedTrack === 'closedHat') return <HardwareModule title="CLOSED HAT" colorHex={[0.8, 0.8, 0.0]} controls={closedHatControls} onParamChange={handleClosedHatChange} onRecordToggle={(id) => handleRecordToggle('closedHat', id)} />;
        if (selectedTrack === 'openHat') return <HardwareModule title="OPEN HAT" colorHex={[0.9, 0.5, 0.0]} controls={openHatControls} onParamChange={handleOpenHatChange} onRecordToggle={(id) => handleRecordToggle('openHat', id)} />;
        return null;
    }, [selectedTrack, synthAControls, synthBControls, kickControls, snareControls, closedHatControls, openHatControls, handleSynthAChange, handleSynthBChange, handleKickChange, handleSnareChange, handleClosedHatChange, handleOpenHatChange, handleRecordToggle, synthA.waveform, synthB.waveform]);

    return (
        <div className="flex flex-col h-screen w-screen bg-[#080a0b] text-gray-200 overflow-hidden font-sans">

            {/* --- TOP HEADER --- */}
            <header className="h-16 flex items-center justify-between px-4 bg-[#0b0d10] border-b border-gray-800 z-20 shadow-md shrink-0">

                {/* LEFT: Title & Global Song Storage */}
                <div className="flex items-center gap-6">
                    <h1 className="text-lg font-bold font-orbitron text-cyan-500 tracking-wider hidden md:block">ELECTRIBE<span className="text-white">WEB</span></h1>

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
                                className={`w-6 h-6 text-xs font-mono rounded ${
                                    activeSongSlot === slot ? 'bg-cyan-600 text-white' : 
                                    (songStorage[slot] ? 'bg-cyan-900/50 text-cyan-400' : 'bg-gray-800 text-gray-600')
                                }`}
                                title="Click to Load (if empty, Save). Right-Click to Save/Overwrite."
                            >
                                {slot + 1}
                            </button>
                        ))}
                    </div>

                    <button onClick={handleClearPattern} className="text-xs text-red-400 hover:text-red-300 border border-red-900 bg-red-900/20 px-2 py-1 rounded">
                        CLEAR
                    </button>

                    {/* Song Length Control */}
                    <div className="flex items-center gap-2 bg-gray-900 p-1 rounded border border-gray-700">
                        <span className="text-[10px] text-gray-500 font-mono uppercase px-1">Length</span>
                        <div className="flex items-center">
                            <button 
                                onClick={() => setSongStructure(s => ({ ...s, length: Math.max(1, s.length - 1) }))} 
                                className="px-2 py-1 text-cyan-500 font-bold border-r border-gray-700 hover:bg-gray-800"
                            >
                                -
                            </button>
                            <span className="w-10 text-center font-mono text-cyan-300 text-xs">{songStructure.length}</span>
                            <button 
                                onClick={() => setSongStructure(s => {
                                    const newLength = Math.min(64, s.length + 1);
                                    const newSteps = newLength > s.steps.length 
                                        ? [...s.steps, { patternIndex: 0 }]
                                        : s.steps;
                                    return { ...s, length: newLength, steps: newSteps };
                                })} 
                                className="px-2 py-1 text-cyan-500 font-bold border-l border-gray-700 hover:bg-gray-800"
                            >
                                +
                            </button>
                        </div>
                    </div>
                </div>

                {/* RIGHT: Transport & Master Volume */}
                <div className="flex items-center gap-4">

                    {/* Master Volume */}
                    <div className="flex items-center gap-2 mr-4">
                        <span className="text-[10px] text-gray-500 font-mono uppercase">Vol</span>
                        <input
                            type="range" min="0" max="1.2" step="0.01"
                            value={masterVolume} onChange={handleMasterVolume}
                            className="w-20 h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                        />
                    </div>

                    <div className="flex items-center gap-2">
                         <div className="flex items-center bg-gray-900 rounded border border-gray-700 scale-90">
                            <button onClick={() => setTempo(t => t-1)} className="px-2 py-1 text-cyan-500 font-bold border-r border-gray-700">-</button>
                            <span className="w-10 text-center font-mono text-cyan-300 text-sm">{tempo}</span>
                            <button onClick={() => setTempo(t => t+1)} className="px-2 py-1 text-cyan-500 font-bold border-l border-gray-700">+</button>
                        </div>
                    </div>

                    <button
                        onClick={handlePlayToggle}
                        className={`w-24 py-1 rounded font-orbitron text-sm font-bold tracking-wide transition-all ${isPlaying ? 'bg-red-900/50 text-red-400 border border-red-800' : 'bg-green-900/30 text-green-400 border border-green-800'}`}
                    >
                        {isPlaying ? 'STOP' : 'PLAY'}
                    </button>
                </div>
            </header>

            {/* --- SEQUENCER --- */}
            <main className="flex-1 relative bg-[#08140a] shadow-inner flex flex-col justify-start pt-4">
                {/* Song Step Indicator */}
                <div className="w-full max-w-4xl mx-auto mb-2 px-4">
                    <div className="flex items-center gap-1 bg-gray-900/50 p-2 rounded border border-gray-800">
                        <span className="text-[10px] text-gray-500 font-mono uppercase mr-2">Song:</span>
                        <div className="flex gap-1 overflow-x-auto">
                            {Array.from({ length: songStructure.length }).map((_, idx) => (
                                <button
                                    key={idx}
                                    onClick={() => setSongStructure(s => ({ ...s, currentSongStep: idx }))}
                                    className={`min-w-[24px] h-6 text-[10px] font-mono rounded transition-all ${
                                        songStructure.currentSongStep === idx 
                                            ? 'bg-cyan-500 text-black font-bold' 
                                            : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                                    }`}
                                    title={`Song step ${idx + 1} - Pattern ${songStructure.steps[idx]?.patternIndex + 1 || 1}`}
                                >
                                    {songStructure.steps[idx]?.patternIndex + 1 || 1}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="w-full max-w-4xl mx-auto h-[420px] overflow-hidden">
                    <svg viewBox="0 0 900 400" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
                        <g transform="translate(100, 30)">
                            {ROWS.map((row, rIdx) => (
                                <SequencerRow
                                    key={row.key}
                                    rowKey={row.key}
                                    label={row.label}
                                    rowIndex={rIdx}
                                    steps={(pattern as any)[row.key].steps}
                                    currentStep={currentStep}
                                    isSelected={selectedTrack === row.key}
                                    activeSlot={activeTrackSlots[row.key]}
                                    slotsData={trackStorage[row.key].map(s => s !== null)}
                                    onToggle={toggleStep}
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
                        {renderModulePanel}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default App
