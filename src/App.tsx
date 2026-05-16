import { lazy, Suspense } from 'react'
import { useAppState } from './hooks/useAppState.tsx'

import TransportHeader from './components/appParts/TransportHeader'
import SequencerNode from './components/appParts/SequencerNode'
import ContextMenuNode from './components/appParts/ContextMenuNode'
import RackNode from './components/appParts/RackNode'
import KeyboardNode from './components/appParts/KeyboardNode'

import { BottomBar } from './components/BottomBar'
import { AISongImportOverlay } from './components/AISongImportOverlay'
import { CloudLibrary } from './components/CloudLibrary'
import { AISongModal } from './components/AISongModal'
import { RbsImportModal } from './components/RbsImportModal'
import { VoiceEditor } from './components/VoiceEditor'
import { ShortcutsHelp } from './components/ShortcutsHelp'
import { GamepadDebugger } from './components/GamepadDebugger'
import { LyricTrack } from './components/LyricTrack'
import { Toast } from './components/Toast'
import { StartOverlay } from './components/StartOverlay'
import { LoadingOverlay } from './components/LoadingOverlay'
import { SEQUENCER_STYLES } from './components/sequencer/constants'
import { SongMode } from './components/SongMode'

const Studio3D = lazy(() => import('./components/Studio3D').then(module => ({ default: module.Studio3D })));

export const App: React.FC = () => {
    const state = useAppState();

    const {
        is3DMode, setIs3DMode, selectedTrack, setSelectedTrack,
        pattern, activeSamplerBank, activeTrackSlots, trackStorage,
        selection, isDrawing, handleStepToggle, handleRightMouseDown,
        handleEditLength, handleSelectRow, handleTrackSlotClick,
        handleSelectionStart, handleSelectionEnter, handleDrawEnter,
        viewMode, automationParam, handleAutomationChange,
        activeAlignment, melodicMode, handlePitchChange, handlePhonemeUpdate,
        sampleBuffers, isSongModeOpen, songStructure, currentSongMeasure,
        backgroundImage, setBackgroundImage, handleSongModeToggle,
        handleSongStructureUpdate, handleAddMeasure, handleRemoveMeasure,
        handleExportXM, isSongModeActive, setIsSongModeActive,
        contextMenu, setContextMenu, handleNoteSelect, handleNoteLengthChange,
        handleNotePropertyChange, currentScale,
        handleKeyboardPlay, handleKeyboardStop,
        synthAControls, synthBControls, bass2Controls, kickControls,
        snareControls, closedHatControls, openHatControls, samplerControls,
        onSynthAParamChange, onSynthBParamChange, onBass2ParamChange,
        handleKickChange, handleSnareChange, handleClosedHatChange,
        handleOpenHatChange, handleSamplerChange,
        synthAChild, synthBChild, bass2Child, samplerChild,
        samplerVoiceParams, handleSamplerVoiceChange, harmonizerConfig,
        handleHarmonizerConfigChange, isHarmonizeActive,
        toast, setToast, hasStarted, handleStart, isPyodideReady, isInitialized,
        isImportingAISong, aiImportStage, aiImportProgress, aiImportError,
        setIsImportingAISong, setAiImportStage, setAiImportProgress, showToast,
        isCloudLibraryOpen, setIsCloudLibraryOpen, loadCloudData,
        getSongData, getBankData, getPatternData,
        isAISongModalOpen, setIsAISongModalOpen, handleAISongImport,
        isRbsImportModalOpen, setIsRbsImportModalOpen, handleRbsImport,
        isVoiceEditorOpen, setIsVoiceEditorOpen,
        isShortcutsHelpOpen, setIsShortcutsHelpOpen,
        showGamepadDebug, setShowGamepadDebug,
        isLyricTrackVisible, setIsLyricTrackVisible, ttsPhrases,
        isGenerating, handleLyricApply,
        tempo, isRecording, isPlaying,
        setIsRecording, setIsSongModeOpen,
        songStorage, activeSongSlot, loadSong, handleSaveSong,
        handleClearPattern, handleTempoHoldStart, handleTempoHoldEnd,
        handleTempoKeyDown, handlePanic, handlePlayToggle,
        setCurrentScale,
        handleAutoMix, reverbType, handleReverbType,
        masterSaturation, handleMasterSaturation, handleMasterSaturationKeyDown,
        handleMasterSaturationReset, masterVolume, handleMasterVolume,
        handleMasterVolumeKeyDown, handleMasterVolumeReset,
        globalPan, handleGlobalPan, handleGlobalPanKeyDown, handleGlobalPanReset,
        audioEngine, forceScriptProcessorFallback, setForceScriptProcessorFallback,
        setViewMode, setAutomationParam, exportSongToFile, importSongFromFile,
    } = state;

    if (is3DMode) {
        return (
            <Suspense fallback={<div className="flex items-center justify-center h-screen w-screen bg-black text-cyan-400 font-orbitron text-xl tracking-widest animate-pulse">LOADING 3D STUDIO...</div>}>
                <Studio3D
                    header={<TransportHeader />}
                    sequencer={<SequencerNode />}
                    keyboard={<KeyboardNode />}
                    rack={<RackNode />}
                    onExit={() => setIs3DMode(false)}
                />
            </Suspense>
        )
    }

    return (
        <div className="flex flex-col h-screen w-screen bg-gradient-to-br from-[#050709] via-[#080a0b] to-[#0a0c0f] text-gray-200 overflow-hidden font-sans relative bg-cover bg-center" style={{ backgroundImage: backgroundImage ? `url(${backgroundImage})` : undefined }}>
            <style>{SEQUENCER_STYLES}</style>
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
            {backgroundImage && <div className="absolute inset-0 bg-black/60 pointer-events-none z-0"></div>}
            {!hasStarted && <StartOverlay onStart={handleStart} isReady={isPyodideReady} />}
            <LoadingOverlay isVisible={hasStarted && !isInitialized} />


            <AISongImportOverlay
                isImportingAISong={isImportingAISong}
                aiImportStage={aiImportStage}
                aiImportProgress={aiImportProgress}
                aiImportError={aiImportError}
                setIsImportingAISong={setIsImportingAISong}
                setAiImportStage={setAiImportStage}
                setAiImportProgress={setAiImportProgress}
                showToast={showToast}
            />

            <CloudLibrary isOpen={isCloudLibraryOpen} onClose={() => setIsCloudLibraryOpen(false)} onLoadData={loadCloudData} onShowToast={showToast} getSongData={getSongData} getBankData={getBankData} getPatternData={getPatternData} />
            <AISongModal isOpen={isAISongModalOpen} onClose={() => setIsAISongModalOpen(false)} onImport={handleAISongImport} onShowToast={showToast} isImporting={isImportingAISong} />
            <RbsImportModal isOpen={isRbsImportModalOpen} onClose={() => setIsRbsImportModalOpen(false)} onImport={handleRbsImport} onShowToast={showToast} />
            {isVoiceEditorOpen && (<VoiceEditor onClose={() => setIsVoiceEditorOpen(false)} />)}
            {isShortcutsHelpOpen && (<ShortcutsHelp onClose={() => setIsShortcutsHelpOpen(false)} />)}
            {showGamepadDebug && (<GamepadDebugger onClose={() => setShowGamepadDebug(false)} />)}

            <TransportHeader />

            <SongMode isVisible={isSongModeOpen} songStructure={songStructure} currentSongStep={currentSongMeasure} backgroundImage={backgroundImage} onSetBackgroundImage={setBackgroundImage} onToggle={handleSongModeToggle} onUpdateStep={handleSongStructureUpdate} onAddMeasure={handleAddMeasure} onRemoveMeasure={handleRemoveMeasure} onExportXM={handleExportXM} isSongModeActive={isSongModeActive} onSetIsSongModeActive={setIsSongModeActive} />

            <LyricTrack
                isVisible={isLyricTrackVisible}
                initialText={ttsPhrases[activeSamplerBank] || ""}
                isGenerating={isGenerating}
                onApply={handleLyricApply}
                onClose={() => setIsLyricTrackVisible(false)}
            />

            <main className="flex-1 relative bg-gradient-to-b from-[#0a0e14] via-[#111827] to-[#050709] shadow-inner flex flex-col justify-start z-10 overflow-y-auto pb-12">
                <div className="w-full max-w-[1000px] mx-auto h-[440px] shrink-0 pt-6">
                    <SequencerNode />
                </div>
                <ContextMenuNode />

                <div className="w-full max-w-[1000px] mx-auto shrink-0 mt-2 px-4">
                    <div className="h-[380px] rounded-xl overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.6)] border border-cyan-500/20">
                        <RackNode />
                    </div>
                </div>

                <div className="shrink-0 py-4 mt-2 max-w-[1000px] mx-auto w-full px-4">
                    <KeyboardNode />
                </div>
            </main>

            <BottomBar
                viewMode={viewMode}
                setViewMode={setViewMode}
                automationParam={automationParam}
                setAutomationParam={setAutomationParam}
                isLyricTrackVisible={isLyricTrackVisible}
                setIsLyricTrackVisible={setIsLyricTrackVisible}
                isImportingAISong={isImportingAISong}
                aiImportStage={aiImportStage}
                aiImportProgress={aiImportProgress}
                exportSongToFile={exportSongToFile}
                importSongFromFile={importSongFromFile}
                setIsRbsImportModalOpen={setIsRbsImportModalOpen}
                setIsAISongModalOpen={setIsAISongModalOpen}
                setIsCloudLibraryOpen={setIsCloudLibraryOpen}
                handleAutoMix={handleAutoMix}
                reverbType={reverbType}
                handleReverbType={handleReverbType}
                masterSaturation={masterSaturation}
                handleMasterSaturation={handleMasterSaturation}
                handleMasterSaturationKeyDown={handleMasterSaturationKeyDown}
                handleMasterSaturationReset={handleMasterSaturationReset}
                masterVolume={masterVolume}
                handleMasterVolume={handleMasterVolume}
                handleMasterVolumeKeyDown={handleMasterVolumeKeyDown}
                handleMasterVolumeReset={handleMasterVolumeReset}
                globalPan={globalPan}
                handleGlobalPan={handleGlobalPan}
                handleGlobalPanKeyDown={handleGlobalPanKeyDown}
                handleGlobalPanReset={handleGlobalPanReset}
                audioEngine={audioEngine}
                forceScriptProcessorFallback={forceScriptProcessorFallback}
                setForceScriptProcessorFallback={setForceScriptProcessorFallback}
                showToast={showToast}
                setShowGamepadDebug={setShowGamepadDebug}
                setIsShortcutsHelpOpen={setIsShortcutsHelpOpen}
            />
        </div>
    )
}

export default App
