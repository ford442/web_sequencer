import React from 'react';
import type { SongStructure } from '../types';
import { ROWS } from '../App'; // Assuming ROWS is exported from App.tsx

// A simple indicator for a pattern in the song grid
const SongStepIndicator = ({ patternIndex, bank, isCurrent, x, width, onContextMenu }: { patternIndex: number, bank: number, isCurrent: boolean, x: number, width: number, onContextMenu: (e: React.MouseEvent) => void }) => {
    const bankColors = [
        ['#3fa34d', '#234a2e', '#8fa394'], // Bank A
        ['#3f8fa3', '#233d4a', '#8fb2c0'], // Bank B
        ['#a33f8f', '#4a233d', '#c08fb2'], // Bank C
        ['#a38f3f', '#4a3d23', '#c0b28f'], // Bank D
    ];
    const color = bankColors[bank][0];

    return (
        <g transform={`translate(${x}, 0)`} onContextMenu={onContextMenu} cursor="pointer">
            <rect
                width={width}
                height={20}
                fill={color}
                fillOpacity={0.6}
                stroke={isCurrent ? '#fff' : color}
                strokeWidth={isCurrent ? 2 : 1}
                rx={2}
            />
            <text x={width / 2} y={14} textAnchor="middle" fontSize={10} fill="#fff" fontWeight="bold">
                {String.fromCharCode(65 + bank)}{patternIndex % 8 + 1}
            </text>
        </g>
    );
};


interface SongModeProps {
    song: SongStructure;
    zoom: number;
    scroll: number;
    onZoomChange: (zoom: number) => void;
    onScrollChange: (scroll: number) => void;
    onLengthChange: (length: number) => void;
    onLoopLengthChange: (length: number) => void;
    onLoopToggle: () => void;
    onStepRightClick: (trackIndex: number, stepIndex: number, e: React.MouseEvent) => void;
}

interface SongModeProps {
    song: SongStructure;
    zoom: number;
    scroll: number;
    isPlaying: boolean;
    onPlayToggle: () => void;
    onZoomChange: (zoom: number) => void;
    onScrollChange: (scroll: number) => void;
    onLengthChange: (length: number) => void;
    onLoopLengthChange: (length: number) => void;
    onLoopToggle: () => void;
    onStepRightClick: (trackIndex: number, stepIndex: number, e: React.MouseEvent) => void;
}

export const SongMode: React.FC<SongModeProps> = ({ song, zoom, scroll, isPlaying, onPlayToggle, onZoomChange, onScrollChange, onLengthChange, onLoopLengthChange, onLoopToggle, onStepRightClick }) => {
    const stepsPerView = 128 / zoom;
    const stepWidth = 22 * zoom;

    return (
        <div className="w-full h-full bg-[#080a0c] flex flex-col p-4 text-white">
            {/* Header Controls */}
            <div className="flex items-center justify-between mb-4 shrink-0">
                <div className="flex items-center gap-4">
                    <h2 className="text-xl font-orbitron text-cyan-400">SONG MODE</h2>
                    <button
                        onClick={onPlayToggle}
                        className={`w-20 py-1 rounded font-orbitron text-xs font-bold tracking-wide transition-all shadow-lg ${
                            isPlaying
                                ? 'bg-red-900/20 text-red-400 border border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.2)]'
                                : 'bg-green-900/20 text-green-400 border border-green-500 shadow-[0_0_15px_rgba(34,197,94,0.2)]'
                        }`}
                    >
                        {isPlaying ? 'STOP' : 'PLAY'}
                    </button>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center bg-gray-900 rounded border border-gray-700">
                        <button onClick={() => onZoomChange(Math.max(1, zoom / 2))} className="px-3 py-1 text-cyan-500 font-bold border-r border-gray-700 hover:bg-gray-800">-</button>
                        <span className="w-20 text-center font-mono text-cyan-300 text-sm">ZOOM {zoom}x</span>
                        <button onClick={() => onZoomChange(Math.min(8, zoom * 2))} className="px-3 py-1 text-cyan-500 font-bold border-l border-gray-700 hover:bg-gray-800">+</button>
                    </div>
                     <div className="flex items-center bg-gray-900 rounded border border-gray-700">
                        <button onClick={() => onLengthChange(Math.max(1, song.length - 1))} className="px-3 py-1 text-cyan-500 font-bold border-r border-gray-700 hover:bg-gray-800">-</button>
                        <span className="w-24 text-center font-mono text-cyan-300 text-sm">{song.length} STEPS</span>
                        <button onClick={() => onLengthChange(Math.min(128, song.length + 1))} className="px-3 py-1 text-cyan-500 font-bold border-l border-gray-700 hover:bg-gray-800">+</button>
                    </div>
                    <div className="flex items-center bg-gray-900 rounded border border-gray-700">
                        <button onClick={() => onLoopLengthChange(Math.max(1, song.loopLength - 1))} className="px-3 py-1 text-cyan-500 font-bold border-r border-gray-700 hover:bg-gray-800">-</button>
                        <span className="w-24 text-center font-mono text-cyan-300 text-sm">{song.loopLength} LOOP</span>
                        <button onClick={() => onLoopLengthChange(Math.min(128, song.loopLength + 1))} className="px-3 py-1 text-cyan-500 font-bold border-l border-gray-700 hover:bg-gray-800">+</button>
                    </div>
                     <button onClick={onLoopToggle} className={`px-4 py-1 font-bold text-sm rounded ${song.loop ? 'bg-green-500 text-black' : 'bg-gray-700 text-gray-300'}`}>
                        LOOP {song.loop ? 'ON' : 'OFF'}
                    </button>
                </div>
            </div>

            {/* Sequencer Grid */}
            <div className="flex-1 overflow-x-hidden relative">
                 <svg width="100%" height="100%" viewBox="0 0 900 420" preserveAspectRatio="xMidYMid meet">
                    <g transform="translate(100, 20)">
                        {ROWS.map((row, trackIndex) => (
                            <g key={row.key} transform={`translate(0, ${trackIndex * 30})`}>
                                <text x="-10" y="15" textAnchor="end" fill="#aaa" fontSize={12}>{row.label}</text>
                                {Array.from({ length: stepsPerView }).map((_, i) => {
                                    const stepIndex = scroll + i;
                                    const step = song.steps[trackIndex][stepIndex];
                                    return (
                                        <g key={stepIndex} transform={`translate(${i * stepWidth}, 0)`} onContextMenu={(e) => onStepRightClick(trackIndex, stepIndex, e)}>
                                            {step?.patternIndex !== null && step?.patternIndex !== undefined ? (
                                                <SongStepIndicator
                                                    x={0}
                                                    width={stepWidth - 2}
                                                    patternIndex={step.patternIndex}
                                                    bank={Math.floor(step.patternIndex / 8)}
                                                    isCurrent={song.currentSongStep === stepIndex}
                                                    onContextMenu={(e) => onStepRightClick(trackIndex, stepIndex, e)}
                                                />
                                            ) : (
                                                <rect
                                                    x={0}
                                                    width={stepWidth - 2}
                                                    height={20}
                                                    fill="rgba(255, 255, 255, 0.05)"
                                                    rx={2}
                                                    cursor="pointer"
                                                />
                                            )}
                                        </g>
                                    );
                                })}
                            </g>
                        ))}
                    </g>
                </svg>
            </div>

             {/* Scrollbar */}
            <div className="shrink-0 pt-2">
                 <input
                    type="range"
                    min="0"
                    max={128 - stepsPerView}
                    value={scroll}
                    onChange={(e) => onScrollChange(parseInt(e.target.value, 10))}
                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                />
            </div>
        </div>
    );
};
