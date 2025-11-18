import React, { useCallback, useEffect, useRef, useState, memo, useMemo } from 'react'
import { useAudioEngine } from './hooks/useAudioEngine'
import { usePyodideEngine } from './hooks/usePyodideEngine'
import { useScheduler } from './hooks/useScheduler'
import { MagicKnob } from './components/MagicKnob' // <--- Import the WGSL Knob
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
    AMBIANCE_TRACKS, //
} from './constants'
import type { Pattern, SynthParams } from './types'

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
           onClick={onClick}
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
                               onToggle
                           }: {
    rowKey: string,
    label: string,
    rowIndex: number,
    steps: (any | null)[],
    currentStep: number,
    onToggle: (k: any, i: number) => void
}) => {
    return (
        <g transform={`translate(0, ${rowIndex * 90})`} >
            <text x={-10} y={36} textAnchor="end" fontFamily="monospace" fontSize={18} fill="#fff">{label}</text>
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

const ROWS = [
    { key: 'partA', label: 'Synth A' },
    { key: 'partB', label: 'Synth B' },
    { key: 'kick', label: 'Kick' },
    { key: 'snare', label: 'Snare' },
    { key: 'closedHat', label: 'CH' },
    { key: 'openHat', label: 'OH' },
] as const

export const App: React.FC = () => {
    const { pyodide, isPyodideReady, pyodideStatus } = usePyodideEngine()
    const { audioEngine, isReady, initializeAudio } = useAudioEngine(pyodide)

    const isEngineReady = isReady && (isPyodideReady || !!pyodideStatus)

    const [pattern, setPattern] = useState<Pattern>(INITIAL_PATTERN)
    const [tempo, setTempo] = useState<number>(DEFAULT_TEMPO)
    const [isInitialized, setIsInitialized] = useState(false)
    const [isPlaying, setIsPlaying] = useState(false)
    const [currentStep, setCurrentStep] = useState(-1)

    const [ambianceUrl, setAmbianceUrl] = useState<string>('')
    const [ambianceVolume, setAmbianceVolume] = useState(0.5)

    // --- AUDIO PARAMETER REFS ---
    const synthARef = useRef<SynthParams>(DEFAULT_SYNTH_PARAMS_A)
    const synthBRef = useRef<SynthParams>(DEFAULT_SYNTH_PARAMS_B)
    const kickRef = useRef(DEFAULT_KICK_PARAMS)
    const snareRef = useRef(DEFAULT_SNARE_PARAMS)
    const closedHatRef = useRef(DEFAULT_CLOSED_HAT_PARAMS)
    const openHatRef = useRef(DEFAULT_OPEN_HAT_PARAMS)

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

    // --- Handlers for Knobs ---
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

    return (
        <div style={{ width: '100vw', height: '100vh', background: '#08140a', position: 'relative', overflow: 'hidden' }}>
            {/* 1. SVG SEQUENCER LAYER */}
            <svg viewBox="0 0 1000 700" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ position: 'absolute', top:0, left:0, zIndex: 1 }}>
                <defs>
                    <filter id="softShadow" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#000" floodOpacity="0.45" />
                    </filter>
                </defs>

                <text x="500" y="50" textAnchor="middle" fontFamily="monospace" fontSize="32" fill="#3fa34d">SVG + WGSL Sequencer</text>
                {pyodideStatus && (
                    <text x="500" y="85" textAnchor="middle" fontFamily="monospace" fontSize="14" fill="#d7f3d7">{pyodideStatus}</text>
                )}

                {/* Grid */}
                <g transform="translate(50,120)">
                    {ROWS.map((row, rIdx) => (
                        <SequencerRow
                            key={row.key}
                            rowKey={row.key}
                            label={row.label}
                            rowIndex={rIdx}
                            steps={(pattern as any)[row.key].steps}
                            currentStep={currentStep}
                            onToggle={toggleStep}
                        />
                    ))}
                </g>

                {/* Transport Buttons */}
                <g transform="translate(600, 480)">
                    <TransportButton x={0} y={0} label={isPlaying ? 'Pause' : 'Play'} onClick={handlePlayToggle} />
                    <TransportButton x={130} y={0} label={'Stop'} onClick={handleStop} />
                </g>

                {/* Ambiance Selector */}
                <g transform="translate(520, 580)" onClick={handleAmbianceCycle} cursor="pointer" role="button">
                    <text x={0} y={0} fontFamily="monospace" fontSize={14} fill="#fff">Ambiance:</text>
                    <text x={90} y={0} fontFamily="monospace" fontSize={14} fill="#3fa34d">{currentAmbianceName} ▶</text>
                </g>
            </svg>

            {/* 2. HTML/REACT LAYER FOR MAGIC KNOBS (Overlay) */}
            {/* We use HTML overlay for Canvas elements because embedding Canvas inside SVG <foreignObject> can be buggy across browsers */}
            <div style={{ position: 'absolute', top: '72%', left: '18%', zIndex: 2, display: 'flex', gap: '30px' }}>
                <MagicKnob
                    label="TEMPO"
                    value={tempo}
                    min={60}
                    max={200}
                    onChange={handleTempoChange} // <--- Used Here!
                />
                <MagicKnob
                    label="VOLUME"
                    value={ambianceVolume * 100}
                    min={0}
                    max={100}
                    onChange={handleVolumeChange}
                />
            </div>
        </div>
    )
}

export default App

// --- 3. SVG UTILITIES ---

const TransportButton = memo(function TransportButton({ x, y, label, onClick }:{ x:number, y:number, label:string, onClick:()=>void }){
    return (
        <g transform={`translate(${x}, ${y})`} onClick={onClick} cursor="pointer" role="button" tabIndex={0} onKeyDown={(e)=>{ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); onClick() } }}>
            <rect x={0} y={0} width={120} height={54} rx={14} fill="#123017" stroke="#fff" strokeWidth={3} />
            <text x={60} y={34} textAnchor="middle" fontFamily="monospace" fontSize={20} fill="#fff">{label}</text>
        </g>
    )
})