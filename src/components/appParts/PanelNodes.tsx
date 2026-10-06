import React from 'react'
import { useAppStateSelector, useAppStateSlice } from '../../contexts/AppStateContext'
import { SongMode } from '../SongMode'
import { SessionLauncher } from '../SessionLauncher'
import { MobileTransportDock } from '../MobileTransportDock'
import { LyricTrack } from '../LyricTrack'

const SONG_KEYS = [
    'isSongModeOpen', 'songStructure', 'currentSongMeasure', 'backgroundImage', 'setBackgroundImage',
    'handleSongModeToggle', 'handleSongStructureUpdate', 'handleEditSongStructure',
    'undoSongStructure', 'redoSongStructure', 'handleAddMeasure', 'handleRemoveMeasure',
    'handleExportXM', 'isSongModeActive', 'setIsSongModeActive',
] as const

export const SongModeNode = React.memo(() => {
    const s = useAppStateSlice(SONG_KEYS)
    // Derived by calling the (stable) undo helpers, so the flags stay fresh.
    const canUndoSong = useAppStateSelector((state) => state.canUndoSong())
    const canRedoSong = useAppStateSelector((state) => state.canRedoSong())
    return (
        <SongMode
            isVisible={s.isSongModeOpen}
            songStructure={s.songStructure}
            currentSongStep={s.currentSongMeasure}
            backgroundImage={s.backgroundImage}
            onSetBackgroundImage={s.setBackgroundImage}
            onToggle={s.handleSongModeToggle}
            onUpdateStep={s.handleSongStructureUpdate}
            onEditStructure={s.handleEditSongStructure}
            onUndoSong={s.undoSongStructure}
            onRedoSong={s.redoSongStructure}
            canUndoSong={canUndoSong}
            canRedoSong={canRedoSong}
            onAddMeasure={s.handleAddMeasure}
            onRemoveMeasure={s.handleRemoveMeasure}
            onExportXM={s.handleExportXM}
            isSongModeActive={s.isSongModeActive}
            onSetIsSongModeActive={s.setIsSongModeActive}
        />
    )
})

const SESSION_KEYS = [
    'isSessionOpen', 'sessionDocument', 'sessionPlayingSlots', 'isSessionCapturing',
    'setIsSessionOpen', 'launchSessionClip', 'launchSessionScene', 'stopSessionTrack',
    'stopSessionAll', 'setSessionQuantization', 'beginSessionCapture', 'finishSessionCapture',
    'undoSession', 'redoSession', 'loadSessionPack', 'setSessionDocument',
    'handleEditSongStructure', 'setIsSongModeOpen',
] as const

export const SessionNode = React.memo(() => {
    const s = useAppStateSlice(SESSION_KEYS)
    const canUndo = useAppStateSelector((state) => state.canUndoSession())
    const canRedo = useAppStateSelector((state) => state.canRedoSession())
    // The playhead lives in a ref, so it never triggers a render by itself; it
    // is re-read on each store update, as it was when `App` re-rendered.
    const currentStep = useAppStateSelector((state) => state.currentStepRef.current)
    return (
        <SessionLauncher
            isVisible={s.isSessionOpen}
            document={s.sessionDocument}
            playingSlots={s.sessionPlayingSlots}
            currentStep={currentStep}
            isCapturing={s.isSessionCapturing}
            quantization={s.sessionDocument.quantization}
            onClose={() => s.setIsSessionOpen(false)}
            onLaunchClip={s.launchSessionClip}
            onLaunchScene={s.launchSessionScene}
            onStopTrack={s.stopSessionTrack}
            onStopAll={s.stopSessionAll}
            onSetQuantization={s.setSessionQuantization}
            onBeginCapture={s.beginSessionCapture}
            onFinishCapture={() => {
                const captured = s.finishSessionCapture();
                s.handleEditSongStructure(() => captured);
                s.setIsSongModeOpen(true);
            }}
            onUndo={s.undoSession}
            onRedo={s.redoSession}
            canUndo={canUndo}
            canRedo={canRedo}
            onLoadPack={s.loadSessionPack}
            onUpdateDocument={(doc) => s.setSessionDocument(doc)}
        />
    )
})

const DOCK_KEYS = [
    'isPlaying', 'isRecording', 'tempo', 'isSongModeOpen', 'isSessionOpen',
    'handlePlayToggle', 'setIsRecording', 'handleTempoHoldStart', 'handleTempoHoldEnd',
    'setIsSongModeOpen', 'setIsSessionOpen', 'handlePanic',
] as const

export const MobileTransportNode = React.memo(() => {
    const s = useAppStateSlice(DOCK_KEYS)
    return (
        <MobileTransportDock
            isPlaying={s.isPlaying}
            isRecording={s.isRecording}
            tempo={s.tempo}
            isSongModeOpen={s.isSongModeOpen}
            isSessionOpen={s.isSessionOpen}
            onPlayToggle={() => void s.handlePlayToggle()}
            onRecordToggle={() => s.setIsRecording(!s.isRecording)}
            onTempoNudgeStart={s.handleTempoHoldStart}
            onTempoNudgeEnd={s.handleTempoHoldEnd}
            onSongModeToggle={() => s.setIsSongModeOpen(!s.isSongModeOpen)}
            onSessionToggle={() => s.setIsSessionOpen(!s.isSessionOpen)}
            onPanic={s.handlePanic}
        />
    )
})

const LYRIC_KEYS = [
    'isLyricTrackVisible', 'ttsPhrases', 'activeSamplerBank', 'isGenerating',
    'handleLyricApply', 'setIsLyricTrackVisible',
] as const

export const LyricTrackNode = React.memo(() => {
    const s = useAppStateSlice(LYRIC_KEYS)
    return (
        <LyricTrack
            isVisible={s.isLyricTrackVisible}
            initialText={s.ttsPhrases[s.activeSamplerBank] || ""}
            isGenerating={s.isGenerating}
            onApply={(...args) => void s.handleLyricApply(...args)}
            onClose={() => s.setIsLyricTrackVisible(false)}
        />
    )
})
