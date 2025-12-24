import  { useState, useEffect, memo } from 'react';
import { getNoteColor } from '../utils/noteColors';

interface LiveKeyboardProps { onPlayNote: (note: string) => void; onStopNote?: (note: string) => void; activeTrackColor: string; }

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']; const OCTAVES = [5, 4, 3, 2]; // Top to bottom

// Mapping based on user request: // Right side (F8) = Lower Pitch (C3) // Left side (F1) = Higher Pitch (C4)
const KEY_TO_NOTE: Record<string, string> = {
    // Octave 3
    'F8': 'C3', 'Digit9': 'C#3', 'F7': 'D3', 'Digit8': 'D#3', 'F6': 'E3',
    // Digit7 skipped (No sharp between E and F)
    'F5': 'F3', 'Digit6': 'F#3', 'F4': 'G3', 'Digit5': 'G#3', 'F3': 'A3', 'Digit4': 'A#3', 'F2': 'B3',
    // Digit3 skipped (No sharp between B and C)

    // Octave 4
    'F1': 'C4',
    'Digit2': 'C#4'
};

export const LiveKeyboard = memo(({ onPlayNote, onStopNote, activeTrackColor }: LiveKeyboardProps) => { const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set()); const [isMouseDown, setIsMouseDown] = useState(false);

// --- KEYBOARD INTERACTION ---
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const note = KEY_TO_NOTE[e.code];
            if (note) {
                // Prevent default browser actions for F-keys (Help, Find, Refresh, etc.)
                e.preventDefault();

                // Prevent repeat triggers if key is held down
                if (!e.repeat) {
                    setActiveKeys(prev => {
                        const next = new Set(prev);
                        next.add(note);
                        return next;
                    });
                    onPlayNote(note);
                }
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            const note = KEY_TO_NOTE[e.code];
            if (note) {
                e.preventDefault();
                setActiveKeys(prev => {
                    const next = new Set(prev);
                    next.delete(note);
                    return next;
                });
                if (typeof onStopNote === 'function') onStopNote(note);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [onPlayNote]);

// --- MOUSE INTERACTION (Glissando) ---
    useEffect(() => {
        const handleGlobalMouseUp = () => setIsMouseDown(false);
        window.addEventListener('mouseup', handleGlobalMouseUp);
        return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }, []);

    const handleMouseDown = (note: string) => {
        setIsMouseDown(true);
        setActiveKeys(prev => new Set(prev).add(note));
        onPlayNote(note);
    };

    const handleMouseUp = (note: string) => {
        setIsMouseDown(false);
        setActiveKeys(prev => {
            const next = new Set(prev);
            next.delete(note);
            return next;
        });
        if (typeof onStopNote === 'function') onStopNote(note);
    };

    const handleMouseEnter = (note: string) => {
        if (isMouseDown) {
            setActiveKeys(prev => new Set(prev).add(note));
            onPlayNote(note);
        }
    };

    const handleMouseLeave = (note: string) => {
        if (activeKeys.has(note)) {
            setActiveKeys(prev => {
                const next = new Set(prev);
                next.delete(note);
                return next;
            });
            if (typeof onStopNote === 'function') onStopNote(note);
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

                            // UPDATED: Use getNoteColor for active state to match sequencer steps
                            // Inactive keys are subtly tinted to their note color for visual consistency
                            const noteColor = getNoteColor(fullNote);
                            const activeColor = isActive ? noteColor : activeTrackColor;
                            const inactiveTint = isBlack ? '#0b1220' : noteColor;

                            const x = colIndex * (keyWidth + gap);

                            return (
                                <g
                                    key={fullNote}
                                    transform={`translate(${x}, 0)`}
                                    onMouseDown={() => handleMouseDown(fullNote)}
                                    onMouseUp={() => handleMouseUp(fullNote)}
                                    onMouseEnter={() => handleMouseEnter(fullNote)}
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
                                        fill={isActive ? activeColor : inactiveTint}
                                        fillOpacity={isActive ? 0.6 : (isBlack ? 1 : 0.12)}
                                        stroke={isActive ? activeColor : 'none'}
                                        strokeWidth={1}
                                    />

                                    {/* Glassy Shine */}
                                    <rect
                                        x={4} y={4} width={keyWidth-8} height={(keyHeight-8)/2} rx={2}
                                        fill="url(#keyGlass)"
                                        pointerEvents="none"
                                    />

                                    {/* Label - color coded by note */}
                                    <text
                                        x={keyWidth/2} y={keyHeight - 8}
                                        textAnchor="middle"
                                        fontSize={10}
                                        fontFamily="monospace"
                                        fontWeight="bold"
                                        fill={isActive ? '#fff' : noteColor}
                                        pointerEvents="none"
                                    >
                                        {fullNote}
                                    </text>

                                    {/* Active LED Glow */}
                                    {isActive && (
                                        <rect
                                            x={6} y={keyHeight - 5} width={keyWidth - 12} height={2} rx={1}
                                            fill="#fff"
                                            filter="drop-shadow(0 0 4px #fff)"
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
});
