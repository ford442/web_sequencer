import React, { memo } from 'react'
import { CloudStatus } from './CloudStatus'
import { ScaleSelector } from './ScaleSelector'
import type { ScaleDefinition } from '../utils/musicTheory'
import type { SongSnapshot } from '../constants/appDefaults'
import { midiMapStore, useMidiMapStore } from '../stores/midiMapStore'

interface TransportToolbarProps {
    songStorage: (SongSnapshot | null)[]
    activeSongSlot: number | null
    tempo: number
    isRecording: boolean
    isPlaying: boolean
    isSongModeOpen: boolean
    is3DMode: boolean
    loadSong: (slot: number) => void
    handleSaveSong: (slot: number) => Promise<void>
    handleClearPattern: () => void
    handleTempoHoldStart: (direction: number) => void
    handleTempoHoldEnd: () => void
    handleTempoKeyDown: (e: React.KeyboardEvent, direction: number) => void
    handlePanic: () => void
    handlePlayToggle: () => void
    setIsRecording: React.Dispatch<React.SetStateAction<boolean>>
    setIsSongModeOpen: React.Dispatch<React.SetStateAction<boolean>>
    setIs3DMode: React.Dispatch<React.SetStateAction<boolean>>
    currentScale: ScaleDefinition | null
    setCurrentScale: (scale: ScaleDefinition | null) => void
    /** Optional always-visible engine status indicator rendered in the left cluster. */
    engineStatus?: React.ReactNode
    /** Toggle compact touch layout (mobile-friendly). */
    onToggleCompact?: () => void
    isCompactLayout?: boolean
}

export const TransportToolbar = memo(function TransportToolbar({
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
    engineStatus,
    onToggleCompact,
    isCompactLayout = false,
}: TransportToolbarProps) {
    const { learnMode, inputAvailable } = useMidiMapStore();

    const handleSongSlotKeyDown = (e: React.KeyboardEvent, slot: number, isSaved: boolean) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (isSaved) loadSong(slot);
            else void handleSaveSong(slot);
            return;
        }
        let next = -1;
        if (e.key === 'ArrowRight') next = (slot + 1) % 4;
        else if (e.key === 'ArrowLeft') next = (slot - 1 + 4) % 4;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = 3;
        if (next !== -1) {
            e.preventDefault();
            (e.currentTarget.parentElement?.querySelector(`[data-song-slot="${next}"]`) as HTMLButtonElement | null)?.focus();
        }
    };

    return (
        <header className="transport-toolbar h-12 flex items-center justify-between px-2 sm:px-4 bg-gradient-to-r from-[#0b0d10] via-[#0d1014] to-[#0b0d10] border-b border-cyan-900/40 shadow-[0_4px_20px_rgba(0,0,0,0.5)] shrink-0 relative backdrop-blur-md w-full z-30">
            {/* Left: Logo + Song Tabs */}
            <div className="flex items-center gap-4">
                <h1 className="text-lg font-bold font-orbitron text-cyan-400 tracking-widest hidden md:block drop-shadow-[0_0_8px_rgba(6,182,212,0.6)]">HYPHON</h1>
                
                {/* Song Slots */}
                <div className="flex items-center gap-1 bg-zinc-950/80 p-1.5 rounded-lg border border-cyan-500/20 shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]" role="group" aria-label="Song slots">
                    <span className="text-[9px] text-gray-600 font-mono uppercase px-1 mr-1">SONG</span>
                    {[0, 1, 2, 3].map(slot => {
                        const isSaved = !!songStorage[slot];
                        const isActive = activeSongSlot === slot;
                        return (
                            <button type="button"
                                key={slot}
                                data-song-slot={slot}
                                onClick={() => { if (isSaved) loadSong(slot); else handleSaveSong(slot); }} 
                                onContextMenu={(e) => { e.preventDefault(); handleSaveSong(slot); }}
                                onKeyDown={(e) => handleSongSlotKeyDown(e, slot, isSaved)}
                                title={`Song Slot ${slot + 1}`}
                                className={`w-7 h-6 text-xs font-mono transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded hover:scale-105 active:scale-95 ${isActive ? 'bg-cyan-500 text-black font-bold shadow-[0_0_10px_rgba(6,182,212,0.6)]' : (isSaved ? 'bg-cyan-900/40 text-cyan-300 border border-cyan-700/50 hover:bg-cyan-800/50' : 'bg-zinc-900 text-zinc-600 border border-zinc-800 hover:border-zinc-700')}`}
                                aria-label={`Song Slot ${slot + 1}`} 
                                aria-pressed={isActive}
                            >
                                {slot + 1}
                            </button>
                        );
                    })}
                </div>

                {/* Cloud Status */}
                <div className="flex items-center gap-2">
                    <CloudStatus />
                </div>

                {/* Engine Status Pills */}
                {engineStatus && (
                    <div className="flex items-center">
                        {engineStatus}
                    </div>
                )}
            </div>

            {/* Center: Transport Controls (desktop / tablet) */}
            <div className="hidden sm:flex items-center gap-3">
                {/* Play/Stop Button */}
                <button type="button"
                    onClick={handlePlayToggle}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handlePlayToggle();
                        }
                    }}
                    aria-pressed={isPlaying}
                    aria-label={isPlaying ? "Stop Playback" : "Start Playback"}
                    title={isPlaying ? "Stop Playback (Space)" : "Start Playback (Space)"}
                    className={`h-8 px-5 font-orbitron text-sm font-bold tracking-wider transition-all duration-150 shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded-md hover:scale-105 active:scale-95 ${isPlaying ? 'bg-red-600 hover:bg-red-500 text-white shadow-[0_0_15px_rgba(220,38,38,0.5)] border border-red-400' : 'bg-green-600 hover:bg-green-500 text-white shadow-[0_0_15px_rgba(22,163,74,0.4)] border border-green-400'}`}
                >
                    {isPlaying ? '■ STOP' : '▶ PLAY'}
                </button>

                {/* Record Button */}
                <button type="button"
                    onClick={() => setIsRecording(!isRecording)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setIsRecording(!isRecording);
                        }
                    }}
                    aria-pressed={isRecording} 
                    aria-label="Toggle Recording" 
                    title={isRecording ? "Stop Recording" : "Toggle Recording"}
                    className={`h-8 w-10 font-orbitron text-xs font-bold tracking-wide transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded-md hover:scale-105 active:scale-95 ${isRecording ? 'bg-red-600 text-white animate-pulse shadow-[0_0_15px_rgba(220,38,38,0.6)] border border-red-400' : 'bg-zinc-800 hover:bg-zinc-700 text-red-500 border border-zinc-700 hover:border-red-900/50'}`}
                >
                    REC
                </button>

                {/* Divider */}
                <div className="w-px h-5 bg-gray-700 mx-1" />

                {/* BPM Control */}
                <div className="flex items-center gap-1.5">
                    <span className="text-[9px] text-gray-500 font-mono uppercase tracking-wider">BPM</span>
                    <div className="flex items-center bg-zinc-950 rounded-md border border-zinc-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]">
                        <button type="button"
                            onMouseDown={() => handleTempoHoldStart(-1)}
                            onMouseUp={handleTempoHoldEnd}
                            onMouseLeave={handleTempoHoldEnd}
                            onKeyDown={(e) => handleTempoKeyDown(e, -1)}
                            className="w-6 h-7 text-cyan-500 hover:text-cyan-400 font-bold text-sm border-r border-zinc-800 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded-l-md hover:bg-zinc-900/50 hover:scale-105 active:scale-95"
                            title="Decrease Tempo"
                            aria-label="Decrease Tempo"
                        >
                            −
                        </button>
                        <span 
                            className="w-12 text-center font-mono text-cyan-300 text-sm font-semibold" 
                            role="status" 
                            aria-live="polite" 
                            aria-label={`Tempo: ${tempo} BPM`}
                        >
                            {tempo}
                        </span>
                        <button type="button"
                            onMouseDown={() => handleTempoHoldStart(1)}
                            onMouseUp={handleTempoHoldEnd}
                            onMouseLeave={handleTempoHoldEnd}
                            onKeyDown={(e) => handleTempoKeyDown(e, 1)}
                            className="w-6 h-7 text-cyan-500 hover:text-cyan-400 font-bold text-sm border-l border-zinc-800 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded-r-md hover:bg-zinc-900/50 hover:scale-105 active:scale-95"
                            title="Increase Tempo"
                            aria-label="Increase Tempo"
                        >
                            +
                        </button>
                    </div>
                </div>

                {/* Divider */}
                <div className="w-px h-5 bg-gray-700 mx-1" />

                {/* Key Lock / Scale Selector */}
                <ScaleSelector currentScale={currentScale} onChange={setCurrentScale} />

                <div className="w-px h-5 bg-gray-700 mx-1" />

                <button
                    type="button"
                    onClick={() => midiMapStore.toggleLearnMode()}
                    aria-pressed={learnMode}
                    aria-label="Toggle MIDI Learn"
                    title={learnMode ? 'MIDI Learn ON — touch a control, then move a controller knob' : 'MIDI Learn — map controller knobs to parameters'}
                    className={`h-7 px-2 font-orbitron text-[9px] font-bold tracking-wide transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 rounded-md ${
                        learnMode
                            ? 'bg-purple-600 text-white animate-pulse border border-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.5)]'
                            : 'bg-zinc-800 text-purple-400 border border-zinc-700 hover:bg-purple-950/40'
                    }`}
                >
                    MIDI{inputAvailable ? '' : ' ○'}
                </button>
                <button
                    type="button"
                    onClick={() => midiMapStore.setPanelOpen(true)}
                    aria-label="Open MIDI Map"
                    title="View / clear MIDI mappings"
                    className="h-7 px-2 text-[9px] font-bold text-purple-300 bg-zinc-900 border border-purple-900/50 rounded-md hover:bg-purple-950/40"
                >
                    MAP
                </button>
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
                {onToggleCompact && (
                    <button
                        type="button"
                        onClick={onToggleCompact}
                        aria-pressed={isCompactLayout}
                        aria-label={isCompactLayout ? 'Switch to comfortable layout' : 'Switch to compact touch layout'}
                        title={isCompactLayout ? 'Comfortable layout' : 'Compact touch layout'}
                        className={`h-8 min-w-[2.5rem] px-2 text-[10px] font-bold border rounded-md touch-manipulation focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${
                            isCompactLayout
                                ? 'bg-cyan-900/50 text-cyan-200 border-cyan-600'
                                : 'bg-zinc-900 text-gray-400 border-zinc-700'
                        }`}
                    >
                        {isCompactLayout ? 'CMP' : 'FIT'}
                    </button>
                )}
                {/* Clear Button */}
                <button type="button"
                    onClick={handleClearPattern} 
                    className="h-7 px-3 text-xs font-bold text-red-400 border border-red-900/50 bg-gradient-to-r from-red-950/30 to-red-900/20 hover:bg-red-900/30 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded-md hover:scale-105 active:scale-95"
                    aria-label="Clear Current Pattern" 
                    title="Clear Current Pattern"
                >
                    CLEAR
                </button>

                {/* Divider */}
                <div className="w-px h-5 bg-gray-700 mx-1" />

                {/* Song Mode Toggle */}
                <button type="button"
                    onClick={() => setIsSongModeOpen(!isSongModeOpen)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setIsSongModeOpen(!isSongModeOpen);
                        }
                    }}
                    aria-pressed={isSongModeOpen} 
                    aria-label="Toggle Song Mode" 
                    title={isSongModeOpen ? "Close Song Mode" : "Open Song Mode"}
                    className={`h-7 px-3 font-orbitron text-xs font-bold tracking-wide transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded-md hover:scale-105 active:scale-95 ${isSongModeOpen ? 'bg-purple-600 text-white shadow-[0_0_10px_rgba(147,51,234,0.5)] border border-purple-400' : 'bg-zinc-800 text-gray-400 border border-zinc-700 hover:bg-zinc-700 hover:text-gray-300'}`}
                >
                    SONG
                </button>

                {/* 3D Toggle */}
                <button type="button"
                    onClick={() => setIs3DMode(!is3DMode)}
                    aria-pressed={is3DMode}
                    aria-label="Toggle 3D Studio View"
                    title={is3DMode ? "Exit 3D Studio" : "Enter 3D Studio"}
                    className={`h-7 w-8 font-orbitron text-xs font-bold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded-md hover:scale-105 active:scale-95 ${is3DMode ? 'bg-cyan-600 text-white border border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.5)]' : 'bg-zinc-800 text-cyan-500 border border-zinc-700 hover:bg-zinc-700'}`}
                >
                    3D
                </button>

                {/* Panic Button */}
                <button type="button"
                    onClick={handlePanic} 
                    aria-label="Panic Stop All Notes" 
                    className="h-7 w-7 bg-red-950/50 hover:bg-red-900/70 text-red-500 border border-red-900/50 flex items-center justify-center font-bold text-xs transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1014] rounded-md hover:scale-105 active:scale-95"
                    title="Panic (!)"
                >
                    !
                </button>
            </div>
        </header>
    );
});
