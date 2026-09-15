import React, { memo } from 'react';
import { useAppStateContext } from '../../contexts/AppStateContext'
import { useUIModalsStore, uiModalsStore } from '@/stores/uiModalsStore'
import { TransportToolbar } from '../TransportToolbar'
import { EngineStatusPill } from '../EngineStatusPill'

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
    synthA,
    synthB,
    bass2,
    tempoLocked,
    slavePlayLabel,
  } = useAppStateContext()

  // Sourced directly from the store (not the mega-context) so a step toggle
  // or any other unrelated app-state update doesn't force this to re-render
  // just to read a flag that didn't change.
  const is3DMode = useUIModalsStore((s) => s.is3DMode);
  const setIs3DMode = uiModalsStore.setIs3DMode;

  const engineStatus = (
    <EngineStatusPill
      synthA={{ label: 'A', waveform: synthA.waveform, engine303: synthA.engine303 }}
      synthB={{ label: 'B', waveform: synthB.waveform, engine303: synthB.engine303 }}
      bass2={{ label: 'B2', waveform: bass2.waveform, engine303: bass2.engine303 }}
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
