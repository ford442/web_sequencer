import { memo } from 'react';

type TrackKey = 'partA' | 'partB' | 'kick' | 'snare' | 'closedHat' | 'openHat' | 'sampler';

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
    const totalHeight = HEADER_HEIGHT + (ROWS.length * CELL_HEIGHT);

    return (
        <div
            className={`fixed left-0 top-16 bottom-0 z-40 bg-[#080a0b] border-r border-gray-800 transition-all duration-300 overflow-hidden flex flex-col shadow-2xl ${isVisible ? 'w-[800px] opacity-100' : 'w-0 opacity-0'}`}
        >
            {/* Header */}
            <div className="h-12 bg-[#0b0d10] border-b border-gray-800 flex items-center justify-between px-4 shrink-0">
                <h2 className="font-orbitron font-bold text-cyan-500 tracking-wider">SONG ARRANGER</h2>
                <div className="flex gap-2">
                    <button onClick={onRemoveMeasure} className="px-2 py-1 bg-gray-800 text-gray-400 text-xs rounded hover:bg-gray-700">- BAR</button>
                    <button onClick={onAddMeasure} className="px-2 py-1 bg-gray-800 text-cyan-400 text-xs rounded hover:bg-gray-700">+ BAR</button>
                    <button onClick={onExportXM} className="ml-4 px-3 py-1 bg-cyan-900/40 text-cyan-400 text-xs font-bold border border-cyan-800 rounded hover:bg-cyan-900/60">EXPORT XM</button>
                    <button onClick={onToggle} className="ml-2 text-gray-500 hover:text-white">✕</button>
                </div>
            </div>

            {/* Grid Container */}
            <div className="flex-1 overflow-auto p-4 custom-scrollbar">
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
                                            className={`shrink-0 border-r border-b border-gray-800/30 relative group cursor-pointer transition-colors
                                                ${isPlaying ? 'bg-white/5' : 'bg-transparent'}
                                                ${hasVal ? '' : 'hover:bg-gray-800/50'}
                                            `}
                                            onClick={() => {
                                                // Cycle: null -> 0 -> 1 ... -> 7 -> null
                                                // Right click to clear?
                                                // Let's implement a simple cycle for now, maybe a dropdown later if needed
                                                // Or shift-click to go backwards?
                                                let nextVal: number | null = val === null ? 0 : val + 1;
                                                if (nextVal > 7) nextVal = null;
                                                onUpdateStep(sIdx, row.key, nextVal);
                                            }}
                                            onContextMenu={(e) => {
                                                e.preventDefault();
                                                onUpdateStep(sIdx, row.key, null);
                                            }}
                                        >
                                            {hasVal && (
                                                <div
                                                    className="absolute inset-1 rounded flex items-center justify-center text-[10px] font-bold text-black select-none"
                                                    style={{ backgroundColor: row.color, opacity: isPlaying ? 1 : 0.8 }}
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
