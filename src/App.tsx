import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAudioEngine } from './hooks/useAudioEngine'
import { usePyodideEngine } from './hooks/usePyodideEngine'
import { useScheduler } from './hooks/useScheduler'
import {
  INITIAL_PATTERN,
  NUM_STEPS,
  DEFAULT_TEMPO,
  DEFAULT_SYNTH_PARAMS_A,
  DEFAULT_SYNTH_PARAMS_B,
  AMBIANCE_TRACKS,
} from './constants'
import type { Pattern, SynthParams } from './types'

// Complete SVG-based App
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
  const synthARef = useRef<SynthParams>(DEFAULT_SYNTH_PARAMS_A)
  const synthBRef = useRef<SynthParams>(DEFAULT_SYNTH_PARAMS_B)

  // Scheduler callback
  const onStep = useCallback((step: number) => {
    if (!audioEngine) return
    const time = audioEngine.context.currentTime

    // Play frozen parts not implemented here (kept simple)

    // Synths
    if (pattern.partA.steps[step]) {
      audioEngine.playSynth(synthARef.current, pattern.partA.steps[step]!.note, time)
    }
    if (pattern.partB.steps[step]) {
      audioEngine.playSynth(synthBRef.current, pattern.partB.steps[step]!.note, time)
    }

    // Drums
    if (pattern.kick.steps[step]) audioEngine.playDrum('kick', { ...pattern.kick } as any, time)
    if (pattern.snare.steps[step]) audioEngine.playDrum('snare', { ...pattern.snare } as any, time)
    if (pattern.openHat.steps[step]) audioEngine.playDrum('openHat', { ...pattern.openHat } as any, time)
    else if (pattern.closedHat.steps[step]) audioEngine.playDrum('closedHat', { ...pattern.closedHat } as any, time)
  }, [audioEngine, pattern])

  const { isPlaying: schedPlaying, currentStep: schedStep, setIsPlaying: setSchedPlaying } = useScheduler(tempo, NUM_STEPS, onStep, isEngineReady)

  // Mirror scheduler state to local state for UI
  useEffect(() => setIsPlaying(schedPlaying), [schedPlaying])
  useEffect(() => setCurrentStep(schedStep), [schedStep])

  // Transport handlers
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

  // Pattern toggle
  const toggleStep = (rowKey: keyof Pattern, i: number) => {
    setPattern(prev => {
      const copy = JSON.parse(JSON.stringify(prev)) as Pattern
      const arr = copy[rowKey].steps
      arr[i] = arr[i] ? null : { note: rowKey.startsWith('part') ? (rowKey === 'partA' ? 'C4' : 'C3') : 'C2', velocity: 1 }
      return copy
    })
  }

  // Knob logic: tempo and ambiance volume
  const handleTempoChange = (newTempo: number) => {
    setTempo(Math.round(newTempo))
  }
  useEffect(() => {
    // Nothing else required; scheduler reads tempo prop
  }, [tempo])

  useEffect(() => {
    if (audioEngine) audioEngine.setAmbianceVolume(ambianceVolume)
  }, [ambianceVolume, audioEngine])

  useEffect(() => {
    if (audioEngine) {
      if (ambianceUrl) audioEngine.playAmbiance(ambianceUrl)
      else audioEngine.stopAmbiance()
    }
  }, [ambianceUrl, audioEngine])

  // Render SVG UI
  return (
    <svg viewBox="0 0 1000 700" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" style={{ background: '#08140a' }}>
      <defs>
        <filter id="softShadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor="#000" floodOpacity="0.45" />
        </filter>
      </defs>

      {/* Title */}
      <text x="500" y="50" textAnchor="middle" fontFamily="monospace" fontSize="32" fill="#3fa34d">SVG Sequencer</text>

      {/* Status */}
      {pyodideStatus && (
        <text x="500" y="85" textAnchor="middle" fontFamily="monospace" fontSize="14" fill="#d7f3d7">{pyodideStatus}</text>
      )}

      {/* Sequencer grid area */}
      <g transform="translate(50,120)">
        {ROWS.map((row, rIdx) => (
          <g key={row.key} transform={`translate(0, ${rIdx * 90})`} >
            <text x={-10} y={36} textAnchor="end" fontFamily="monospace" fontSize={18} fill="#fff">{row.label}</text>
            {Array.from({ length: NUM_STEPS }).map((_, i) => {
              const x = 20 + i * 48
              const active = (pattern as any)[row.key].steps[i]
              const isCurrent = currentStep === i
              return (
                <g key={i} transform={`translate(${x}, 0)`}
                   role="button"
                   aria-label={`${row.label} step ${i+1}`}
                   tabIndex={0}
                   onClick={() => toggleStep(row.key as any, i)}
                   onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleStep(row.key as any, i) } }}
                   cursor="pointer"
                >
                  <rect x={0} y={0} width={40} height={60} rx={10}
                        fill={active ? '#3fa34d' : '#123017'} stroke={isCurrent ? '#fff' : '#2f6f3d'} strokeWidth={isCurrent ? 3 : 2}
                        />
                  <text x={20} y={36} textAnchor="middle" fontFamily="monospace" fontSize={18} fill={active ? '#042004' : '#fff'}>{i+1}</text>
                </g>
              )
            })}
          </g>
        ))}
      </g>

      {/* Knobs / controls */}
      <g transform="translate(80, 640)">
        {/* Tempo knob (SVG circle + pointer) */}
      </g>

      {/* Tempo knob component inline */}
      <Knob x={180} y={510} label="Tempo" min={60} max={200} value={tempo} onChange={handleTempoChange} />
      <Knob x={320} y={510} label="Volume" min={0} max={100} value={ambianceVolume * 100} onChange={(v)=> setAmbianceVolume(v/100)} />

      {/* Transport buttons */}
      <g transform="translate(600, 480)">
        <TransportButton x={0} y={0} label={isPlaying ? 'Pause' : 'Play'} onClick={handlePlayToggle} />
        <TransportButton x={130} y={0} label={'Stop'} onClick={handleStop} />
      </g>

      {/* Ambiance selector simple display */}
      <g transform="translate(520, 580)">
        <text x={0} y={0} fontFamily="monospace" fontSize={14} fill="#fff">Ambiance:</text>
        <text x={90} y={0} fontFamily="monospace" fontSize={14} fill="#3fa34d">{ambianceUrl || 'None'}</text>
      </g>
    </svg>
  )
}

export default App

// Small Knob component implemented below (non-exported)
function Knob({ x, y, label, min, max, value, onChange }:{ x:number y:number label:string min:number max:number value:number onChange:(v:number)=>void }){
  const radius = 40
  const [val, setVal] = useState(value)
  const dragging = useRef(false)
  const pointerRef = useRef<SVGLineElement|null>(null)
  useEffect(()=> setVal(value),[value])

  useEffect(()=>{
    const onMove = (e:MouseEvent)=>{
      if(!dragging.current) return
      const svg = document.querySelector('svg')!
      const rect = svg.getBoundingClientRect()
      const mx = ((e.clientX - rect.left) / rect.width) * 1000
      const my = ((e.clientY - rect.top) / rect.height) * 700
      const dx = mx - x
      const dy = my - y
      let angle = Math.atan2(dy, dx) * 180/Math.PI
      angle = Math.max(-120, Math.min(120, angle))
      const newVal = min + ((angle + 120) / 240) * (max-min)
      setVal(newVal)
      onChange(newVal)
    }
    const onUp = ()=>{ dragging.current=false; document.body.style.cursor='' }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return ()=>{ window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  },[x,y,min,max,onChange])

  const angle = ((val - min) / (max-min)) * 240 - 120
  const rad = angle * Math.PI/180
  const px = x + Math.cos(rad) * (radius-10)
  const py = y + Math.sin(rad) * (radius-10)

  return (
    <g transform={`translate(0,0)`}>
      <circle cx={x} cy={y} r={radius} fill="#123017" stroke="#3fa34d" strokeWidth={3} filter="url(#softShadow)" onMouseDown={()=>{ dragging.current=true; document.body.style.cursor='grabbing' }} />
      <line ref={pointerRef} x1={x} y1={y} x2={px} y2={py} stroke="#fff" strokeWidth={5} strokeLinecap="round" />
      <text x={x} y={y+62} textAnchor="middle" fontFamily="monospace" fontSize={14} fill="#fff">{label}</text>
      <text x={x} y={y+22} textAnchor="middle" fontFamily="monospace" fontSize={14} fill="#3fa34d">{Math.round(val)}</text>
    </g>
  )
}

function TransportButton({ x, y, label, onClick }:{ x:number y:number label:string onClick:()=>void }){
  return (
    <g transform={`translate(${x}, ${y})`} onClick={onClick} cursor="pointer" role="button" tabIndex={0} aria-label={label} onKeyDown={(e)=>{ if(e.key==='Enter' || e.key===' ') { e.preventDefault(); onClick() } }}>
      <rect x={0} y={0} width={120} height={54} rx={14} fill="#123017" stroke="#fff" strokeWidth={3} />
      <text x={60} y={34} textAnchor="middle" fontFamily="monospace" fontSize={20} fill="#fff">{label}</text>
    </g>
  )
}
