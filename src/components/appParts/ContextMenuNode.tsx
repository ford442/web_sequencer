import React, { useMemo } from 'react'
import { useAppStateContext } from '../../contexts/AppStateContext'
import { NoteSelector } from '../NoteSelector'
import { getNoteColor } from '../../utils/noteColors'

export const ContextMenuNode = React.memo(() => {
  const state = useAppStateContext()
  const { contextMenu, pattern, activeSamplerBank, handleNoteSelect, handleNoteLengthChange, handleNotePropertyChange, currentScale, setContextMenu, synthA, synthB } = state

  return useMemo(() => {
    if (!contextMenu) return null
    const track = contextMenu.track
    const step = contextMenu.step
    const sequence = track === 'sampler' ? pattern.sampler[activeSamplerBank] : (pattern as any)[track]
    const stepData = sequence?.steps[step] || null

    // Determine if the active synth for this track is a Prophecy voice
    const waveform = track === 'partA' ? synthA?.waveform : (track === 'partB' ? synthB?.waveform : undefined)
    const isProphecy = waveform?.startsWith('prophecy-') ?? false

    return (
      <div style={{ position: 'fixed', top: 0, left: 0, zIndex: 9999 }}>
        <NoteSelector
          x={contextMenu.x}
          y={contextMenu.y}
          trackType={track === 'sampler' ? 'voice' : (track.startsWith('part') ? 'synth' : 'drum')}
          currentNote={stepData?.note ?? ''}
          currentLength={stepData?.length ?? 1}
          currentPan={stepData?.pan}
          currentPitchAmount={stepData?.pitchAmount}
          currentPitchAttack={stepData?.pitchAttack}
          currentPitchDecay={stepData?.pitchDecay}
          currentTimbre={stepData?.timbre ?? 0}
          currentVelocity={stepData?.velocity ?? 1}
          currentProbability={stepData?.probability ?? 1}
          currentMicrotiming={stepData?.microtiming ?? 0}
          currentRetrigger={stepData?.retrigger ?? 1}
          currentReverse={stepData?.reverse ?? false}
          currentFreeze={stepData?.freeze ?? 0}
          currentFormantShift={stepData?.formantShift}
          currentSlideFormant={stepData?.slideFormant}
          currentFilterCutoff={stepData?.filterCutoff}
          currentFilterResonance={stepData?.filterResonance}
          currentEnvMod={stepData?.envMod}
          currentFormantLfoSync={stepData?.formantLfoSync}
          currentFormantLfoRate={stepData?.formantLfoRate ?? 0}
          currentFormantLfoDepth={stepData?.formantLfoDepth ?? 0}
          currentFormantEnvSync={stepData?.formantEnvSync}
          currentFormantEnvAttack={stepData?.formantEnvAttack}
          currentFormantEnvDecay={stepData?.formantEnvDecay}
          currentFormantEnvAmount={stepData?.formantEnvAmount}
          currentFormantEnvFollower={stepData?.formantEnvFollower}
          currentVibratoDepth={stepData?.vibratoDepth ?? 0}
          currentTremoloDepth={stepData?.tremoloDepth ?? 0}
          currentTremoloRate={stepData?.tremoloRate ?? 0}
          currentGateDepth={stepData?.gateDepth}
          currentGateRate={stepData?.gateRate}
          currentDrive={stepData?.drive}
          currentCharacterMorph={stepData?.characterMorph}
          currentReverbSend={stepData?.reverbSend}
          currentReverbType={stepData?.reverbType}
          currentDelayLfoRate={stepData?.delayLfoRate}
          currentDelayLfoDepth={stepData?.delayLfoDepth}
          currentDelaySend={stepData?.delaySend}
          currentChoir={stepData?.choir}
          currentVocoderMix={stepData?.vocoderMix}
          currentTranceGate={stepData?.tranceGate}
          currentTimeStretchEnvDepth={stepData?.timeStretchEnvDepth}
          currentFreezeEnvDepth={stepData?.freezeEnvDepth}
          currentGrainEnvDepth={stepData?.grainEnvDepth}
          currentGrainPitchEnvDepth={stepData?.grainPitchEnvDepth}
          currentGrainJitter={stepData?.grainJitter}
          currentGrainPitchQuantize={stepData?.grainPitchQuantize}
          currentSpectralPanRate={stepData?.spectralPanRate ?? 0}
          currentSpectralPanDepth={stepData?.spectralPanDepth ?? 0}
          currentGranularPitchShift={stepData?.granularPitchShift}
          isProphecy={isProphecy}
          currentVowel={stepData?.vowel ?? 0}
          currentPortamento={stepData?.portamento ?? 0}
          onSelect={handleNoteSelect}
          onLengthChange={handleNoteLengthChange}
          onPropertyChange={handleNotePropertyChange as any}
          onClose={() => setContextMenu(null)}
          getNoteColor={getNoteColor}
          currentScale={currentScale}
        />
      </div>
    )
  }, [contextMenu, pattern, activeSamplerBank, handleNoteSelect, handleNoteLengthChange, handleNotePropertyChange, currentScale, setContextMenu, synthA, synthB])
})

export default ContextMenuNode
