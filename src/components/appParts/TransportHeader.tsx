import React, { memo } from 'react';
import { useAppStateContext } from '../../contexts/AppStateContext'
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
    is3DMode,
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
    setIs3DMode,
    currentScale,
    setCurrentScale,
    synthA,
    synthB,
    bass2,
    tempoLocked,
    slavePlayLabel,
  } = useAppStateContext()

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
