import React, { useCallback, useEffect, useRef, useState, memo, useMemo } from 'react'
import { useAudioEngine } from './hooks/useAudioEngine'
import { usePyodideEngine } from './hooks/usePyodideEngine'
import { useScheduler } from './hooks/useScheduler'
import { HardwareModule } from './components/HardwareModule';
import type { KnobConfig } from './components/HardwareModule';
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
    AMBIANCE_TRACKS,
} from './constants'
import type { Pattern, SynthParams, KickParams, SnareParams } from './types'

// --- 1. MEMOIZED SEQUENCER COMPONENTS ---

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
    // Reduced horizontal spacing slightly
    const x = 20 + stepIndex * 44 
    return (
        <g transform={`translate(${x}, 0)`}
           role="button"
           aria-label={`${rowLabel} step ${stepIndex+1}`}
           tabIndex={0}
           onClick={(e) => { e.stopPropagation(); onClick(); }}
           onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
           cursor="pointer"
           style={{ outline: 'none' }}
        >
            <rect
                x={0} y={0} width={38} height={54} rx={6}
                fill={active ? '#3fa34d' : '#111f15'}
                stroke={isCurrent ? '#fff' : '#234a2e'}
                strokeWidth={isCurrent ? 2 : 1}
                className="transition-colors duration-150"
            />
            <text
                x={19} y={32}
                textAnchor="middle"
                fontFamily="monospace"
                fontSize={16}
                fill={active ? '#042004' : '#4a6b52'}
                pointerEvents="none"
                style={{ userSelect: 'none' }}
            >
                {stepIndex+1}
            </text>
        </g>
    )
})

const SequencerRow = memo(({
                               rowKey,
                               label,
                               rowIndex,
                               steps,
                               currentStep,
                               isSelected,
                               onToggle,
                               onSelectRow
                           }: {
    rowKey: string,
    label: string,
    rowIndex: number,
    steps: (any | null)[],
    currentStep: number,
    isSelected: boolean,
    onToggle: (k: any, i: number) => void,
    onSelectRow: (k: any) => void
}) => {
    // Tighter vertical spacing (70px instead of 90px)
    return (
        <g transform={`translate(0, ${rowIndex * 70})`}>
            {/* Row Label / Selector Button */}
            <g 
                onClick={() => onSelectRow(rowKey)} 
                cursor="pointer"
                className="group"
            >
                {/* Active Indicator Bar */}
                {isSelected && (
                    <rect x={-140} y={10} width={4} height={40} fill="#3fa34d" rx={2} />
                )}
                
                {/* Label Background (Hover effect via CSS class not strictly possible in pure SVG without CSS file, using fill opacity) */}
                <rect 
                    x={-130} y={10} width={120} height={40} rx={6} 
                    fill={isSelected ? '#1a2e20' : 'transparent'} 
                    stroke={isSelected ? '#3fa34d' : 'transparent'}
                    strokeWidth={1}
                />
                
                <text 
                    x={-25} 
                    y={36} 
                    textAnchor="end" 
                    fontFamily="Orbitron, monospace" 
                    fontSize={14} 
                    fill={isSelected ? '#3fa34d' : '#8fa394'}
                    fontWeight={isSelected ? 'bold' : 'normal'}
                    style={{ letterSpacing: '1px', userSelect: 'none' }}
                >
                    {label.toUpperCase()}
                </text>
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

// --- 2. MAIN APP COMPONENT ---

type TrackKey = 'partA' | 'partB' | 'kick' | 'snare' | 'closedHat' | 'openHat';

const ROWS = [
    { key: 'partA', label: 'Lead Synth' },
    { key: 'partB', label: 'Bass Synth' },
    { key: 'kick', label: 'Kick Drum' },
    { key: 'snare', label: 'Snare' },
    { key: 'closedHat', label: 'Closed Hat' },
    { key: 'openHat', label: 'Open Hat' },
] as const

export const App: React.FC = () => {
    const { pyodide, isPyodideReady, pyodideStatus } = usePyodideEngine()
    const { audioEngine, isReady, initializeAudio } = useAudioEngine(pyodide)

    const isEngineReady = isReady && (isPyodideReady || !!pyodideStatus)

    // --- GLOBAL STATE ---
    const [pattern, setPattern] = useState<Pattern>(INITIAL_PATTERN)
    const [tempo, setTempo] = useState<number>(DEFAULT_TEMPO)
    const [isInitialized, setIsInitialized] = useState(false)
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentStep, setCurrentStep] = useState(-1)
    const [selectedTrack, setSelectedTrack] = useState<TrackKey>('partA')

    const [ambianceUrl, setAmbianceUrl] = useState<string>('')

    // --- INSTRUMENT STATE & REFS ---
    
    // Synth A
    const [synthA, setSynthA] = useState<SynthParams>(DEFAULT_SYNTH_PARAMS_A);
    const synthARef = useRef<SynthParams>(DEFAULT_SYNTH_PARAMS_A);
    const updateSynthA = (updates: Partial<SynthParams>) => {
        const newState = { ...synthA, ...updates };
        setSynthA(newState);
        synthARef.current = newState;
    };

    // Synth B
    const [synthB, setSynthB] = useState<SynthParams>(DEFAULT_SYNTH_PARAMS_B);
    const synthBRef = useRef<SynthParams>(DEFAULT_SYNTH_PARAMS_B);
    const updateSynthB = (updates: Partial<SynthParams>) => {
        const newState = { ...synthB, ...updates };
        setSynthB(newState);
        synthBRef.current = newState;
    };

    // Kick
    const [kick, setKick] = useState<KickParams>(DEFAULT_KICK_PARAMS);
    const kickRef = useRef(DEFAULT_KICK_PARAMS);
    const updateKick = (updates: Partial<KickParams>) => {
        const newState = { ...kick, ...updates };
        setKick(newState);
        kickRef.current = newState;
    };

    // Snare
    const [snare, setSnare] = useState<SnareParams>(DEFAULT_SNARE_PARAMS);
    const snareRef = useRef(DEFAULT_SNARE_PARAMS);
    const updateSnare = (updates: Partial<SnareParams>) => {
        const newState = { ...snare, ...updates };
        setSnare(newState);
        snareRef.current = newState;
    };

    // Closed Hat
    const [closedHat, setClosedHat] = useState(DEFAULT_CLOSED_HAT_PARAMS);
    const closedHatRef = useRef(DEFAULT_CLOSED_HAT_PARAMS);
    const updateClosedHat = (updates: Partial<typeof DEFAULT_CLOSED_HAT_PARAMS>) => {
        const newState = { ...closedHat, ...updates };
        setClosedHat(newState);
        closedHatRef.current = newState;
    };

    // Open Hat
    const [openHat, setOpenHat] = useState(DEFAULT_OPEN_HAT_PARAMS);
    const openHatRef = useRef(DEFAULT_OPEN_HAT_PARAMS);
    const updateOpenHat = (updates: Partial<typeof DEFAULT_OPEN_HAT_PARAMS>) => {
        const newState = { ...openHat, ...updates };
        setOpenHat(newState);
        openHatRef.current = newState;
    };


    // --- SEQUENCER LOOP ---
    const onStep = useCallback((step: number) => {
        if (!audioEngine) return
        const time = audioEngine.context.currentTime

        if (pattern.partA.steps[step]) {
            audioEngine.playSynth(synthARef.current, pattern.partA.steps[step]!.note, time)
        }
        if (pattern.partB.steps[step]) {
            audioEngine.playSynth(synthBRef.current, pattern.partB.steps[step]!.note, time)
        }

        if (pattern.kick.steps[step]) audioEngine.playDrum('kick', kickRef.current, time)
        if (pattern.snare.steps[step]) audioEngine.playDrum('snare', snareRef.current, time)
        if (pattern.openHat.steps[step]) audioEngine.playDrum('openHat', openHatRef.current, time)
        else if (pattern.closedHat.steps[step]) audioEngine.playDrum('closedHat', closedHatRef.current, time)
    }, [audioEngine, pattern])

    const { isPlaying: schedPlaying, currentStep: schedStep, setIsPlaying: setSchedPlaying } = useScheduler(tempo, NUM_STEPS, onStep, isEngineReady)

    useEffect(() => setIsPlaying(schedPlaying), [schedPlaying])
    useEffect(() => setCurrentStep(schedStep), [schedStep])

    const handlePlayToggle = async () => {
        if (!isInitialized) {
            await initializeAudio()
            setIsInitialized(true)
        }
        setSchedPlaying(!schedPlaying)
    }
    const handleStop = () => {
        setSchedPlaying(false)
    }

    const toggleStep = useCallback((rowKey: keyof Pattern, i: number) => {
        setPattern(prev => {
            const copy = JSON.parse(JSON.stringify(prev)) as Pattern
            const arr = copy[rowKey].steps
            arr[i] = arr[i] ? null : { note: rowKey.startsWith('part') ? (rowKey === 'partA' ? 'C4' : 'C3') : 'C2', velocity: 1 }
            return copy
        })
    }, [])

    // --- UI HANDLERS ---
    const handleTempoChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setTempo(Math.max(40, Math.min(240, Number(e.target.value))))
    }, [])
    
    const handleAmbianceCycle = useCallback(() => {
        const currentIndex = AMBIANCE_TRACKS.findIndex(t => t.url === ambianceUrl)
        const nextIndex = (currentIndex + 1) % AMBIANCE_TRACKS.length
        setAmbianceUrl(AMBIANCE_TRACKS[nextIndex].url)
    }, [ambianceUrl])

    const currentAmbianceName = useMemo(() => {
        return AMBIANCE_TRACKS.find(t => t.url === ambianceUrl)?.name || 'None'
    }, [ambianceUrl])

    useEffect(() => {
        if (audioEngine) audioEngine.setAmbianceVolume(0.5)
    }, [audioEngine])

    useEffect(() => {
        if (audioEngine) {
            if (ambianceUrl) audioEngine.playAmbiance(ambianceUrl)
            else audioEngine.stopAmbiance()
        }
    }, [ambianceUrl, audioEngine])


    // --- MODULE CONFIGURATIONS ---
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

    const getClosedHatControls = (params: typeof DEFAULT_CLOSED_HAT_PARAMS): KnobConfig[] => [
        { id: 'decay', label: 'DECAY', x: 0.3, y: 0.45, size: 0.13, value: params.decay },
        { id: 'tone', label: 'TONE', x: 0.6, y: 0.45, size: 0.13, value: params.tone },
        { id: 'volume', label: 'LEVEL', x: 0.9, y: 0.8, size: 0.08, value: params.volume },
    ];

    const getOpenHatControls = (params: typeof DEFAULT_OPEN_HAT_PARAMS): KnobConfig[] => [
        { id: 'decay', label: 'DECAY', x: 0.3, y: 0.45, size: 0.13, value: params.decay },
        { id: 'tone', label: 'TONE', x: 0.6, y: 0.45, size: 0.13, value: params.tone },
        { id: 'volume', label: 'LEVEL', x: 0.9, y: 0.8, size: 0.08, value: params.volume },
    ];

    const handleSynthChange = (isA: boolean, id: string, val: number) => {
        const updater = isA ? updateSynthA : updateSynthB;
        let realVal = val;
        // Mapping normalization back to real values
        if (id === 'pitch') realVal = Math.floor(val * 48 - 24);
        else if (id === 'filterCutoff') realVal = val * 8000;
        else if (id === 'filterResonance') realVal = val * 20;
        else if (id === 'decay') realVal = val * 2;
        // attack, delayMix, delayTime, volume are typically 0-1 or close enough to leave as val for now
        
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

    const handleClosedHatChange = (id: string, val: number) => {
        updateClosedHat({ [id]: val });
    };

    const handleOpenHatChange = (id: string, val: number) => {
        updateOpenHat({ [id]: val });
    };


    const renderModulePanel = () => {
        if (selectedTrack === 'partA') {
            return <HardwareModule title="SYNTH A // LEAD" colorHex={[0.0, 0.9, 1.0]} controls={getSynthControls(synthA)} onParamChange={(id, v) => handleSynthChange(true, id, v)} />;
        }
        if (selectedTrack === 'partB') {
            return <HardwareModule title="SYNTH B // BASS" colorHex={[1.0, 0.2, 0.8]} controls={getSynthControls(synthB)} onParamChange={(id, v) => handleSynthChange(false, id, v)} />;
        }
        if (selectedTrack === 'kick') {
            return <HardwareModule title="KICK DRUM" colorHex={[1.0, 0.6, 0.0]} controls={getKickControls(kick)} onParamChange={(id, v) => handleKickChange(id, v)} />;
        }
        if (selectedTrack === 'snare') {
            return <HardwareModule title="SNARE DRUM" colorHex={[0.2, 1.0, 0.2]} controls={getSnareControls(snare)} onParamChange={(id, v) => handleSnareChange(id, v)} />;
        }
        if (selectedTrack === 'closedHat') {
            return <HardwareModule title="CLOSED HAT" colorHex={[0.8, 0.8, 0.0]} controls={getClosedHatControls(closedHat)} onParamChange={handleClosedHatChange} />;
        }
        if (selectedTrack === 'openHat') {
            return <HardwareModule title="OPEN HAT" colorHex={[0.9, 0.5, 0.0]} controls={getOpenHatControls(openHat)} onParamChange={handleOpenHatChange} />;
        }
        return (
            <div className="flex items-center justify-center h-full text-gray-500 font-orbitron">
                NO EDITABLE PARAMETERS
            </div>
        );
    };

    // Main App Render
    return (
        <div className="flex flex-col h-screen w-screen bg-[#080a0b] text-gray-200 overflow-hidden font-sans">
            
            {/* --- TOP HEADER (Transport & Globals) --- */}
            <header className="h-16 flex items-center justify-between px-6 bg-[#0b0d10] border-b border-gray-800 z-20 shadow-md">
                <div className="flex items-center gap-4">
                    <h1 className="text-xl font-bold font-orbitron text-cyan-500 tracking-wider">ELECTRIBE<span className="text-white">WEB</span></h1>
                    {pyodideStatus && <span className="text-xs text-green-500 animate-pulse">● ENGINE READY</span>}
                </div>

                <div className="flex items-center gap-6">
                    {/* Ambiance */}
                    <div 
                        className="flex items-center gap-2 text-xs font-mono cursor-pointer hover:text-cyan-400 transition-colors"
                        onClick={handleAmbianceCycle}
                    >
                        <span className="opacity-50">AMBIANCE</span>
                        <span className="text-cyan-300 font-bold bg-gray-900 px-2 py-1 rounded border border-gray-700">{currentAmbianceName}</span>
                    </div>

                    {/* Tempo */}
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-mono opacity-50">BPM</span>
                        <input 
                            type="number" 
                            value={tempo} 
                            onChange={handleTempoChange}
                            className="w-16 bg-gray-900 border border-gray-700 text-center text-cyan-300 font-mono text-sm py-1 rounded focus:outline-none focus:border-cyan-500"
                        />
                    </div>

                    {/* Transport Buttons */}
                    <div className="flex gap-2">
                        <button 
                            onClick={handlePlayToggle}
                            className={`px-6 py-1.5 rounded font-orbitron text-sm font-bold tracking-wide transition-all ${isPlaying ? 'bg-red-900/50 text-red-400 border border-red-800 hover:bg-red-900' : 'bg-green-900/30 text-green-400 border border-green-800 hover:bg-green-900/50'}`}
                        >
                            {isPlaying ? 'PAUSE' : 'PLAY'}
                        </button>
                        <button 
                            onClick={handleStop}
                            className="px-4 py-1.5 rounded font-orbitron text-sm font-bold tracking-wide bg-gray-800 border border-gray-700 hover:bg-gray-700 text-gray-400"
                        >
                            STOP
                        </button>
                    </div>
                </div>
            </header>

            {/* --- MAIN SEQUENCER AREA --- */}
            <main className="flex-1 relative bg-[#08140a] shadow-inner flex flex-col justify-start pt-8">
                {/* SVG SEQUENCER */}
                <div className="w-full max-w-5xl mx-auto h-[480px]">
                    <svg viewBox="0 0 1000 500" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
                        {/* Grid Group */}
                        <g transform="translate(150, 40)">
                            {ROWS.map((row, rIdx) => (
                                <SequencerRow
                                    key={row.key}
                                    rowKey={row.key}
                                    label={row.label}
                                    rowIndex={rIdx}
                                    steps={(pattern as any)[row.key].steps}
                                    currentStep={currentStep}
                                    isSelected={selectedTrack === row.key}
                                    onToggle={toggleStep}
                                    onSelectRow={(k) => setSelectedTrack(k as TrackKey)}
                                />
                            ))}
                        </g>
                    </svg>
                </div>
            </main>

            {/* --- BOTTOM HARDWARE MODULE --- */}
            <div className="h-[340px] bg-[#0f1215] border-t border-gray-800 relative shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-10">
                <div className="w-full h-full max-w-5xl mx-auto p-4 flex items-center justify-center">
                    <div className="w-full h-full rounded-xl overflow-hidden border border-gray-800 shadow-2xl bg-black">
                        {renderModulePanel()}
                    </div>
                </div>
            </div>

        </div>
    )
}

export default App
