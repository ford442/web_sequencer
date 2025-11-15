import React, { useState, useCallback, useEffect } from 'react'
import { Sequencer } from './components/Sequencer'
import { SynthPart } from './components/SynthPart'
import { Transport } from './components/Transport'
import { DrumMachine } from './components/DrumMachine'
import { AmbiancePlayer } from './components/AmbiancePlayer'
import { useAudioEngine } from './hooks/useAudioEngine'
import { useScheduler } from './hooks/useScheduler'
import { usePyodideEngine } from './hooks/usePyodideEngine';

import {
  DEFAULT_SYNTH_PARAMS_A,
  DEFAULT_SYNTH_PARAMS_B,
  INITIAL_PATTERN,
  NUM_STEPS,
  DEFAULT_TEMPO,
  DEFAULT_KICK_PARAMS,
  DEFAULT_SNARE_PARAMS,
  DEFAULT_CLOSED_HAT_PARAMS,
  DEFAULT_OPEN_HAT_PARAMS,
  AMBIANCE_TRACKS,
} from './constants'
import type { Pattern, SynthParams, AllDrumParams, DrumSound, KickParams, SnareParams, HatParams } from './types'

type FrozenParts = {
  A: AudioBuffer | null
  B: AudioBuffer | null
}

const App: React.FC = () => {
  const [synthAParams, setSynthAParams] = useState<SynthParams>(DEFAULT_SYNTH_PARAMS_A)
  const [synthBParams, setSynthBParams] = useState<SynthParams>(DEFAULT_SYNTH_PARAMS_B)
  const [drumParams, setDrumParams] = useState<AllDrumParams>({
    kick: DEFAULT_KICK_PARAMS,
    snare: DEFAULT_SNARE_PARAMS,
    closedHat: DEFAULT_CLOSED_HAT_PARAMS,
    openHat: DEFAULT_OPEN_HAT_PARAMS,
  })
  const [pattern, setPattern] = useState<Pattern>(INITIAL_PATTERN)
  const [tempo, setTempo] = useState<number>(DEFAULT_TEMPO)
  const [isInitialized, setIsInitialized] = useState(false)
  const [frozenParts, setFrozenParts] = useState<FrozenParts>({ A: null, B: null })
  const [renderingPart, setRenderingPart] = useState<'A' | 'B' | null>(null)
  const [ambianceUrl, setAmbianceUrl] = useState<string>('')
  const [ambianceVolume, setAmbianceVolume] = useState(0.5)
  const { pyodide, isPyodideReady, pyodideStatus } = usePyodideEngine();

  const { audioEngine, isReady, initializeAudio } = useAudioEngine(pyodide);

  const onStep = useCallback(
    (step: number) => {
      if (!audioEngine) return

      const stepTime = audioEngine.context.currentTime

      if (step === 0) {
        if (frozenParts.A) audioEngine.playBufferedPart(frozenParts.A, stepTime)
        if (frozenParts.B) audioEngine.playBufferedPart(frozenParts.B, stepTime)
      }

      if (!frozenParts.A && pattern.partA.steps[step]) {
      audioEngine.playSynth(synthAParams, pattern.partA.steps[step]!.note, stepTime);
      }
      if (!frozenParts.B && pattern.partB.steps[step]) {
      audioEngine.playSynth(synthBParams, pattern.partB.steps[step]!.note, stepTime);
      }

      if (pattern.kick.steps[step]) audioEngine.playDrum('kick', drumParams.kick, stepTime)
      if (pattern.snare.steps[step]) audioEngine.playDrum('snare', drumParams.snare, stepTime)
      if (pattern.openHat.steps[step]) {
        audioEngine.playDrum('openHat', drumParams.openHat, stepTime)
      } else if (pattern.closedHat.steps[step]) {
        audioEngine.playDrum('closedHat', drumParams.closedHat, stepTime)
      }
    },
    [audioEngine, pattern, synthAParams, synthBParams, drumParams, frozenParts]
  )

  const { isPlaying, currentStep, setIsPlaying } = useScheduler(tempo, NUM_STEPS, onStep, isReady && (isPyodideReady || !pyodideStatus)); // Wait for pyodide to be ready or failed

  const handlePlayClick = async () => {
    if (!isInitialized) {
      await initializeAudio()
      setIsInitialized(true)
    }
    setIsPlaying(!isPlaying)
  }

  const handlePatternChange = useCallback(
    (part: keyof Pattern, stepIndex: number) => {
      setPattern(prevPattern => {
        const newSteps = [...prevPattern[part].steps]
        newSteps[stepIndex] = newSteps[stepIndex] ? null : { note: 'C2', velocity: 1 }
        return {
          ...prevPattern,
          [part]: {
            ...prevPattern[part],
            steps: newSteps,
          },
        }
      })
    },
    []
  )

  const handleDrumParamsChange = useCallback(
    (sound: DrumSound, newParams: KickParams | SnareParams | HatParams) => {
      setDrumParams(prev => ({ ...prev, [sound]: newParams }))
    },
    []
  )

  const handleMixdown = async (part: 'A' | 'B') => {
    if (!audioEngine || renderingPart) return
    setRenderingPart(part)
    const params = part === 'A' ? synthAParams : synthBParams
    const sequence = part === 'A' ? pattern.partA : pattern.partB
        // NEW: Check if mixing down a pyodide wave
    if (params.waveform.startsWith('pyodide-')) {
        console.warn("Mixdown for Pyodide synths is not yet supported.");
        // Or show a user-facing error
        setRenderingPart(null); // Stop loading state
        return;
    }
    const buffer = await audioEngine.renderSynthPartToBuffer(params, sequence, tempo)
    setFrozenParts(prev => ({ ...prev, [part]: buffer }))
    setRenderingPart(null)
  }

  const handleUnfreeze = (part: 'A' | 'B') => {
    setFrozenParts(prev => ({ ...prev, [part]: null }))
  }

  useEffect(() => {
    if (audioEngine) {
      if (ambianceUrl) {
        audioEngine.playAmbiance(ambianceUrl)
      } else {
        audioEngine.stopAmbiance()
      }
    }
  }, [ambianceUrl, audioEngine])

  useEffect(() => {
    if (audioEngine) {
      audioEngine.setAmbianceVolume(ambianceVolume)
    }
  }, [ambianceVolume, audioEngine])
  const isEngineReady = isReady && (isPyodideReady || !!pyodideStatus); // Ready if audio is on AND pyodide is either ready or still loading/failed

  return (
    <div className="min-h-screen bg-gray-900 text-gray-200 flex flex-col items-center justify-center p-2 sm:p-4">
      <div className="w-full max-w-7xl bg-gray-800 border-4 border-gray-700 rounded-xl shadow-2xl p-4 space-y-4">
        <header className="flex flex-col sm:flex-row justify-between items-center space-y-4 sm:space-y-0">
          <h1 className="font-orbitron text-2xl sm:text-3xl font-bold text-cyan-400 tracking-wider">EA-WEB</h1>
          {pyodideStatus && (
            <div className="text-yellow-400 text-sm animate-pulse">{pyodideStatus}</div>
          )}
          <AmbiancePlayer
            tracks={AMBIANCE_TRACKS}
            selectedUrl={ambianceUrl}
            onSelect={setAmbianceUrl}
            volume={ambianceVolume}
            onVolumeChange={setAmbianceVolume}
          />
          <Transport isPlaying={isPlaying} onPlayClick={handlePlayClick} tempo={tempo} onTempoChange={setTempo} />
        </header>

        {!isInitialized && (
          <div className="flex flex-col items-center justify-center p-8 bg-gray-900 rounded-lg border-2 border-dashed border-gray-600">
            <h2 className="text-xl font-bold text-yellow-400 mb-2">Audio Engine Offline</h2>
            <p className="text-center text-gray-400 mb-4">Click the play button to initialize the audio context and start the synth.</p>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-500 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.636 18.364a9 9 0 010-12.728m2.828 9.9a5 5 0 010-7.072" />
            </svg>
          </div>
        )}

        <main className={`space-y-4 transition-opacity duration-500 ${isInitialized ? 'opacity-100' : 'opacity-30 blur-sm pointer-events-none'}`}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SynthPart
              title="Synth Part A"
              accentColor="cyan"
              params={synthAParams}
              onParamsChange={setSynthAParams}
              isFrozen={!!frozenParts.A}
              isRendering={renderingPart === 'A'}
              onMixdown={() => handleMixdown('A')}
              onUnfreeze={() => handleUnfreeze('A')}
            />
            <SynthPart
              title="Synth Part B"
              accentColor="pink"
              params={synthBParams}
              onParamsChange={setSynthBParams}
              isFrozen={!!frozenParts.B}
              isRendering={renderingPart === 'B'}
              onMixdown={() => handleMixdown('B')}
              onUnfreeze={() => handleUnfreeze('B')}
            />
          </div>
          <DrumMachine params={drumParams} onParamsChange={handleDrumParamsChange} />
        </main>

        <footer className={`transition-opacity duration-500 ${isInitialized ? 'opacity-100' : 'opacity-30 blur-sm pointer-events-none'}`}>
          <Sequencer pattern={pattern} currentStep={currentStep} isPlaying={isPlaying} onPatternChange={handlePatternChange} />
        </footer>
      </div>
    </div>
  )
}

export default App
