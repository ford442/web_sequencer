import React, { useState } from 'react';

interface LiveKeyboardProps {
    onPlayNote: (note: string) => void;
    activeTrackColor: string;
}

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const OCTAVES = [5, 4, 3, 2]; // Top to bottom

export const LiveKeyboard: React.FC<LiveKeyboardProps> = ({ onPlayNote, activeTrackColor }) => {
    const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());

    const handleMouseDown = (note: string) => {
        setActiveKeys(prev => new Set(prev).add(note));
        onPlayNote(note);
    };

    const handleMouseUp = (note: string) => {
        setActiveKeys(prev => {
            const next = new Set(prev);
            next.delete(note);
            return next;
        });
    };

    const handleMouseLeave = (note: string) => {
        if (activeKeys.has(note)) {
            handleMouseUp(note);
        }
    };

    // Width calculations
    const totalWidth = 920;
    const gap = 4;
    const keyWidth = (totalWidth - (11 * gap)) / 12;
    const keyHeight = 40;
    const rowGap = 6;

    return (
        <div className="w-full max-w-[920px] mx-auto mt-4 select-none">
             <svg viewBox={`0 0 ${totalWidth} ${keyHeight * 4 + rowGap * 3}`} className="w-full drop-shadow-lg">
                <defs>
                    <linearGradient id="keyGlass" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="white" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="white" stopOpacity="0" />
                    </linearGradient>
                </defs>

                {OCTAVES.map((octave, rowIndex) => (
                    <g key={octave} transform={`translate(0, ${rowIndex * (keyHeight + rowGap)})`}>
                        {NOTES.map((noteName, colIndex) => {
                            const fullNote = `${noteName}${octave}`;
                            const isBlack = noteName.includes('#');
                            const isActive = activeKeys.has(fullNote);

                            // Visuals
                            const baseColor = isBlack ? '#080a0c' : '#151a21'; // Dark vs Light(er) Dark
                            const activeColor = activeTrackColor || '#06b6d4';

                            const x = colIndex * (keyWidth + gap);

                            return (
                                <g
                                    key={fullNote}
                                    transform={`translate(${x}, 0)`}
                                    onMouseDown={() => handleMouseDown(fullNote)}
                                    onMouseUp={() => handleMouseUp(fullNote)}
                                    onMouseLeave={() => handleMouseLeave(fullNote)}
                                    onTouchStart={(e) => { e.preventDefault(); handleMouseDown(fullNote); }}
                                    onTouchEnd={(e) => { e.preventDefault(); handleMouseUp(fullNote); }}
                                    cursor="pointer"
                                >
                                    {/* Base / Bevel Shadow */}
                                    <rect width={keyWidth} height={keyHeight} rx={4} fill="#000" />

                                    {/* Main Body */}
                                    <rect
                                        x={1} y={1} width={keyWidth-2} height={keyHeight-2} rx={3}
                                        fill={isActive ? '#1f2e25' : baseColor}
                                    />

                                    {/* Top Highlight (Bevel) */}
                                    <path d={`M 2 2 L ${keyWidth-2} 2 L ${keyWidth-4} 4 L 4 4 Z`} fill="rgba(255,255,255,0.2)" />

                                    {/* Bottom Shadow (Bevel) */}
                                    <path d={`M 2 ${keyHeight-2} L ${keyWidth-2} ${keyHeight-2} L ${keyWidth-4} ${keyHeight-4} L 4 ${keyHeight-4} Z`} fill="rgba(0,0,0,0.6)" />

                                    {/* Inner Cap */}
                                    <rect
                                        x={3} y={3} width={keyWidth-6} height={keyHeight-6} rx={2}
                                        fill={isActive ? activeColor : (isBlack ? '#111' : '#222')}
                                        fillOpacity={isActive ? 0.6 : 1}
                                        stroke={isActive ? activeColor : 'none'}
                                        strokeWidth={1}
                                    />

                                    {/* Glassy Shine */}
                                    <rect
                                        x={4} y={4} width={keyWidth-8} height={(keyHeight-8)/2} rx={2}
                                        fill="url(#keyGlass)"
                                        pointerEvents="none"
                                    />

                                    {/* Label */}
                                    <text
                                        x={keyWidth/2} y={keyHeight - 8}
                                        textAnchor="middle"
                                        fontSize={10}
                                        fontFamily="monospace"
                                        fontWeight="bold"
                                        fill={isActive ? '#fff' : (isBlack ? '#555' : '#888')}
                                        pointerEvents="none"
                                    >
                                        {fullNote}
                                    </text>

                                    {/* Active LED Glow */}
                                    {isActive && (
                                         <rect
                                            x={6} y={keyHeight - 5} width={keyWidth - 12} height={2} rx={1}
                                            fill="#fff"
                                         />
                                    )}
                                </g>
                            );
                        })}
                    </g>
                ))}
             </svg>
        </div>
    );
};
