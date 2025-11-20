import React, { useCallback, useEffect, useRef, useState, memo, useMemo } from 'react'
import { useAudioEngine } from './hooks/useAudioEngine'
import { usePyodideEngine } from './hooks/usePyodideEngine'
import { useScheduler } from './hooks/useScheduler'
import { MagicKnob } from './components/MagicKnob'
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
import type { Pattern, SynthParams, KickParams, SnareParams, HatParams, Waveform } from './types'

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
    const x = 20 + stepIndex * 48
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
                x={0} y={0} width={40} height={60} rx={10}
                fill={active ? '#3fa34d' : '#123017'}
                stroke={isCurrent ? '#fff' : '#2f6f3d'}
                strokeWidth={isCurrent ? 3 : 2}
            />
            <text
                x={20} y={36}
                textAnchor="middle"
                fontFamily="monospace"
                fontSize={18}
                fill={active ? '#042004' : '#fff'}
                pointerEvents="none"
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
    return (
        <g transform={`translate(0, ${rowIndex * 90})`}>
            {/* Row Label / Selector Button */}
            <g 
                onClick={() => onSelectRow(rowKey)} 
                cursor="pointer"
                style={{ opacity: isSelected ? 1 : 0.6 }}
            >
                <rect x={-120} y={10} width={110} height={40} rx={8} fill={isSelected ? '#3fa34d' : 'transparent'} />
                <text 
                    x={-10} 
                    y={36} 
                    textAnchor="end" 
                    fontFamily="monospace" 
                    fontSize={18} 
                    fill={isSelected ? '#08140a' : '#fff'}
                    fontWeight={isSelected ? 'bold' : 'normal'}
                >
                    {label}
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
    { key: 'partA', label: 'Synth A' },
    { key: 'partB', label: 'Synth B' },
    { key: 'kick', label: 'Kick' },
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
    const [ambianceVolume, setAmbianceVolume] = useState(0.5)

    // --- INSTRUMENT STATE & REFS ---
    // We use State for the UI (Knobs) and Refs for the Audio Engine (avoiding closure staleness in loop)
    
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

    // Hats (Shared logic for Open/Closed usually, but we treat them somewhat independently in params)
    // We will just store them individually as per constants structure
    const [closedHat, setClosedHat] = useState<HatParams>(DEFAULT_CLOSED_HAT_PARAMS);
    const closedHatRef = useRef(DEFAULT_CLOSED_HAT_PARAMS);
    const updateClosedHat = (updates: Partial<HatParams>) => {
        const newState = { ...closedHat, ...updates };
        setClosedHat(newState);
        closedHatRef.current = newState;
    };

    const [openHat, setOpenHat] = useState<HatParams>(DEFAULT_OPEN_HAT_PARAMS);
    const openHatRef = useRef(DEFAULT_OPEN_HAT_PARAMS);
    const updateOpenHat = (updates: Partial<HatParams>) => {
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
    const handleTempoChange = useCallback((newTempo: number) => {
        setTempo(Math.round(newTempo))
    }, [])

    const handleVolumeChange = useCallback((newVol: number) => {
        setAmbianceVolume(newVol / 100)
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
        if (audioEngine) audioEngine.setAmbianceVolume(ambianceVolume)
    }, [ambianceVolume, audioEngine])

    useEffect(() => {
        if (audioEngine) {
            if (ambianceUrl) audioEngine.playAmbiance(ambianceUrl)
            else audioEngine.stopAmbiance()
        }
    }, [ambianceUrl, audioEngine])


    // --- RENDER HELPERS ---
    const renderControlKnobs = () => {
        // Helper to render Synth Knobs
        if (selectedTrack === 'partA' || selectedTrack === 'partB') {
            const params = selectedTrack === 'partA' ? synthA : synthB;
            const update = selectedTrack === 'partA' ? updateSynthA : updateSynthB;
            
            return (
                <>
                    <div className="flex flex-col gap-1 items-center mr-4">
                        <span className="text-xs text-cyan-400 mb-1 font-orbitron">WAVEFORM</span>
                        <div className="grid grid-cols-2 gap-1">
                            {['sawtooth', 'square', 'sine', 'triangle'].map(w => (
                                <button 
                                    key={w}
                                    onClick={() => update({ waveform: w as Waveform })}
                                    className={`w-8 h-8 text-[8px] rounded border ${params.waveform === w ? 'bg-cyan-600 border-cyan-300 text-white' : 'bg-gray-800 border-gray-600 text-gray-400'}`}
                                >
                                    {w.substring(0,3).toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>
                    <MagicKnob label="PITCH" value={params.pitch} min={-24} max={24} onChange={(v) => update({ pitch: v })} />
                    <MagicKnob label="CUTOFF" value={params.filterCutoff} min={100} max={8000} onChange={(v) => update({ filterCutoff: v })} />
                    <MagicKnob label="RES" value={params.filterResonance} min={0} max={20} onChange={(v) => update({ filterResonance: v })} />
                    <MagicKnob label="ATTACK" value={params.attack} min={0.01} max={1.0} onChange={(v) => update({ attack: v })} />
                    <MagicKnob label="DECAY" value={params.decay} min={0.1} max={2.0} onChange={(v) => update({ decay: v })} />
                    <MagicKnob label="VOL" value={params.volume * 100} min={0} max={100} onChange={(v) => update({ volume: v / 100 })} />
                </>
            );
        } 
        
        if (selectedTrack === 'kick') {
            return (
                <>
                     <MagicKnob label="PITCH" value={kick.pitch} min={30} max={150} onChange={(v) => updateKick({ pitch: v })} />
                     <MagicKnob label="DECAY" value={kick.decay} min={0.1} max={1.0} onChange={(v) => updateKick({ decay: v })} />
                     <MagicKnob label="TONE" value={kick.tone * 100} min={0} max={100} onChange={(v) => updateKick({ tone: v / 100 })} />
                     <MagicKnob label="VOL" value={kick.volume * 100} min={0} max={100} onChange={(v) => updateKick({ volume: v / 100 })} />
                </>
            )
        }

        if (selectedTrack === 'snare') {
            return (
                <>
                     <MagicKnob label="DECAY" value={snare.decay} min={0.05} max={0.5} onChange={(v) => updateSnare({ decay: v })} />
                     <MagicKnob label="TONE" value={snare.tone} min={100} max={400} onChange={(v) => updateSnare({ tone: v })} />
                     <MagicKnob label="NOISE" value={snare.noise} min={1000} max={8000} onChange={(v) => updateSnare({ noise: v })} />
                     <MagicKnob label="VOL" value={snare.volume * 100} min={0} max={100} onChange={(v) => updateSnare({ volume: v / 100 })} />
                </>
            )
        }

        if (selectedTrack === 'closedHat' || selectedTrack === 'openHat') {
            const params = selectedTrack === 'closedHat' ? closedHat : openHat;
            const update = selectedTrack === 'closedHat' ? updateClosedHat : updateOpenHat;
            return (
                <>
                     <MagicKnob label="PITCH" value={params.pitch} min={1000} max={15000} onChange={(v) => update({ pitch: v })} />
                     <MagicKnob label="DECAY" value={params.decay} min={0.05} max={1.0} onChange={(v) => update({ decay: v })} />
                     <MagicKnob label="VOL" value={params.volume * 100} min={0} max={100} onChange={(v) => update({ volume: v / 100 })} />
                </>
            )
        }
        return null;
    };

    return (
        <div style={{ width: '100vw', height: '100vh', background: '#08140a', position: 'relative', overflow: 'hidden' }}>
            {/* 1. SVG SEQUENCER LAYER */}
            <svg viewBox="0 0 1000 700" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', top:0, left:0, zIndex: 1 }}>
                <defs>
                    <filter id="softShadow" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#000" floodOpacity="0.45" />
                    </filter>
                </defs>

                <text x="500" y="50" textAnchor="middle" fontFamily="monospace" fontSize="32" fill="#3fa34d">Electribe Shader Synth</text>
                {pyodideStatus && (
                    <text x="500" y="85" textAnchor="middle" fontFamily="monospace" fontSize={14" fill="#d7f3d7">{pyodideStatus}</text>
                )}

                {/* Grid */}
                <g transform="translate(120,120)">
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

                {/* Transport Buttons */}
                <g transform="translate(650, 40)">
                    <TransportButton x={0} y={0} label={isPlaying ? 'Pause' : 'Play'} onClick={handlePlayToggle} />
                    <TransportButton x={130} y={0} label={'Stop'} onClick={handleStop} />
                </g>

                {/* Ambiance Selector */}
                <g transform="translate(800, 640)" onClick={handleAmbianceCycle} cursor="pointer" role="button">
                    <text x={0} y={0} fontFamily="monospace" fontSize={14" fill="#fff" textAnchor="end">Ambiance: {currentAmbianceName} ▶</text>
                </g>
            </svg>

            {/* 2. HTML/REACT LAYER FOR MAGIC KNOBS (Overlay) */}
            <div 
                className="bg-gray-900/80 border-t-2 border-cyan-800 backdrop-blur-sm"
                style={{ 
                    position: 'absolute', 
                    bottom: 0, 
                    left: 0, 
                    width: '100%', 
                    height: '180px', 
                    zIndex: 2, 
                    display: 'flex', 
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '20px',
                    padding: '0 40px'
                }}
            >
                {/* Global Controls */}
                <div className="flex items-center gap-4 border-r border-gray-700 pr-8 mr-4">
                    <MagicKnob label="TEMPO" value={tempo} min={60} max={200} onChange={handleTempoChange} size={70} />
                    <MagicKnob label="AMB VOL" value={ambianceVolume * 100} min={0} max={100} onChange={handleVolumeChange} size={70} />
                </div>

                {/* Dynamic Track Controls */}
                <div className="flex items-center gap-6 overflow-x-auto pb-2">
                   {renderControlKnobs()}
                </div>
            </div>
        </div>
    )
}

export default App

// --- 3. SVG UTILITIES ---

const TransportButton = memo(function TransportButton({ x, y, label, onClick }:{ x:number, y:number, label:string, onClick:()=>void }){
    return (
        <g transform={`translate(${x}, ${y})`} onClick={onClick} cursor="pointer" role="button" tabIndex={0} onKeyDown={(e)=>{ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); onClick() } }}>
            <rect x={0} y={0} width={120} height={40} rx={8} fill="#123017" stroke="#3fa34d" strokeWidth={2} />
            <text x={60} y={26} textAnchor="middle" fontFamily="monospace" fontSize={18} fill="#fff">{label}</text>
        </g>
    )
})
