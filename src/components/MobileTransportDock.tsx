import React, { memo } from 'react';

interface MobileTransportDockProps {
    isPlaying: boolean;
    isRecording: boolean;
    tempo: number;
    isSongModeOpen: boolean;
    onPlayToggle: () => void;
    onRecordToggle: () => void;
    onTempoNudgeStart: (direction: -1 | 1) => void;
    onTempoNudgeEnd: () => void;
    onSongModeToggle: () => void;
    onPanic: () => void;
}

/** Sticky thumb-friendly transport bar for narrow / touch viewports. */
export const MobileTransportDock = memo(function MobileTransportDock({
    isPlaying,
    isRecording,
    tempo,
    isSongModeOpen,
    onPlayToggle,
    onRecordToggle,
    onTempoNudgeStart,
    onTempoNudgeEnd,
    onSongModeToggle,
    onPanic,
}: MobileTransportDockProps) {
    return (
        <div
            className="mobile-transport-dock fixed left-0 right-0 bottom-10 z-50 flex items-center justify-between gap-2 px-3 py-2 bg-[#0b0d10]/95 border-t border-cyan-900/40 backdrop-blur-md shadow-[0_-8px_24px_rgba(0,0,0,0.55)] sm:hidden"
            role="toolbar"
            aria-label="Mobile transport"
        >
            <button
                type="button"
                onClick={onPlayToggle}
                aria-pressed={isPlaying}
                aria-label={isPlaying ? 'Stop playback' : 'Start playback'}
                className={`mobile-tap-target min-w-[4.5rem] flex-1 max-w-[9rem] h-11 rounded-lg font-orbitron text-sm font-bold tracking-wider touch-manipulation ${
                    isPlaying
                        ? 'bg-red-600 text-white border border-red-400'
                        : 'bg-green-600 text-white border border-green-400'
                }`}
            >
                {isPlaying ? '■ STOP' : '▶ PLAY'}
            </button>

            <button
                type="button"
                onClick={onRecordToggle}
                aria-pressed={isRecording}
                aria-label="Toggle recording"
                className={`mobile-tap-target w-11 h-11 rounded-lg font-orbitron text-xs font-bold touch-manipulation ${
                    isRecording
                        ? 'bg-red-600 text-white animate-pulse border border-red-400'
                        : 'bg-zinc-800 text-red-400 border border-zinc-700'
                }`}
            >
                REC
            </button>

            <div className="flex items-center bg-zinc-950 rounded-lg border border-zinc-800">
                <button
                    type="button"
                    onPointerDown={() => onTempoNudgeStart(-1)}
                    onPointerUp={onTempoNudgeEnd}
                    onPointerLeave={onTempoNudgeEnd}
                    aria-label="Decrease tempo"
                    className="mobile-tap-target w-10 h-11 text-cyan-400 font-bold text-lg touch-manipulation"
                >
                    −
                </button>
                <span className="w-12 text-center font-mono text-cyan-200 text-sm" aria-live="polite">
                    {tempo}
                </span>
                <button
                    type="button"
                    onPointerDown={() => onTempoNudgeStart(1)}
                    onPointerUp={onTempoNudgeEnd}
                    onPointerLeave={onTempoNudgeEnd}
                    aria-label="Increase tempo"
                    className="mobile-tap-target w-10 h-11 text-cyan-400 font-bold text-lg touch-manipulation"
                >
                    +
                </button>
            </div>

            <button
                type="button"
                onClick={onSongModeToggle}
                aria-pressed={isSongModeOpen}
                aria-label="Toggle song mode"
                className={`mobile-tap-target h-11 px-3 rounded-lg font-orbitron text-xs font-bold touch-manipulation ${
                    isSongModeOpen
                        ? 'bg-purple-600 text-white border border-purple-400'
                        : 'bg-zinc-800 text-gray-300 border border-zinc-700'
                }`}
            >
                SONG
            </button>

            <button
                type="button"
                onClick={onPanic}
                aria-label="Panic stop all notes"
                className="mobile-tap-target w-11 h-11 rounded-lg bg-red-950/80 text-red-400 border border-red-900/60 font-bold touch-manipulation"
            >
                !
            </button>
        </div>
    );
});
