import React, { useEffect, useRef } from 'react';
import { useAppStateSelector, useAppStateSlice } from '../../contexts/AppStateContext'
import { useUIModalsStore } from '@/stores/uiModalsStore'
import { SongMode } from '../SongMode'
import { MainSequencer } from '../MainSequencer'
import { useCompactLayoutOptional } from '../../contexts/CompactLayoutContext'
import { DEFAULT_ZOOM } from '../sequencer/constants'

const SONG_PANEL_KEYS = [
  'songStructure', 'currentSongMeasure', 'backgroundImage', 'setBackgroundImage',
  'handleSongModeToggle', 'handleSongStructureUpdate', 'handleEditSongStructure',
  'handleAddMeasure', 'handleRemoveMeasure', 'handleExportXM', 'undoSongStructure',
  'redoSongStructure', 'isSongModeActive', 'setIsSongModeActive',
] as const

const GRID_KEYS = [
  'pattern', 'activeSamplerBank', 'selectedTrack', 'activeTrackSlots', 'trackStorage', 'selection',
  'handleStepToggle', 'handleRightMouseDown', 'handleEditLength', 'handleSelectRow',
  'handleTrackSlotClick', 'handleSelectionStart', 'handleSelectionEnter', 'viewMode',
  'automationParam', 'handleAutomationChange', 'activeAlignment', 'melodicMode',
  'handlePitchChange', 'handlePhonemeUpdate', 'sampleBuffers', 'zoomLevel', 'setZoomLevel',
  'sequencerRef',
] as const

/** Applies the compact layout's default zoom once. Renders nothing, so a zoom
 * change re-renders only this, not the sequencer subtree. */
function CompactAutoZoom() {
  const compactLayout = useCompactLayoutOptional();
  const zoomLevel = useAppStateSelector((s) => s.zoomLevel);
  const setZoomLevel = useAppStateSelector((s) => s.setZoomLevel);
  const autoZoomAppliedRef = useRef(false);
  useEffect(() => {
    if (!compactLayout?.isCompact || autoZoomAppliedRef.current) return;
    if (zoomLevel <= DEFAULT_ZOOM) {
      setZoomLevel(2.2);
    }
    autoZoomAppliedRef.current = true;
  }, [compactLayout?.isCompact, zoomLevel, setZoomLevel]);
  return null;
}

/** The 3D studio's in-scene song editor. Owns the song fields so the 2D grid
 * never subscribes to them. */
const SongModePanel3D = React.memo(() => {
  const song = useAppStateSlice(SONG_PANEL_KEYS)
  // Derived by calling the (stable) undo helpers, so the flags stay fresh.
  const canUndoSong = useAppStateSelector((s) => s.canUndoSong())
  const canRedoSong = useAppStateSelector((s) => s.canRedoSong())
  return (
    <div className="w-full h-[480px] p-4 bg-[#0a0d10] rounded-xl border-2 border-gray-700 shadow-2xl relative overflow-hidden">
      <div className="absolute inset-0 rounded-xl border-2 border-cyan-900/10 pointer-events-none z-50"></div>
      <SongMode
        isVisible={true}
        is3D={true}
        songStructure={song.songStructure}
        currentSongStep={song.currentSongMeasure}
        backgroundImage={song.backgroundImage}
        onSetBackgroundImage={song.setBackgroundImage}
        onToggle={song.handleSongModeToggle}
        onUpdateStep={song.handleSongStructureUpdate}
        onEditStructure={song.handleEditSongStructure}
        onUndoSong={song.undoSongStructure}
        onRedoSong={song.redoSongStructure}
        canUndoSong={canUndoSong}
        canRedoSong={canRedoSong}
        onAddMeasure={song.handleAddMeasure}
        onRemoveMeasure={song.handleRemoveMeasure}
        onExportXM={song.handleExportXM}
        isSongModeActive={song.isSongModeActive}
        onSetIsSongModeActive={song.setIsSongModeActive}
      />
    </div>
  )
})

/** The step grid. This is the one region that legitimately re-renders on a
 * pattern edit; nothing else it needs changes as often. */
export const SequencerGrid = React.memo(() => {
  const g = useAppStateSlice(GRID_KEYS)
  return (
    <MainSequencer
      ref={g.sequencerRef}
      pattern={g.pattern}
      activeSamplerBank={g.activeSamplerBank}
      selectedTrack={g.selectedTrack}
      activeTrackSlots={g.activeTrackSlots}
      trackStorage={g.trackStorage}
      selection={g.selection}
      onToggle={g.handleStepToggle}
      onRightMouseDown={g.handleRightMouseDown}
      onEditLength={g.handleEditLength}
      onSelectRow={g.handleSelectRow}
      onSelectSlot={g.handleTrackSlotClick}
      onSelectionStart={g.handleSelectionStart}
      onSelectionEnter={g.handleSelectionEnter}
      viewMode={g.viewMode}
      automationParam={g.automationParam}
      onAutomationChange={g.handleAutomationChange}
      alignment={g.activeAlignment}
      melodicMode={g.melodicMode}
      onPitchChange={g.handlePitchChange}
      onPhonemeUpdate={g.handlePhonemeUpdate}
      samplerAudioBuffer={g.sampleBuffers[g.activeSamplerBank]}
      zoomLevel={g.zoomLevel}
      onZoomChange={g.setZoomLevel}
    />
  )
})

export const SequencerNode = React.memo(() => {
  const is3DMode = useUIModalsStore((s) => s.is3DMode)
  const isSongModeOpen = useAppStateSelector((s) => s.isSongModeOpen)
  return (
    <>
      <CompactAutoZoom />
      {isSongModeOpen && is3DMode ? <SongModePanel3D /> : <SequencerGrid />}
    </>
  )
})

export default SequencerNode
