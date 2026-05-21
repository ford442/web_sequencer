import React, { useMemo, memo } from 'react';
import { useAppStateContext } from '../../contexts/AppStateContext'
import { SongMode } from '../SongMode'
import { MainSequencer } from '../MainSequencer'

export const SequencerNode = React.memo(() => {
  const state = useAppStateContext()
  const {
    isSongModeOpen,
    is3DMode,
    songStructure,
    currentSongMeasure,
    backgroundImage,
    setBackgroundImage,
    handleSongModeToggle,
    handleSongStructureUpdate,
    handleAddMeasure,
    handleRemoveMeasure,
    handleExportXM,
    isSongModeActive,
    setIsSongModeActive,
    pattern,
    activeSamplerBank,
    selectedTrack,
    activeTrackSlots,
    trackStorage,
    selection,
    handleStepToggle,
    handleRightMouseDown,
    handleEditLength,
    handleSelectRow,
    handleTrackSlotClick,
    handleSelectionStart,
    handleSelectionEnter,
    viewMode,
    automationParam,
    handleAutomationChange,
    activeAlignment,
    melodicMode,
    handlePitchChange,
    handlePhonemeUpdate,
    sampleBuffers,
    zoomLevel,
    setZoomLevel,
  } = state

  return useMemo(() => {
    if (isSongModeOpen && is3DMode) {
      return (
        <div className="w-full h-[480px] p-4 bg-[#0a0d10] rounded-xl border-2 border-gray-700 shadow-2xl relative overflow-hidden">
          <div className="absolute inset-0 rounded-xl border-2 border-cyan-900/10 pointer-events-none z-50"></div>
          <SongMode
            isVisible={true}
            is3D={true}
            songStructure={songStructure}
            currentSongStep={currentSongMeasure}
            backgroundImage={backgroundImage}
            onSetBackgroundImage={setBackgroundImage}
            onToggle={handleSongModeToggle}
            onUpdateStep={handleSongStructureUpdate}
            onAddMeasure={handleAddMeasure}
            onRemoveMeasure={handleRemoveMeasure}
            onExportXM={handleExportXM}
            isSongModeActive={isSongModeActive}
            onSetIsSongModeActive={setIsSongModeActive}
          />
        </div>
      )
    }

    return (
      <MainSequencer
        ref={state.sequencerRef}
        pattern={pattern}
        activeSamplerBank={activeSamplerBank}
        selectedTrack={selectedTrack}
        activeTrackSlots={activeTrackSlots}
        trackStorage={trackStorage}
        selection={selection}
        onToggle={handleStepToggle}
        onRightMouseDown={handleRightMouseDown}
        onEditLength={handleEditLength}
        onSelectRow={handleSelectRow}
        onSelectSlot={handleTrackSlotClick}
        onSelectionStart={handleSelectionStart}
        onSelectionEnter={handleSelectionEnter}
        viewMode={viewMode}
        automationParam={automationParam}
        onAutomationChange={handleAutomationChange}
        alignment={activeAlignment}
        melodicMode={melodicMode}
        onPitchChange={handlePitchChange}
        onPhonemeUpdate={handlePhonemeUpdate}
        samplerAudioBuffer={sampleBuffers[activeSamplerBank]}
        zoomLevel={zoomLevel}
        onZoomChange={setZoomLevel}
      />
    )
  }, [
    isSongModeOpen,
    is3DMode,
    songStructure,
    currentSongMeasure,
    backgroundImage,
    isSongModeActive,
    pattern,
    activeSamplerBank,
    selectedTrack,
    activeTrackSlots,
    trackStorage,
    selection,
    handleSongModeToggle,
    handleSongStructureUpdate,
    handleAddMeasure,
    handleRemoveMeasure,
    handleExportXM,
    setIsSongModeActive,
    setBackgroundImage,
    handleStepToggle,
    handleRightMouseDown,
    handleEditLength,
    handleSelectRow,
    handleTrackSlotClick,
    handleSelectionStart,
    handleSelectionEnter,
    handleAutomationChange,
    handlePhonemeUpdate,
    handlePitchChange,
    activeAlignment,
    automationParam,
    melodicMode,
    sampleBuffers,
    viewMode,
    zoomLevel,
    setZoomLevel,
    state.sequencerRef,
  ])
})

export default SequencerNode
