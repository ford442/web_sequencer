import React, { memo, useCallback } from 'react'
import type { AiImportStage } from '../hooks/useSongStorage'
import type { ReverbType } from '../types'

interface BottomBarProps {
    viewMode: 'notes' | 'automation'
    setViewMode: React.Dispatch<React.SetStateAction<'notes' | 'automation'>>
    automationParam: string
    setAutomationParam: React.Dispatch<React.SetStateAction<string>>
    isLyricTrackVisible: boolean
    setIsLyricTrackVisible: React.Dispatch<React.SetStateAction<boolean>>
    isImportingAISong: boolean
    aiImportStage: AiImportStage
    aiImportProgress: number
    exportSongToFile: () => Promise<void>
    importSongFromFile: () => void
    setIsRbsImportModalOpen: React.Dispatch<React.SetStateAction<boolean>>
    setIsAISongModalOpen: React.Dispatch<React.SetStateAction<boolean>>
    setIsCloudLibraryOpen: React.Dispatch<React.SetStateAction<boolean>>
    handleAutoMix: () => void
    reverbType: ReverbType
    handleReverbType: (e: React.ChangeEvent<HTMLSelectElement>) => void
    masterSaturation: number
    handleMasterSaturation: (e: React.ChangeEvent<HTMLInputElement>) => void
    handleMasterSaturationKeyDown: (e: React.KeyboardEvent) => void
    handleMasterSaturationReset: () => void
    masterVolume: number
    handleMasterVolume: (e: React.ChangeEvent<HTMLInputElement>) => void
    handleMasterVolumeKeyDown: (e: React.KeyboardEvent) => void
    handleMasterVolumeReset: () => void
    globalPan: number
    handleGlobalPan: (e: React.ChangeEvent<HTMLInputElement>) => void
    handleGlobalPanKeyDown: (e: React.KeyboardEvent) => void
    handleGlobalPanReset: () => void
    audioEngine: any
    forceScriptProcessorFallback: boolean
    setForceScriptProcessorFallback: React.Dispatch<React.SetStateAction<boolean>>
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void
    setShowGamepadDebug: React.Dispatch<React.SetStateAction<boolean>>
    setIsShortcutsHelpOpen: React.Dispatch<React.SetStateAction<boolean>>
}

export const BottomBar = memo(function BottomBar({
    viewMode,
    setViewMode,
    automationParam,
    setAutomationParam,
    isLyricTrackVisible,
    setIsLyricTrackVisible,
    isImportingAISong,
    aiImportStage,
    aiImportProgress,
    exportSongToFile,
    importSongFromFile,
    setIsRbsImportModalOpen,
    setIsAISongModalOpen,
    setIsCloudLibraryOpen,
    handleAutoMix,
    reverbType,
    handleReverbType,
    masterSaturation,
    handleMasterSaturation,
    handleMasterSaturationKeyDown,
    handleMasterSaturationReset,
    masterVolume,
    handleMasterVolume,
    handleMasterVolumeKeyDown,
    handleMasterVolumeReset,
    globalPan,
    handleGlobalPan,
    handleGlobalPanKeyDown,
    handleGlobalPanReset,
    audioEngine,
    forceScriptProcessorFallback,
    setForceScriptProcessorFallback,
    showToast,
    setShowGamepadDebug,
    setIsShortcutsHelpOpen,
}: BottomBarProps) {
    const handleAudioWorkletToggle = useCallback(() => {
        const newValue = !forceScriptProcessorFallback;
        setForceScriptProcessorFallback(newValue);
        localStorage.setItem('forceScriptProcessorFallback', String(newValue));
        showToast(
            newValue
                ? "ScriptProcessor fallback enabled. Refresh to apply."
                : "AudioWorklet mode enabled. Refresh to apply.",
            'success'
        );
    }, [forceScriptProcessorFallback, setForceScriptProcessorFallback, showToast]);

    return (
        <div className="fixed bottom-0 left-0 right-0 h-10 bg-gradient-to-r from-[#0a0c10] via-[#0d1014] to-[#0a0c10] backdrop-blur-md border-t border-cyan-900/30 z-40 flex items-center justify-between px-4 shadow-[0_-4px_20px_rgba(0,0,0,0.5)]">
            {/* Left: View Controls */}
            <div className="flex items-center gap-2">
                {/* Notes/Automation Toggle */}
                <div className="flex items-center bg-zinc-950 rounded-md border border-zinc-800 overflow-hidden" role="group" aria-label="Sequencer view mode">
                    <button
                        onClick={() => setViewMode('notes')}
                        aria-pressed={viewMode === 'notes'}
                        aria-label="Notes View"
                        title="Notes View"
                        className={`px-2.5 py-1 text-[10px] font-bold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded ${viewMode === 'notes' ? 'bg-cyan-600 text-white hover:scale-105 active:scale-95' : 'text-gray-500 hover:text-gray-300 hover:scale-105 active:scale-95'}`}
                    >
                        NOTES
                    </button>
                    <button
                        onClick={() => setViewMode('automation')}
                        aria-pressed={viewMode === 'automation'}
                        aria-label="Automation View"
                        title="Automation View"
                        className={`px-2.5 py-1 text-[10px] font-bold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded ${viewMode === 'automation' ? 'bg-pink-600 text-white hover:scale-105 active:scale-95' : 'text-gray-500 hover:text-gray-300 hover:scale-105 active:scale-95'}`}
                    >
                        AUTO
                    </button>
                </div>

                {viewMode === 'automation' && (
                    <select
                        value={automationParam}
                        onChange={(e) => setAutomationParam(e.target.value)}
                        aria-label="Automation Parameter"
                        title="Automation Parameter"
                        className="bg-zinc-950 text-[10px] text-gray-300 border border-zinc-800 px-1.5 py-1 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded"
                    >
                        <option value="formantShift">Formant</option>
                        <option value="vibratoDepth">Vibrato</option>
                        <option value="chordInversion">Chord Inversion</option>
                    </select>
                )}

                <div className="w-px h-4 bg-gray-700 mx-1" />

                {/* LYRICS Button */}
                <button 
                    onClick={() => setIsLyricTrackVisible(!isLyricTrackVisible)}
                    aria-pressed={isLyricTrackVisible}
                    aria-label="Toggle Global Lyric Track"
                    title="Toggle Global Lyric Track"
                    className={`h-6 px-2.5 rounded-md font-orbitron text-[10px] font-bold tracking-wide transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] hover:scale-105 active:scale-95 ${isLyricTrackVisible ? 'bg-cyan-600 text-white shadow-[0_0_8px_rgba(6,182,212,0.5)]' : 'bg-zinc-800 text-cyan-400 border border-zinc-700 hover:bg-zinc-700'}`}
                >
                    LYRICS
                </button>
            </div>

            {/* Center: File Operations */}
            <div className="flex items-center gap-1.5">
                <button 
                    onClick={exportSongToFile} 
                    disabled={isImportingAISong}
                    aria-label="Save project to JSON"
                    className={`h-6 px-2 text-[10px] font-bold text-green-400 bg-zinc-900 border border-green-900/50 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded ${isImportingAISong ? 'opacity-50 cursor-not-allowed' : 'hover:bg-green-950/30 hover:scale-105 active:scale-95'}`}
                    title="Save to JSON"
                >
                    💾 SAVE
                </button>
                <button 
                    onClick={importSongFromFile} 
                    disabled={isImportingAISong}
                    aria-label="Load project from JSON"
                    className={`h-6 px-2 text-[10px] font-bold text-blue-400 bg-zinc-900 border border-blue-900/50 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded ${isImportingAISong ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-950/30 hover:scale-105 active:scale-95'}`}
                    title="Load from JSON"
                >
                    📂 LOAD
                </button>
                <button 
                    onClick={() => setIsRbsImportModalOpen(true)}
                    disabled={isImportingAISong}
                    aria-label="Import ReBirth RB-338 .rbs file"
                    className={`h-6 px-2 text-[10px] font-bold text-amber-400 bg-zinc-900 border border-amber-900/50 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded ${isImportingAISong ? 'opacity-50 cursor-not-allowed' : 'hover:bg-amber-950/30 hover:scale-105 active:scale-95'}`}
                    title="Import ReBirth RB-338 file"
                >
                    🎹 Import .rbs File...
                </button>
                <button 
                    onClick={() => !isImportingAISong && setIsAISongModalOpen(true)}
                    disabled={isImportingAISong}
                    className={`h-6 px-2 text-[10px] font-bold bg-zinc-900 border min-w-[130px] transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded ${
                        isImportingAISong 
                            ? 'text-yellow-400 border-yellow-900/50 cursor-wait' 
                            : 'text-emerald-400 border-emerald-900/50 hover:bg-emerald-950/30 hover:scale-105 active:scale-95'
                    }`}
                    title={isImportingAISong 
                        ? `Importing: ${aiImportStage || 'processing'}... ${aiImportProgress}%` 
                        : "Import AI-generated song (Claude, Gemini, Jules, Copilot)"
                    }
                    aria-label={isImportingAISong ? "Importing AI song" : "Import AI-generated song"}
                >
                    {isImportingAISong ? (
                        <span className="flex items-center gap-1">
                            <span className="animate-spin" aria-hidden="true">⏳</span>
                            <span>{aiImportStage === 'parsing' && 'Parsing...'}
                            {aiImportStage === 'validating' && 'Validating...'}
                            {aiImportStage === 'converting' && 'Converting...'}
                            {aiImportStage === 'uploading' && 'Uploading...'}
                            {aiImportStage === 'loading' && 'Loading...'}
                            {aiImportStage === 'complete' && 'Done!'}
                            {aiImportStage === 'error' && 'Failed'}
                            {!aiImportStage && 'Processing...'} {aiImportProgress}%</span>
                        </span>
                    ) : (
                        <span><span aria-hidden="true">🤖</span> Import AI Song</span>
                    )}
                </button>
                <button
                    onClick={() => setIsCloudLibraryOpen(true)}
                    disabled={isImportingAISong}
                    className={`h-6 px-2 text-[10px] font-bold text-purple-400 bg-zinc-900 border border-purple-900/50 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded ${isImportingAISong ? 'opacity-50 cursor-not-allowed' : 'hover:bg-purple-950/30 hover:scale-105 active:scale-95'}`}
                    title={isImportingAISong ? "Importing AI song..." : "Cloud Library"}
                    aria-label="Open Cloud Library"
                >
                    <span aria-hidden="true">☁️</span> CLOUD
                </button>
            </div>

            {/* Right: Utility Toggles */}
            <div className="flex items-center gap-2">
                <div className="flex flex-col items-center justify-center gap-1 min-w-[60px]">
                    <button
                        type="button"
                        onClick={handleAutoMix}
                        className="bg-zinc-800 text-xs text-yellow-400 font-bold font-orbitron px-2 py-0.5 border border-yellow-500/50 hover:bg-yellow-900/50 hover:border-yellow-400 shadow-[0_0_5px_rgba(250,204,21,0.2)] transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded hover:scale-105 active:scale-95"
                        title="Auto-Mix Assistant (AI Panning & Leveling)"
                        aria-label="Auto-Mix Assistant"
                    >
                        <span aria-hidden="true">✨</span> AUTO-MIX
                    </button>
                </div>
                <div className="flex flex-col items-center justify-center gap-1 min-w-[60px]">
                    <select
                        value={reverbType} onChange={handleReverbType}
                        className="bg-zinc-800 text-xs text-gray-300 px-1 py-0.5 border border-gray-700 cursor-pointer uppercase transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded"
                        title="Master Reverb Type"
                        aria-label="Master Reverb Type"
                    >
                        <option value="room">Room</option>
                        <option value="plate">Plate</option>
                        <option value="hall">Hall</option>
                    </select>
                </div>
                <div className="flex flex-col items-center justify-center gap-1 min-w-[60px]">
                    <input
                        type="range" min="0" max="1" step="0.01"
                        value={masterSaturation} onChange={handleMasterSaturation} onKeyDown={handleMasterSaturationKeyDown} onDoubleClick={handleMasterSaturationReset}
                        className="w-16 h-1 bg-zinc-800 appearance-none cursor-pointer transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded-lg"
                        aria-label="Master Saturation"
                        title={`Warmth: ${Math.round(masterSaturation * 100)}%`}
                        aria-valuetext={`${Math.round(masterSaturation * 100)}%`}
                    />
                </div>
                <div className="flex flex-col items-center justify-center gap-1 min-w-[60px]">
                    <input
                        type="range" min="0" max="1.5" step="0.01"
                        value={masterVolume} onChange={handleMasterVolume} onKeyDown={handleMasterVolumeKeyDown} onDoubleClick={handleMasterVolumeReset}
                        className="w-16 h-1 bg-zinc-800 appearance-none cursor-pointer transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded-lg"
                        aria-label="Master Volume"
                        title={`Volume: ${Math.round(masterVolume * 100)}%`}
                        aria-valuetext={`${Math.round(masterVolume * 100)}%`}
                    />
                </div>
                <div className="flex flex-col items-center justify-center gap-1 min-w-[60px]">
                    <input
                        type="range" min="-1" max="1" step="0.01"
                        value={globalPan} onChange={handleGlobalPan} onKeyDown={handleGlobalPanKeyDown} onDoubleClick={handleGlobalPanReset}
                        className="w-16 h-1 bg-zinc-800 appearance-none cursor-pointer transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded-lg"
                        aria-label="Global Pan"
                        title={`Pan: ${globalPan === 0 ? 'Center' : globalPan < 0 ? Math.round(Math.abs(globalPan) * 100) + '% L' : Math.round(globalPan * 100) + '% R'}`}
                        aria-valuetext={`${globalPan === 0 ? 'Center' : globalPan < 0 ? Math.round(Math.abs(globalPan) * 100) + '% Left' : Math.round(globalPan * 100) + '% Right'}`}
                    />
                </div>

                <div className="w-px h-4 bg-gray-700 mx-1" />

                {/* Tape Stop Button */}
                <button
                    onClick={() => audioEngine?.triggerTapeStop?.(2.0)}
                    className="h-6 px-2 bg-amber-900/80 hover:bg-amber-800 text-amber-200 hover:text-amber-100 border border-amber-700 text-[10px] font-bold uppercase tracking-wider transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded hover:scale-105 active:scale-95"
                    title="Tape Stop (Escape)"
                    aria-label="Trigger Tape Stop Effect"
                >
                    Tape Stop
                </button>

                <div className="w-px h-4 bg-gray-700 mx-1" />

                {/* Gamepad Toggle */}
                <button
                    onClick={() => setShowGamepadDebug(true)}
                    className="h-6 w-6 bg-zinc-800 hover:bg-zinc-700 text-slate-400 hover:text-slate-200 border border-zinc-700 flex items-center justify-center transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded hover:scale-105 active:scale-95"
                    title="Gamepad Debugger"
                    aria-label="Open Gamepad Debugger"
                >
                    <span className="text-xs" aria-hidden="true">🎮</span>
                </button>

                {/* AudioWorklet Fallback Toggle */}
                <button
                    onClick={handleAudioWorkletToggle}
                    className={`h-6 px-2 text-[10px] font-mono border transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded hover:scale-105 active:scale-95 ${forceScriptProcessorFallback ? 'bg-yellow-900/30 text-yellow-400 border-yellow-900/50' : 'bg-zinc-800 text-gray-500 border-zinc-700'}`}
                    title={forceScriptProcessorFallback ? "Using ScriptProcessor fallback" : "Using AudioWorklet"}
                    aria-pressed={forceScriptProcessorFallback}
                    aria-label={forceScriptProcessorFallback ? "Disable ScriptProcessor fallback" : "Enable ScriptProcessor fallback"}
                >
                    {forceScriptProcessorFallback ? <><span aria-hidden="true">⚠️</span> AW</> : <><span aria-hidden="true">🔊</span> AW</>}
                </button>

                <div className="w-px h-4 bg-gray-700 mx-1" />

                {/* Help Button */}
                <button
                    onClick={() => setIsShortcutsHelpOpen(true)}
                    className="h-6 w-6 bg-zinc-800 text-gray-400 hover:text-white hover:bg-zinc-700 border border-zinc-600 flex items-center justify-center font-bold text-xs transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded hover:scale-105 active:scale-95"
                    aria-label="Keyboard Shortcuts"
                    title="Keyboard Shortcuts (?)"
                >
                    ?
                </button>
            </div>
        </div>
    );
});
