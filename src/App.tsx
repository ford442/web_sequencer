import { lazy, Suspense, useEffect } from 'react'
import { useAppStateContext } from './contexts/AppStateContext'

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
import { ExportModal } from './components/ExportModal'
import { VoiceEditor } from './components/VoiceEditor'
import { ShortcutsHelp } from './components/ShortcutsHelp'
import { helpDiscoveryStore, useHelpDiscoveryStore } from './stores/helpDiscoveryStore'
import { WhatsNewBanner } from './components/help/WhatsNewBanner'
import { MidiMapPanel } from './components/MidiMapPanel'
import { GamepadDebugger } from './components/GamepadDebugger'
import { LyricTrack } from './components/LyricTrack'
import { Toast } from './components/Toast'
import { StartOverlay } from './components/StartOverlay'
import { LoadingOverlay } from './components/LoadingOverlay'
import { SEQUENCER_STYLES } from './components/sequencer/constants'
import { SongMode } from './components/SongMode'
import { MobileTransportDock } from './components/MobileTransportDock'
import { MasterLoudnessMeter } from './components/MasterLoudnessMeter'
import { EngineDegradationBanner } from './components/EngineDegradationBanner'
import { A11yAnnouncer } from './components/A11yAnnouncer'
import { useCompactLayoutContext } from './contexts/CompactLayoutContext'
import { engineDegradationStore } from './stores/engineDegradationStore'
import { midiMapStore, useMidiMapStore } from './stores/midiMapStore'
import { useA11yPlaybackAnnouncements } from './hooks/useA11yPlaybackAnnouncements'
import { useSurfaceTexture } from './hooks/useSurfaceTexture'
import { VisualStyleShowcase } from './components/ui/VisualStyleShowcase'

const Studio3D = lazy(() => import('./components/Studio3D').then(module => ({ default: module.Studio3D })));

export const App: React.FC = () => {
    const state = useAppStateContext();

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
        handleSongStructureUpdate, handleEditSongStructure, handleAddMeasure, handleRemoveMeasure,
        handleExportXM, isSongModeActive, setIsSongModeActive,
        undoSongStructure, redoSongStructure, canUndoSong, canRedoSong,
        contextMenu, setContextMenu, handleNoteSelect, handleNoteLengthChange,
        handleNotePropertyChange, currentScale,
        handleKeyboardPlay, handleKeyboardStop, handleDrumPadPlay,
        synthAControls, synthBControls, bass2Controls, kickControls,
        snareControls, closedHatControls, openHatControls, samplerControls,
        onSynthAParamChange, onSynthBParamChange, onBass2ParamChange,
        handleKickChange, handleSnareChange, handleClosedHatChange,
        handleOpenHatChange, handleSamplerChange,
        synthAChild, synthBChild, bass2Child, samplerChild,
        samplerVoiceParams, handleSamplerVoiceChange, harmonizerConfig,
        handleHarmonizerConfigChange, isHarmonizeActive,
        toast, setToast, hasStarted, handleStart, isPyodideReady, pyodideStatus, isInitialized,
        isImportingAISong, aiImportStage, aiImportProgress, aiImportError,
        setIsImportingAISong, setAiImportStage, setAiImportProgress, showToast,
        isCloudLibraryOpen, setIsCloudLibraryOpen, loadCloudData,
        getSongData, getBankData, getPatternData,
        isAISongModalOpen, setIsAISongModalOpen, handleAISongImport,
        isRbsImportModalOpen, setIsRbsImportModalOpen, handleRbsImport,
        isExportModalOpen, setIsExportModalOpen,
        synthA, synthB, bass2, kick, snare, closedHat, openHat, sampler, pyodide,
        isVoiceEditorOpen, setIsVoiceEditorOpen,
        isShortcutsHelpOpen, setIsShortcutsHelpOpen,
        showGamepadDebug, setShowGamepadDebug,
        isLyricTrackVisible, setIsLyricTrackVisible, ttsPhrases,
        isGenerating, handleLyricApply,
        tempo, isRecording, isPlaying,
        isAutomationRecording, setIsAutomationRecording,
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
        setViewMode, setAutomationParam, exportSongToFile, exportRbsToFile, importSongFromFile,
    } = state;

    const { isCompact, toggleCompact } = useCompactLayoutContext();
    const { panelOpen: isMidiMapPanelOpen } = useMidiMapStore();
    const { helpOpen } = useHelpDiscoveryStore();
    const showHelpModal = isShortcutsHelpOpen || helpOpen;
    const closeHelpModal = () => {
        setIsShortcutsHelpOpen(false);
        helpDiscoveryStore.closeHelp();
    };

    useA11yPlaybackAnnouncements({
        isPlaying,
        isAutomationRecording,
        selectedTrack,
        activeTrackSlots,
        viewMode,
        automationParam,
        isSongModeActive,
        currentSongMeasure,
    });

    useEffect(() => {
        engineDegradationStore.setToastHandler((message, type) => {
            showToast(message, type === 'error' ? 'error' : 'info');
        });
        return () => engineDegradationStore.setToastHandler(null);
    }, [showToast]);

    useSurfaceTexture();

    const showVisualReview = typeof location !== 'undefined'
        && new URLSearchParams(location.search).has('visual-review');

    if (showVisualReview) {
        return <VisualStyleShowcase />;
    }

    if (is3DMode) {
        return (
            <Suspense fallback={<div className="flex items-center justify-center h-screen w-screen bg-black text-cyan-400 font-orbitron text-xl tracking-widest animate-pulse">LOADING 3D STUDIO...</div>}>
                <Studio3D
                    header={<TransportHeader />}
                    sequencer={<SequencerNode />}
                    keyboard={<KeyboardNode selectedTrack={selectedTrack} handleKeyboardPlay={handleKeyboardPlay} handleKeyboardStop={handleKeyboardStop} handleDrumPadPlay={handleDrumPadPlay} />}
                    rack={<RackNode />}
                    onExit={() => setIs3DMode(false)}
                />
            </Suspense>
        )
    }

    return (
        <div className={`flex flex-col h-screen w-screen bg-gradient-to-br from-[#050709] via-[#080a0b] to-[#0a0c0f] text-gray-200 overflow-hidden font-sans relative bg-cover bg-center ${isCompact ? 'hyphon-compact' : ''}`} style={{ backgroundImage: backgroundImage ? `url(${backgroundImage})` : undefined }}>
            <a href="#main-content" className="skip-link">Skip to main content</a>
            <A11yAnnouncer />
            <style>{SEQUENCER_STYLES}</style>
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
            {backgroundImage && <div className="absolute inset-0 bg-black/60 pointer-events-none z-0"></div>}
            {!hasStarted && (
                <StartOverlay
                    onStart={handleStart}
                    isPyodideReady={isPyodideReady}
                    pyodideStatus={pyodideStatus}
                    hasWebGpu={typeof navigator !== 'undefined' && 'gpu' in navigator}
                    hasNativeModule={
                        typeof globalThis !== 'undefined'
                        && !!(globalThis as { Module?: unknown }).Module
                        || !!(globalThis as { hyphonPyodideReady?: boolean }).hyphonPyodideReady
                    }
                />
            )}
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
            <ExportModal
                isOpen={isExportModalOpen}
                onClose={() => setIsExportModalOpen(false)}
                onShowToast={showToast}
                songStructure={songStructure}
                trackStorage={trackStorage}
                currentPattern={pattern}
                tempo={tempo}
                params={{ synthA, synthB, bass2, kick, snare, closedHat, openHat, sampler }}
                engines={{
                    webGpuEngine: audioEngine?.webGpuEngine,
                    wasmEngine: audioEngine?.wasmEngine,
                    pyodide,
                }}
                sampleBuffers={sampleBuffers}
                preferredSampleRate={audioEngine?.context?.sampleRate}
            />
            {isVoiceEditorOpen && (<VoiceEditor onClose={() => setIsVoiceEditorOpen(false)} />)}
            {showHelpModal && (<ShortcutsHelp onClose={closeHelpModal} />)}
            {showGamepadDebug && (<GamepadDebugger onClose={() => setShowGamepadDebug(false)} />)}
            {isMidiMapPanelOpen && (<MidiMapPanel onClose={() => midiMapStore.setPanelOpen(false)} />)}

            <TransportHeader onToggleCompact={toggleCompact} isCompactLayout={isCompact} />

            <EngineDegradationBanner />

            <SongMode isVisible={isSongModeOpen} songStructure={songStructure} currentSongStep={currentSongMeasure} backgroundImage={backgroundImage} onSetBackgroundImage={setBackgroundImage} onToggle={handleSongModeToggle} onUpdateStep={handleSongStructureUpdate} onEditStructure={handleEditSongStructure} onUndoSong={undoSongStructure} onRedoSong={redoSongStructure} canUndoSong={canUndoSong()} canRedoSong={canRedoSong()} onAddMeasure={handleAddMeasure} onRemoveMeasure={handleRemoveMeasure} onExportXM={handleExportXM} isSongModeActive={isSongModeActive} onSetIsSongModeActive={setIsSongModeActive} />

            <MobileTransportDock
                isPlaying={isPlaying}
                isRecording={isRecording}
                tempo={tempo}
                isSongModeOpen={isSongModeOpen}
                onPlayToggle={handlePlayToggle}
                onRecordToggle={() => setIsRecording(!isRecording)}
                onTempoNudgeStart={handleTempoHoldStart}
                onTempoNudgeEnd={handleTempoHoldEnd}
                onSongModeToggle={() => setIsSongModeOpen(!isSongModeOpen)}
                onPanic={handlePanic}
            />

            <LyricTrack
                isVisible={isLyricTrackVisible}
                initialText={ttsPhrases[activeSamplerBank] || ""}
                isGenerating={isGenerating}
                onApply={handleLyricApply}
                onClose={() => setIsLyricTrackVisible(false)}
            />

            <main id="main-content" className={`flex-1 relative bg-gradient-to-b from-[#0a0e14] via-[#111827] to-[#050709] shadow-inner flex flex-col justify-start z-10 overflow-y-auto overscroll-y-contain ${isCompact ? 'pb-28' : 'pb-12'} hyphon-main-scroll`}>
                <WhatsNewBanner />
                <div className={`w-full max-w-[1000px] mx-auto shrink-0 pt-4 sm:pt-6 px-2 sm:px-0 ${isCompact ? 'h-[min(42vh,360px)] min-h-[240px]' : 'h-[440px]'}`}>
                    <SequencerNode />
                </div>
                <ContextMenuNode />

                <div className="w-full max-w-[1000px] mx-auto shrink-0 mt-2 px-2 sm:px-4">
                    <div className={`hyphon-rack-shell overflow-hidden ${isCompact ? 'h-[min(40vh,340px)] min-h-[260px]' : 'h-[380px]'}`}>
                        <RackNode />
                    </div>
                </div>

                {/* Master true-peak limiter + BS.1770 loudness meters, sitting
                    with the rack because it measures the master bus output. */}
                <div className="w-full max-w-[1000px] mx-auto shrink-0 mt-2 px-2 sm:px-4">
                    <MasterLoudnessMeter />
                </div>

                <div className="shrink-0 py-3 sm:py-4 mt-2 max-w-[1000px] mx-auto w-full px-2 sm:px-4">
                    <KeyboardNode selectedTrack={selectedTrack} handleKeyboardPlay={handleKeyboardPlay} handleKeyboardStop={handleKeyboardStop} handleDrumPadPlay={handleDrumPadPlay} />
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
                exportRbsToFile={exportRbsToFile}
                importSongFromFile={importSongFromFile}
                setIsRbsImportModalOpen={setIsRbsImportModalOpen}
                setIsExportModalOpen={setIsExportModalOpen}
                setIsAISongModalOpen={setIsAISongModalOpen}
                setIsCloudLibraryOpen={setIsCloudLibraryOpen}
                isAutomationRecording={isAutomationRecording}
                setIsAutomationRecording={setIsAutomationRecording}
                isPlaying={isPlaying}
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
