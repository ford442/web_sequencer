import React, { useMemo } from 'react'
import { useAppStateContext } from '../../contexts/AppStateContext'
import { NoteSelector } from '../NoteSelector'
import { getNoteColor } from '../../utils/noteColors'

export const ContextMenuNode = React.memo(() => {
  const state = useAppStateContext()
  const { contextMenu, pattern, activeSamplerBank, handleNoteSelect, handleNoteLengthChange, handleNotePropertyChange, currentScale, setContextMenu } = state

  return useMemo(() => {
    if (!contextMenu) return null
    const track = contextMenu.track
    const step = contextMenu.step
    const sequence = track === 'sampler' ? pattern.sampler[activeSamplerBank] : (pattern as any)[track]
    const stepData = sequence?.steps[step] || null

    return (
      <div style={{ position: 'fixed', top: 0, left: 0, zIndex: 9999 }}>
        <NoteSelector
          x={contextMenu.x}
          y={contextMenu.y}
          trackType={(track.startsWith('part') || track === 'sampler') ? 'synth' : 'drum'}
          currentNote={stepData?.note ?? ''}
          currentLength={stepData?.length ?? 1}
          currentTimbre={stepData?.timbre ?? 0}
          currentVelocity={stepData?.velocity ?? 1}
          currentProbability={stepData?.probability ?? 1}
          currentMicrotiming={stepData?.microtiming ?? 0}
          currentRetrigger={stepData?.retrigger ?? 1}
          currentReverse={stepData?.reverse ?? false}
          currentFreeze={stepData?.freeze ?? 0}
          currentFormantShift={stepData?.formantShift}
          currentFilterCutoff={stepData?.filterCutoff}
          currentFilterResonance={stepData?.filterResonance}
          currentEnvMod={stepData?.envMod}
          currentFormantLfoRate={stepData?.formantLfoRate ?? 0}
          currentFormantLfoDepth={stepData?.formantLfoDepth ?? 0}
          currentVibratoDepth={stepData?.vibratoDepth ?? 0}
          currentGateDepth={stepData?.gateDepth}
          currentGateRate={stepData?.gateRate}
          currentDrive={stepData?.drive}
          currentCharacterMorph={stepData?.characterMorph}
          currentReverbSend={stepData?.reverbSend}
          currentReverbType={stepData?.reverbType}
          currentDelaySend={stepData?.delaySend}
          currentChoir={stepData?.choir}
          currentTranceGate={stepData?.tranceGate}
          onSelect={handleNoteSelect}
          onLengthChange={handleNoteLengthChange}
          onPropertyChange={handleNotePropertyChange}
          onClose={() => setContextMenu(null)}
          getNoteColor={getNoteColor}
          currentScale={currentScale}
        />
      </div>
    )
  }, [contextMenu, pattern, activeSamplerBank, handleNoteSelect, handleNoteLengthChange, handleNotePropertyChange, currentScale, setContextMenu])
})

export default ContextMenuNode
