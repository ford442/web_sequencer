import React, { memo, useRef, useState, useCallback } from 'react';
import { getNoteColor } from '../utils/noteColors';
import { PatternSelector } from './PatternSelector';

type TrackKey = 'partA' | 'partB' | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'sampler';

// Map pattern slot numbers (0-7) to note colors (C4, D4, E4, F4, G4, A4, B4, C5)
const PATTERN_NOTES = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const getPatternColor = (slotIndex: number): string => {
    return getNoteColor(PATTERN_NOTES[slotIndex % PATTERN_NOTES.length]);
};

interface SongModeProps {
    isVisible: boolean;
    songStructure: { [key in TrackKey]: number | null }[];
    currentSongStep: number;
    onUpdateStep: (stepIndex: number, track: TrackKey, slotIndex: number | null) => void;
    onToggle: () => void;
    onAddMeasure: () => void;
    onRemoveMeasure: () => void;
    onExportXM: () => void;
}

const ROWS: { key: TrackKey, label: string, color: string }[] = [
    { key: 'partA', label: 'LEAD', color: '#06b6d4' },
    { key: 'partB', label: 'BASS', color: '#d946ef' },
    { key: 'kick', label: 'KICK', color: '#f97316' },
    { key: 'snare', label: 'SNARE', color: '#22c55e' },
    { key: 'closedHat', label: 'CH', color: '#eab308' },
    { key: 'openHat', label: 'OH', color: '#eab308' },
    { key: 'sampler', label: 'SMP', color: '#a855f7' },
];

export const SongMode = memo(({
    isVisible,
    songStructure,
    currentSongStep,
    onUpdateStep,
    onToggle,
    onAddMeasure,
    onRemoveMeasure,
    onExportXM
}: SongModeProps) => {

    // VISUAL CONSTANTS
    const CELL_WIDTH = 40;
    const CELL_HEIGHT = 30;
    const ROW_HEADER_WIDTH = 80;
    const HEADER_HEIGHT = 30;

    const totalWidth = ROW_HEADER_WIDTH + (songStructure.length * CELL_WIDTH);

    // Menu state
    const [menu, setMenu] = useState<{ x: number, y: number, sIdx: number, track: TrackKey, currentVal: number | null } | null>(null);

    // Double Click State
    const lastRightClickTimeRef = useRef<number>(0);

    const dragRef = useRef<{ 
        sIdx: number; 
        track: TrackKey; 
        startY: number; 
        startVal: number | null; 
        hasMoved: boolean; 
        accumulatedY: number 
    } | null>(null);


    const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
        if (!dragRef.current) return;
        
        const { sIdx, track, startY, startVal } = dragRef.current;
        const dy = startY - e.clientY; // Positive when dragging up
        
        // Threshold check to avoid accidental drags
        if (!dragRef.current.hasMoved && Math.abs(dy) > 5) {
            dragRef.current.hasMoved = true;
        }

        if (dragRef.current.hasMoved) {
            const step = Math.round(dy / 15); // Every 15px = 1 pattern change
            
            if (step !== 0) {
                // If we moved enough to change value, update startY to reset the delta accumulation
                // Actually, logic is simpler if we always diff from startY.
                
                let newVal: number | null;
                if (startVal === null) {
                    // Start from 0 or 7 depending on direction
                    newVal = step > 0 ? Math.min(step - 1, 7) : Math.max(7 + step + 1, 0);
                } else {
                    newVal = startVal + step;
                }
                
                // Clamp to 0-7 or null (dragging down past 0 clears it)
                if (newVal !== null) {
                    if (newVal < 0) newVal = null;
                    else if (newVal > 7) newVal = 7;
                }
                
                onUpdateStep(sIdx, track, newVal);
            }
        }
    }, [onUpdateStep]);

    const handleGlobalMouseUp = useCallback((e: MouseEvent) => {
        if (!dragRef.current) return;

        // If it was a short click (no drag), check for Double Click
        if (!dragRef.current.hasMoved) {
            const now = Date.now();
            const diff = now - lastRightClickTimeRef.current;
            
            if (diff < 300) {
                // Double Click!
                const { sIdx, track, startVal } = dragRef.current;
                setMenu({ x: e.clientX, y: e.clientY, sIdx, track, currentVal: startVal });
                lastRightClickTimeRef.current = 0;
            } else {
                lastRightClickTimeRef.current = now;
            }
        }

        dragRef.current = null;
        document.body.style.cursor = 'default';

        // Remove listeners
        window.removeEventListener('mousemove', handleGlobalMouseMove);
        window.removeEventListener('mouseup', handleGlobalMouseUp);

    }, [handleGlobalMouseMove]);


    // Right-Click Handler: Starts tracking for Potential Drag OR Menu
    const handleRightMouseDown = useCallback((e: React.MouseEvent, sIdx: number, track: TrackKey, currentVal: number | null) => {
        if (e.button !== 2) return; // Only Right Click
        e.preventDefault();
        e.stopPropagation();

        dragRef.current = { 
            sIdx, 
            track, 
            startY: e.clientY, 
            startVal: currentVal, 
            hasMoved: false,
            accumulatedY: 0
        };
        document.body.style.cursor = 'ns-resize';

        // Attach listeners
        window.addEventListener('mousemove', handleGlobalMouseMove);
        window.addEventListener('mouseup', handleGlobalMouseUp);

    }, [handleGlobalMouseMove, handleGlobalMouseUp]);


    // Cleanup listeners
    React.useEffect(() => {
        return () => {
            window.removeEventListener('mousemove', handleGlobalMouseMove);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, [handleGlobalMouseMove, handleGlobalMouseUp]);

    const totalHeight = HEADER_HEIGHT + (ROWS.length * CELL_HEIGHT);

    return (
        <div
            className={`fixed left-0 top-16 bottom-[320px] z-40 bg-gradient-to-br from-[#0a0d10] to-[#080a0b] border-r-2 border-cyan-900/30 transition-all duration-300 overflow-hidden flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.9)] backdrop-blur-sm ${isVisible ? 'w-[850px] opacity-100' : 'w-0 opacity-0'}`}
        >
            {/* Context Menu */}
            {menu && (
                <PatternSelector 
                    x={menu.x} 
                    y={menu.y} 
                    currentPattern={menu.currentVal}
                    onSelect={(val) => {
                        onUpdateStep(menu.sIdx, menu.track, val);
                        setMenu(null);
                    }}
                    onClose={() => setMenu(null)}
                />
            )}

            {/* Decorative edge line */}
            <div className="absolute top-0 bottom-0 right-0 w-px bg-gradient-to-b from-cyan-500/30 via-transparent to-cyan-500/30 pointer-events-none"></div>
            
            {/* Header */}
            <div className="h-14 bg-gradient-to-r from-[#0b0d10] to-[#0d0f12] border-b-2 border-cyan-900/30 flex items-center justify-between px-6 shrink-0 shadow-lg relative">
                {/* Decorative line */}
                <div className="absolute bottom-0 left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent"></div>
                
                <h2 className="font-orbitron font-bold text-cyan-400 tracking-widest drop-shadow-[0_0_8px_rgba(6,182,212,0.4)]">SONG ARRANGER</h2>
                <div className="flex gap-3">
                    <button onClick={onRemoveMeasure} className="px-3 py-1.5 bg-gradient-to-r from-gray-800 to-gray-700 text-gray-300 text-xs rounded-lg hover:from-gray-700 hover:to-gray-600 border border-gray-600 shadow-md transition-all">- BAR</button>
                    <button onClick={onAddMeasure} className="px-3 py-1.5 bg-gradient-to-r from-gray-800 to-gray-700 text-cyan-300 text-xs rounded-lg hover:from-gray-700 hover:to-gray-600 border border-cyan-900/50 shadow-md transition-all">+ BAR</button>
                    <button onClick={onExportXM} className="ml-2 px-4 py-1.5 bg-gradient-to-r from-cyan-900/40 to-cyan-800/40 text-cyan-400 text-xs font-bold border border-cyan-700/50 rounded-lg hover:from-cyan-800/60 hover:to-cyan-700/60 shadow-lg transition-all">EXPORT XM</button>
                    <button onClick={onToggle} className="ml-2 text-gray-400 hover:text-white text-lg transition-colors">✕</button>
                </div>
            </div>

            {/* Grid Container */}
            <div className="flex-1 overflow-auto p-6 custom-scrollbar bg-gradient-to-b from-[#0a0d10] to-[#080a0b]">
                <div className="relative" style={{ width: Math.max(totalWidth, 760), height: totalHeight }}>

                    {/* Time Ruler */}
                    <div className="absolute left-0 top-0 h-[30px] flex border-b border-gray-800">
                        <div style={{ width: ROW_HEADER_WIDTH }} className="shrink-0 bg-[#0b0d10] z-10 sticky left-0 border-r border-gray-800"></div>
                        {songStructure.map((_, i) => (
                            <div
                                key={i}
                                style={{ width: CELL_WIDTH }}
                                className={`shrink-0 flex items-center justify-center text-[10px] font-mono border-r border-gray-800/30 ${i === currentSongStep ? 'bg-cyan-900/20 text-cyan-400 font-bold' : 'text-gray-600'}`}
                            >
                                {i + 1}
                            </div>
                        ))}
                    </div>

                    {/* Tracks */}
                    <div className="absolute left-0 top-[30px]">
                        {ROWS.map((row) => (
                            <div key={row.key} className="flex h-[30px]">
                                {/* Row Header */}
                                <div
                                    style={{ width: ROW_HEADER_WIDTH }}
                                    className="shrink-0 bg-[#0b0d10] border-r border-gray-800 flex items-center px-2 sticky left-0 z-10"
                                >
                                    <span className="text-[10px] font-bold tracking-wider" style={{ color: row.color }}>{row.label}</span>
                                </div>

                                {/* Cells */}
                                {songStructure.map((step, sIdx) => {
                                    const val = step[row.key];
                                    const hasVal = val !== null;

                                    // Current Step Highlight
                                    const isPlaying = sIdx === currentSongStep;

                                    return (
                                        <div
                                            key={`${row.key}-${sIdx}`}
                                            style={{ width: CELL_WIDTH }}
                                            className={`shrink-0 border-r border-b border-gray-800/30 relative group cursor-ns-resize transition-colors select-none
                                                ${isPlaying ? 'bg-white/5' : 'bg-transparent'}
                                                ${hasVal ? '' : 'hover:bg-gray-800/50'}
                                            `}
                                            onMouseDown={(e) => handleRightMouseDown(e, sIdx, row.key, val)}
                                            onContextMenu={(e) => {
                                                e.preventDefault();
                                            }}
                                        >
                                            {hasVal && (
                                                <div
                                                    className="absolute inset-1 rounded flex items-center justify-center text-[10px] font-bold text-black select-none pointer-events-none"
                                                    style={{ backgroundColor: getPatternColor(val!), opacity: isPlaying ? 1 : 0.8 }}
                                                >
                                                    {val! + 1}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>

                     {/* Current Playhead Line */}
                     <div
                        className="absolute top-0 bottom-0 w-[2px] bg-cyan-500/50 pointer-events-none z-20 transition-all duration-100"
                        style={{ left: ROW_HEADER_WIDTH + currentSongStep * CELL_WIDTH }}
                    />

                </div>
            </div>
        </div>
    );
});
