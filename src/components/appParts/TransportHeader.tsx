import React, { memo } from 'react';
import { useAppStateContext } from '../../contexts/AppStateContext'
import { TransportToolbar } from '../TransportToolbar'

export const TransportHeader = React.memo(() => {
  const {
    songStorage,
    activeSongSlot,
    tempo,
    isRecording,
    isPlaying,
    isSongModeOpen,
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
    setIs3DMode,
    currentScale,
    setCurrentScale,
  } = useAppStateContext()

  return (
    <TransportToolbar
      songStorage={songStorage}
      activeSongSlot={activeSongSlot}
      tempo={tempo}
      isRecording={isRecording}
      isPlaying={isPlaying}
      isSongModeOpen={isSongModeOpen}
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
      setIs3DMode={setIs3DMode}
      currentScale={currentScale}
      setCurrentScale={setCurrentScale}
    />
  )
})

export default TransportHeader
