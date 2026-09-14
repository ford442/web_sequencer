import React, { useMemo } from 'react'
import { useAppStateSelector, useAppStateSlice } from '../../contexts/AppStateContext'
import { NoteSelector } from '../NoteSelector'
import { getNoteColor } from '../../utils/noteColors'
import type { PartSequence } from '../../types'

const CONTEXT_MENU_KEYS = [
  'contextMenu', 'pattern', 'activeSamplerBank', 'handleNoteSelect', 'handleNoteLengthChange',
  'handleNotePropertyChange', 'currentScale', 'setContextMenu',
] as const

// Gate: subscribes to `contextMenu` alone, so a closed menu costs nothing on
// pattern edits. The open menu below is the only thing that reads `pattern`.
export const ContextMenuNode = React.memo(() => {
  const isOpen = useAppStateSelector((s) => s.contextMenu !== null)
  return isOpen ? <OpenContextMenu /> : null
})

const OpenContextMenu = React.memo(() => {
  const { contextMenu, pattern, activeSamplerBank, handleNoteSelect, handleNoteLengthChange, handleNotePropertyChange, currentScale, setContextMenu } = useAppStateSlice(CONTEXT_MENU_KEYS)
  // Only the two waveform strings matter, not the synth param objects.
  const partAWaveform = useAppStateSelector((s) => s.synthA?.waveform)
  const partBWaveform = useAppStateSelector((s) => s.synthB?.waveform)

  return useMemo(() => {
    if (!contextMenu) return null
    const track = contextMenu.track
    const step = contextMenu.step
    const sequence: PartSequence | undefined = track === 'sampler' ? pattern.sampler[activeSamplerBank] : pattern[track]
    const stepData = sequence?.steps[step] || null

    // Determine if the active synth for this track is a Prophecy voice
    const waveform = track === 'partA' ? partAWaveform : (track === 'partB' ? partBWaveform : undefined)
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
          currentFormantPitchLink={stepData?.formantPitchLink}
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
          currentGrainLfoRate={stepData?.grainLfoRate}
          currentGrainLfoDepth={stepData?.grainLfoDepth}
          currentGrainPosLfoDepth={stepData?.grainPosLfoDepth}
          currentTimeSmear={stepData?.timeSmear}
          currentGrainEnvDepth={stepData?.grainEnvDepth}
          currentGrainPitchEnvDepth={stepData?.grainPitchEnvDepth}
          currentGrainPitchQuantize={stepData?.grainPitchQuantize}
          currentSpectralPanRate={stepData?.spectralPanRate ?? 0}
          currentSpectralPanDepth={stepData?.spectralPanDepth ?? 0}
          currentGranularPitchShift={stepData?.granularPitchShift}
          currentBitcrush={stepData?.bitcrush}
          currentDownsample={stepData?.downsample}
          currentSpectralCompression={stepData?.spectralCompression}
          currentVolumeFilterMod={stepData?.volumeFilterMod}
          isProphecy={isProphecy}
          currentVowel={stepData?.vowel ?? 0}
          currentPortamento={stepData?.portamento ?? 0}
          onSelect={handleNoteSelect}
          onLengthChange={handleNoteLengthChange}
          onPropertyChange={handleNotePropertyChange}
          onClose={() => setContextMenu(null)}
          getNoteColor={getNoteColor}
          currentScale={currentScale}
        />
      </div>
    )
  }, [contextMenu, pattern, activeSamplerBank, handleNoteSelect, handleNoteLengthChange, handleNotePropertyChange, currentScale, setContextMenu, partAWaveform, partBWaveform])
})

export default ContextMenuNode
