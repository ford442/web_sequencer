import React, { memo } from 'react';
import { useAppStateSelector, useAppStateSlice, type AppState } from '../../contexts/AppStateContext'
import { shallowEqual } from '@/stores/appStateStore'
import { useUIModalsStore, uiModalsStore } from '@/stores/uiModalsStore'
import { TransportToolbar } from '../TransportToolbar'
import { EngineStatusPill } from '../EngineStatusPill'

const TRANSPORT_KEYS = [
  'songStorage', 'activeSongSlot', 'tempo', 'isRecording', 'isPlaying', 'isSongModeOpen', 'isSessionOpen',
  'loadSong', 'handleSaveSong', 'handleClearPattern', 'handleTempoHoldStart', 'handleTempoHoldEnd',
  'handleTempoKeyDown', 'handlePanic', 'handlePlayToggle', 'setIsRecording', 'setIsSongModeOpen',
  'setIsSessionOpen', 'currentScale', 'setCurrentScale', 'tempoLocked', 'slavePlayLabel',
] as const

const selectEngineVoices = (s: AppState) => ({
  aWaveform: s.synthA.waveform, aEngine303: s.synthA.engine303,
  bWaveform: s.synthB.waveform, bEngine303: s.synthB.engine303,
  b2Waveform: s.bass2.waveform, b2Engine303: s.bass2.engine303,
})

export const TransportHeader = React.memo(({ onToggleCompact, isCompactLayout }: { onToggleCompact?: () => void; isCompactLayout?: boolean }) => {
  const {
    songStorage,
    activeSongSlot,
    tempo,
    isRecording,
    isPlaying,
    isSongModeOpen,
    isSessionOpen,
    loadSong,
    handleSaveSong,
    handleClearPattern,
    handleTempoHoldStart,
    handleTempoHoldEnd,
    handleTempoKeyDown,
    handlePanic,
    handlePlayToggle,
    setIsRecording,
    setIsSongModeOpen,
    setIsSessionOpen,
    currentScale,
    setCurrentScale,
    tempoLocked,
    slavePlayLabel,
  } = useAppStateSlice(TRANSPORT_KEYS)

  // The status pill only needs each voice's engine selection, not the whole
  // synth params object — which changes on every knob turn.
  const voices = useAppStateSelector(selectEngineVoices, shallowEqual)

  // Sourced directly from the store (not the mega-context) so a step toggle
  // or any other unrelated app-state update doesn't force this to re-render
  // just to read a flag that didn't change.
  const is3DMode = useUIModalsStore((s) => s.is3DMode);
  const setIs3DMode = uiModalsStore.setIs3DMode;

  const engineStatus = (
    <EngineStatusPill
      synthA={{ label: 'A', waveform: voices.aWaveform, engine303: voices.aEngine303 }}
      synthB={{ label: 'B', waveform: voices.bWaveform, engine303: voices.bEngine303 }}
      bass2={{ label: 'B2', waveform: voices.b2Waveform, engine303: voices.b2Engine303 }}
    />
  );

  return (
    <TransportToolbar
      songStorage={songStorage}
      activeSongSlot={activeSongSlot}
      tempo={tempo}
      isRecording={isRecording}
      isPlaying={isPlaying}
      isSongModeOpen={isSongModeOpen}
      isSessionOpen={isSessionOpen}
      is3DMode={is3DMode}
      loadSong={loadSong}
      handleSaveSong={handleSaveSong}
      handleClearPattern={handleClearPattern}
      handleTempoHoldStart={handleTempoHoldStart}
      handleTempoHoldEnd={handleTempoHoldEnd}
      handleTempoKeyDown={handleTempoKeyDown}
      handlePanic={handlePanic}
      handlePlayToggle={handlePlayToggle}
      setIsRecording={setIsRecording}
      setIsSongModeOpen={setIsSongModeOpen}
      setIsSessionOpen={setIsSessionOpen}
      setIs3DMode={setIs3DMode}
      currentScale={currentScale}
      setCurrentScale={setCurrentScale}
      engineStatus={engineStatus}
      onToggleCompact={onToggleCompact}
      isCompactLayout={isCompactLayout}
      tempoLocked={tempoLocked}
      playLabel={slavePlayLabel}
    />
  )
})

export default TransportHeader
