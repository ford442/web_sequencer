import React from 'react'
import { useAppStateSlice } from '../../contexts/AppStateContext'
import { BottomBar } from '../BottomBar'

const BOTTOM_BAR_KEYS = [
    'viewMode', 'setViewMode', 'automationParam', 'setAutomationParam',
    'isLyricTrackVisible', 'setIsLyricTrackVisible',
    'isImportingAISong', 'aiImportStage', 'aiImportProgress',
    'exportSongToFile', 'exportRbsToFile', 'exportSmfToFile', 'importSongFromFile',
    'setIsRbsImportModalOpen', 'setIsSmfImportModalOpen', 'setIsExportModalOpen',
    'setIsAISongModalOpen', 'setIsCloudLibraryOpen',
    'isAutomationRecording', 'setIsAutomationRecording', 'isPlaying', 'handleAutoMix',
    'reverbType', 'handleReverbType',
    'masterSaturation', 'handleMasterSaturation', 'handleMasterSaturationKeyDown', 'handleMasterSaturationReset',
    'masterVolume', 'handleMasterVolume', 'handleMasterVolumeKeyDown', 'handleMasterVolumeReset',
    'globalPan', 'handleGlobalPan', 'handleGlobalPanKeyDown', 'handleGlobalPanReset',
    'audioEngine', 'forceScriptProcessorFallback', 'setForceScriptProcessorFallback',
    'showToast', 'setShowGamepadDebug', 'setIsShortcutsHelpOpen',
] as const

/** Feeds `BottomBar` its props from the app state. */
export const BottomBarNode = React.memo(() => {
    const s = useAppStateSlice(BOTTOM_BAR_KEYS)
    return (
        <BottomBar
            {...s}
            exportSongToFile={() => { void s.exportSongToFile(); }}
            exportRbsToFile={() => { void s.exportRbsToFile(); }}
            exportSmfToFile={() => { void s.exportSmfToFile(); }}
            importSongFromFile={() => { void s.importSongFromFile(); }}
        />
    )
})
