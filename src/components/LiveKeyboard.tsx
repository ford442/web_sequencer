import React, { useState, useEffect } from 'react';
import { getNoteColor } from '../utils/noteColors';

interface LiveKeyboardProps { onPlayNote: (note: string) => void; activeTrackColor: string; }

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']; const OCTAVES = [5, 4, 3, 2]; // Top to bottom

// Mapping: Extended to support all 4 visible octaves
// Top row (number keys): Sharp notes for current octave
// F-keys: Natural notes
// Q-P: Higher octave (5), A-L: Octave 4, Z-M: Lower octave (2)
const KEY_TO_NOTE: Record<string, string> = {
    // === OCTAVE 5 (Top row in keyboard visual) ===
    'KeyQ': 'C5', 'Digit2': 'C#5',
    'KeyW': 'D5', 'Digit3': 'D#5',
    'KeyE': 'E5',
    'KeyR': 'F5', 'Digit5': 'F#5',
    'KeyT': 'G5', 'Digit6': 'G#5',
    'KeyY': 'A5', 'Digit7': 'A#5',
    'KeyU': 'B5',

    // === OCTAVE 4 ===
    'KeyA': 'C4', 'KeyZ': 'C#4',
    'KeyS': 'D4', 'KeyX': 'D#4',
    'KeyD': 'E4',
    'KeyF': 'F4', 'KeyC': 'F#4',
    'KeyG': 'G4', 'KeyV': 'G#4',
    'KeyH': 'A4', 'KeyB': 'A#4',
    'KeyJ': 'B4',

    // === OCTAVE 3 (F-keys as alternative) ===
    'F8': 'C3', 'Digit9': 'C#3',
    'F7': 'D3', 'Digit8': 'D#3',
    'F6': 'E3',
    'F5': 'F3',
    'F4': 'G3',
    'F3': 'A3', 'Digit4': 'A#3',
    'F2': 'B3',
    'F1': 'C4', // F1 maps to C4 as alternate

    // === OCTAVE 2 (Bottom row in keyboard visual) ===
    'KeyK': 'C2', 'KeyM': 'C#2',
    'KeyL': 'D2', 'Comma': 'D#2',
    'Semicolon': 'E2',
    'Quote': 'F2', 'Period': 'F#2',
    'BracketLeft': 'G2', 'Slash': 'G#2',
    'BracketRight': 'A2',
    'Backslash': 'B2',
};

export const LiveKeyboard: React.FC<LiveKeyboardProps> = ({ onPlayNote, activeTrackColor }) => {
    const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set()); const [isMouseDown, setIsMouseDown] = useState(false);

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
                            // If not active, fall back to default track color (though currently unused for inactive keys)
                            const noteColor = getNoteColor(fullNote);
                            const activeColor = isActive ? noteColor : activeTrackColor;

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
                                        x={1} y={1} width={keyWidth - 2} height={keyHeight - 2} rx={3}
                                        fill={isActive ? '#1f2e25' : baseColor}
                                    />

                                    {/* Top Highlight (Bevel) */}
                                    <path d={`M 2 2 L ${keyWidth - 2} 2 L ${keyWidth - 4} 4 L 4 4 Z`} fill="rgba(255,255,255,0.2)" />

                                    {/* Bottom Shadow (Bevel) */}
                                    <path d={`M 2 ${keyHeight - 2} L ${keyWidth - 2} ${keyHeight - 2} L ${keyWidth - 4} ${keyHeight - 4} L 4 ${keyHeight - 4} Z`} fill="rgba(0,0,0,0.6)" />

                                    {/* Inner Cap */}
                                    <rect
                                        x={3} y={3} width={keyWidth - 6} height={keyHeight - 6} rx={2}
                                        fill={isActive ? activeColor : (isBlack ? '#111' : '#222')}
                                        fillOpacity={isActive ? 0.6 : 1}
                                        stroke={isActive ? activeColor : 'none'}
                                        strokeWidth={1}
                                    />

                                    {/* Glassy Shine */}
                                    <rect
                                        x={4} y={4} width={keyWidth - 8} height={(keyHeight - 8) / 2} rx={2}
                                        fill="url(#keyGlass)"
                                        pointerEvents="none"
                                    />

                                    {/* Label */}
                                    <text
                                        x={keyWidth / 2} y={keyHeight - 8}
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
};
