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
    backgroundImage: string;
    onSetBackgroundImage: (url: string) => void;
    onUpdateStep: (stepIndex: number, track: TrackKey, slotIndex: number | null) => void;
    onToggle: () => void;
    onAddMeasure: () => void;
    onRemoveMeasure: () => void;
    onExportXM: () => Promise<void> | void;
    isSongModeActive: boolean;
    onSetIsSongModeActive: (active: boolean) => void;
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

// VISUAL CONSTANTS
const CELL_WIDTH = 40;
const CELL_HEIGHT = 30;
const ROW_HEADER_WIDTH = 80;
const HEADER_HEIGHT = 30;

// Extracted & Memoized Cell Component to prevent massive re-renders during playback
const SongModeCell = memo(({
    sIdx,
    rowKey,
    rowLabel,
    val,
    isPlaying,
    onMouseDown,
    onKeyDown
}: {
    sIdx: number;
    rowKey: TrackKey;
    rowLabel: string;
    val: number | null;
    isPlaying: boolean;
    onMouseDown: (e: React.MouseEvent, sIdx: number, track: TrackKey, currentVal: number | null) => void;
    onKeyDown: (e: React.KeyboardEvent, sIdx: number, track: TrackKey, currentVal: number | null) => void;
}) => {
    const hasVal = val !== null;
    return (
        <div
            data-testid={`cell-${rowKey}-${sIdx}`}
            style={{ width: CELL_WIDTH }}
            className={`shrink-0 border-r border-b border-gray-800/30 relative group cursor-pointer transition-colors select-none focus:outline-none focus:ring-1 focus:ring-cyan-500
                ${isPlaying ? 'bg-white/5' : 'bg-transparent'}
                ${hasVal ? '' : 'hover:bg-gray-800/50'}
            `}
            role="button"
            tabIndex={0}
            aria-label={`${rowLabel} Measure ${sIdx + 1}, ${hasVal ? 'Pattern ' + (val! + 1) : 'Empty'}`}
            onMouseDown={(e) => onMouseDown(e, sIdx, rowKey, val)}
            onKeyDown={(e) => onKeyDown(e, sIdx, rowKey, val)}
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
});

export const SongMode = memo(({
    isVisible,
    songStructure,
    currentSongStep,
    backgroundImage,
    onSetBackgroundImage,
    onUpdateStep,
    onToggle,
    onAddMeasure,
    onRemoveMeasure,
    onExportXM,
    isSongModeActive,
    onSetIsSongModeActive,
    is3D = false
}: SongModeProps & { is3D?: boolean }) => {

    const totalWidth = ROW_HEADER_WIDTH + (songStructure.length * CELL_WIDTH);

    // Menu state
    const [menu, setMenu] = useState<{ x: number, y: number, sIdx: number, track: TrackKey, currentVal: number | null } | null>(null);
    const [isExporting, setIsExporting] = useState(false);

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


    // Click Handler: Handles Left Click Toggle & Right Click Drag/Menu
    const handleCellMouseDown = useCallback((e: React.MouseEvent, sIdx: number, track: TrackKey, currentVal: number | null) => {
        // Prevent default context menu for right clicks
        if (e.button === 2) {
            e.preventDefault();
        }
        e.stopPropagation();

        // Left Click (Button 0): Toggle
        if (e.button === 0) {
            if (currentVal !== null) {
                // Turn OFF
                onUpdateStep(sIdx, track, null);
            } else {
                // Turn ON (default to pattern 0)
                onUpdateStep(sIdx, track, 0);
            }
            return;
        }

        // Right Click (Button 2): Start Drag / Potential Double Click
        if (e.button === 2) {
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
        }

    }, [handleGlobalMouseMove, handleGlobalMouseUp, onUpdateStep]);

    // Keyboard Handler: Allows simple toggling via Enter/Space and value adjustment via Arrows
    const handleCellKeyDown = useCallback((e: React.KeyboardEvent, sIdx: number, track: TrackKey, currentVal: number | null) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            if (currentVal !== null) {
                onUpdateStep(sIdx, track, null);
            } else {
                onUpdateStep(sIdx, track, 0);
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            const nextVal = currentVal === null ? 0 : Math.min(7, currentVal + 1);
            onUpdateStep(sIdx, track, nextVal);
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            const nextVal = currentVal === null ? 0 : Math.max(0, currentVal - 1);
            onUpdateStep(sIdx, track, nextVal);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            e.stopPropagation();
            onUpdateStep(sIdx, track, null);
        }
    }, [onUpdateStep]);

    // Cleanup listeners
    React.useEffect(() => {
        return () => {
            window.removeEventListener('mousemove', handleGlobalMouseMove);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, [handleGlobalMouseMove, handleGlobalMouseUp]);

    const totalHeight = HEADER_HEIGHT + (ROWS.length * CELL_HEIGHT);

    if (is3D) {
        return (
            <div className="w-full h-full flex flex-col bg-[#0a0d10]">
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

                 {/* Header */}
                <div className="h-14 bg-gradient-to-r from-[#0b0d10] to-[#0d0f12] border-b-2 border-cyan-900/30 flex items-center justify-between px-6 shrink-0 relative">
                     <h2 className="font-orbitron font-bold text-cyan-400 tracking-widest">SONG ARRANGER</h2>
                     <div className="flex gap-3 items-center">
                        <button onClick={onRemoveMeasure} aria-label="Remove Measure" className="px-3 py-1.5 bg-gray-800 text-gray-300 text-xs rounded-lg border border-gray-600">- BAR</button>
                        <button onClick={onAddMeasure} aria-label="Add Measure" className="px-3 py-1.5 bg-gray-800 text-cyan-300 text-xs rounded-lg border border-cyan-900/50">+ BAR</button>
                        <button
                            onClick={() => onSetIsSongModeActive(!isSongModeActive)}
                            aria-pressed={isSongModeActive}
                            aria-label={isSongModeActive ? 'Loop Song Mode Active' : 'Loop Pattern Mode Active'}
                            className={`px-3 py-1.5 text-xs rounded-lg border font-bold ${isSongModeActive ? 'bg-purple-600 text-white border-purple-400' : 'bg-gray-800 text-gray-400 border-gray-700'}`}
                        >
                            {isSongModeActive ? 'LOOP SONG' : 'LOOP PATT'}
                        </button>
                     </div>
                </div>

                {/* Grid Container */}
                <div className="flex-1 overflow-auto p-6 custom-scrollbar bg-gradient-to-b from-[#0a0d10] to-[#080a0b]">
                    <div className="relative" style={{ width: Math.max(totalWidth, 760), height: totalHeight }}>
                         {/* Time Ruler */}
                        <div className="absolute left-0 top-0 h-[30px] flex border-b border-gray-800">
                            <div style={{ width: ROW_HEADER_WIDTH }} className="shrink-0 bg-[#0b0d10] z-10 sticky left-0 border-r border-gray-800"></div>
                            {songStructure.map((_, i) => (
                                <div key={i} style={{ width: CELL_WIDTH }} className={`shrink-0 flex items-center justify-center text-[10px] font-mono border-r border-gray-800/30 ${i === currentSongStep ? 'bg-cyan-900/20 text-cyan-400 font-bold' : 'text-gray-600'}`}>{i + 1}</div>
                            ))}
                        </div>
                        {/* Tracks */}
                        <div className="absolute left-0 top-[30px]">
                            {ROWS.map((row) => (
                                <div key={row.key} className="flex h-[30px]">
                                    <div style={{ width: ROW_HEADER_WIDTH }} className="shrink-0 bg-[#0b0d10] border-r border-gray-800 flex items-center px-2 sticky left-0 z-10">
                                        <span className="text-[10px] font-bold tracking-wider" style={{ color: row.color }}>{row.label}</span>
                                    </div>
                                    {songStructure.map((step, sIdx) => {
                                        const val = step[row.key];
                                        return (
                                            <SongModeCell
                                                key={`${row.key}-${sIdx}`}
                                                sIdx={sIdx}
                                                rowKey={row.key}
                                                rowLabel={row.label}
                                                val={val}
                                                isPlaying={sIdx === currentSongStep}
                                                onMouseDown={handleCellMouseDown}
                                                onKeyDown={handleCellKeyDown}
                                            />
                                        );
                                    })}
                                </div>
                            ))}
                        </div>
                        <div className="absolute top-0 bottom-0 w-[2px] bg-cyan-500/50 pointer-events-none z-20" style={{ left: ROW_HEADER_WIDTH + currentSongStep * CELL_WIDTH }} />
                    </div>
                </div>
            </div>
        )
    }

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
                <div className="flex gap-3 items-center">
                    <div className="flex items-center gap-2 mr-4 bg-gray-900/50 p-1 rounded border border-gray-800">
                        <span className="text-[10px] text-gray-500 font-mono" id="bg-img-label">BG IMG:</span>
                        <input
                            type="text"
                            value={backgroundImage}
                            onChange={(e) => onSetBackgroundImage(e.target.value)}
                            placeholder="https://..."
                            aria-labelledby="bg-img-label"
                            className="w-32 bg-transparent text-xs text-cyan-300 focus:outline-none border-b border-gray-700 focus:border-cyan-500 font-mono"
                        />
                        {backgroundImage && (
                            <button
                                onClick={() => onSetBackgroundImage('')}
                                className="text-gray-500 hover:text-white px-1 text-xs"
                                aria-label="Clear Background Image"
                            >
                                ✕
                            </button>
                        )}
                    </div>
                    <button onClick={onRemoveMeasure} aria-label="Remove Measure" className="px-3 py-1.5 bg-gradient-to-r from-gray-800 to-gray-700 text-gray-300 text-xs rounded-lg hover:from-gray-700 hover:to-gray-600 border border-gray-600 shadow-md transition-all">- BAR</button>
                    <button onClick={onAddMeasure} aria-label="Add Measure" className="px-3 py-1.5 bg-gradient-to-r from-gray-800 to-gray-700 text-cyan-300 text-xs rounded-lg hover:from-gray-700 hover:to-gray-600 border border-cyan-900/50 shadow-md transition-all">+ BAR</button>
                    <button
                        onClick={() => onSetIsSongModeActive(!isSongModeActive)}
                        aria-pressed={isSongModeActive}
                        aria-label={isSongModeActive ? 'Loop Song Mode Active' : 'Loop Pattern Mode Active'}
                        className={`px-3 py-1.5 text-xs rounded-lg border font-bold transition-all ${isSongModeActive ? 'bg-purple-600 text-white border-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.5)]' : 'bg-gray-800 text-gray-400 border-gray-700'}`}
                    >
                        {isSongModeActive ? 'LOOP SONG' : 'LOOP PATT'}
                    </button>
                    <button
                        onClick={async () => {
                            if (isExporting) return;
                            setIsExporting(true);
                            try {
                                await onExportXM();
                            } finally {
                                setIsExporting(false);
                            }
                        }}
                        disabled={isExporting}
                        aria-label="Export as XM file"
                        className={`ml-2 px-4 py-1.5 flex items-center justify-center min-w-[100px] bg-gradient-to-r text-cyan-400 text-xs font-bold border border-cyan-700/50 rounded-lg shadow-lg transition-all ${
                            isExporting
                            ? 'from-cyan-900/20 to-cyan-800/20 opacity-70 cursor-wait'
                            : 'from-cyan-900/40 to-cyan-800/40 hover:from-cyan-800/60 hover:to-cyan-700/60'
                        }`}
                        aria-busy={isExporting}
                    >
                        {isExporting ? (
                            <span className="flex items-center gap-2">
                                <svg className="animate-spin h-3 w-3 text-cyan-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                EXPORTING...
                            </span>
                        ) : 'EXPORT XM'}
                    </button>
                    <button onClick={onToggle} aria-label="Close Song Mode" title="Close Song Mode" className="ml-2 text-gray-400 hover:text-white text-lg transition-colors">✕</button>
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
                                    return (
                                        <SongModeCell
                                            key={`${row.key}-${sIdx}`}
                                            sIdx={sIdx}
                                            rowKey={row.key}
                                            rowLabel={row.label}
                                            val={val}
                                            isPlaying={sIdx === currentSongStep}
                                            onMouseDown={handleCellMouseDown}
                                            onKeyDown={handleCellKeyDown}
                                        />
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
