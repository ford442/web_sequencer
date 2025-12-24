import  { useState, useEffect, memo, useRef, useMemo } from 'react';
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

export const LiveKeyboard = memo(({ onPlayNote, onStopNote, activeTrackColor }: LiveKeyboardProps) => {
    // State to track which notes are held by which source
    const [heldByKeys, setHeldByKeys] = useState<Set<string>>(new Set());
    const [heldByMouse, setHeldByMouse] = useState<string | null>(null);

    // We use a ref to track what we *think* is currently playing externally, to avoid redundant calls
    // and ensure we stop everything we started.
    const playingNotesRef = useRef<Set<string>>(new Set());

    // Calculate the set of notes that SHOULD be playing
    const targetActiveNotes = useMemo(() => {
        const active = new Set(heldByKeys);
        if (heldByMouse) active.add(heldByMouse);
        return active;
    }, [heldByKeys, heldByMouse]);

    // Reconciliation Effect: Sync playingNotesRef with targetActiveNotes
    useEffect(() => {
        const currentlyPlaying = playingNotesRef.current;
        const target = targetActiveNotes;

        // 1. Stop notes that are no longer in target
        currentlyPlaying.forEach(note => {
            if (!target.has(note)) {
                if (onStopNote) onStopNote(note);
                currentlyPlaying.delete(note);
            }
        });

        // 2. Start notes that are in target but not playing
        target.forEach(note => {
            if (!currentlyPlaying.has(note)) {
                onPlayNote(note);
                currentlyPlaying.add(note);
            }
        });
    }, [targetActiveNotes, onPlayNote, onStopNote]);

    // --- KEYBOARD INTERACTION ---
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const note = KEY_TO_NOTE[e.code];
            if (note) {
                // Prevent default browser actions for F-keys (Help, Find, Refresh, etc.)
                e.preventDefault();

                if (!e.repeat) {
                    setHeldByKeys(prev => {
                        const next = new Set(prev);
                        next.add(note);
                        return next;
                    });
                }
            }
        };

        const handleKeyUp = (e: KeyboardEvent) => {
            const note = KEY_TO_NOTE[e.code];
            if (note) {
                e.preventDefault();
                setHeldByKeys(prev => {
                    const next = new Set(prev);
                    next.delete(note);
                    return next;
                });
            }
        };

        // Safety: Clear keys on blur to prevent stuck keys
        const handleBlur = () => {
            setHeldByKeys(new Set());
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', handleBlur);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', handleBlur);
        };
    }, []);

    // --- MOUSE INTERACTION (Glissando) ---
    useEffect(() => {
        const handleGlobalMouseUp = () => {
            setHeldByMouse(null);
        };
        // Also clear on blur/leave window if mouse button was held
        const handleBlur = () => {
            setHeldByMouse(null);
        };

        window.addEventListener('mouseup', handleGlobalMouseUp);
        window.addEventListener('blur', handleBlur);
        return () => {
             window.removeEventListener('mouseup', handleGlobalMouseUp);
             window.removeEventListener('blur', handleBlur);
        };
    }, []);

    const handleMouseDown = (note: string) => {
        setHeldByMouse(note);
    };

    const handleMouseEnter = (note: string) => {
        // Only switch notes if we are currently holding the mouse down (dragging)
        // We know we are dragging if heldByMouse is not null.
        // Note: This relies on setHeldByMouse(null) on global mouseup.
        // However, we need to check if the primary button is actually pressed.
        // But since we track state, if heldByMouse is active, we assume we are dragging.
        // To be safe against "mouse up happened outside window and we missed it",
        // we might want to check e.buttons in mouse enter, but React SyntheticEvent
        // doesn't always have it reliable on enter.
        // We'll stick to our state + global mouse up.

        if (heldByMouse !== null) {
            setHeldByMouse(note);
        }
    };

    // We don't need handleMouseUp on individual keys because global handles it,
    // but stopping propagation might be useful or just rely on state.
    // Actually, simply relying on state is cleaner.

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

                            const isActive = targetActiveNotes.has(fullNote);

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
                                    onMouseDown={(e) => {
                                        if (e.button === 0) handleMouseDown(fullNote);
                                    }}
                                    onMouseEnter={(e) => {
                                        // Optional: check e.buttons === 1 to ensure left click is held
                                        // This helps if the user released mouse outside and came back in
                                        if (e.buttons === 1) {
                                            handleMouseEnter(fullNote);
                                        } else if (heldByMouse) {
                                            // Recovery: User is not pressing button but we think they are
                                            setHeldByMouse(null);
                                        }
                                    }}
                                    onTouchStart={(e) => { e.preventDefault(); handleMouseDown(fullNote); }}
                                    // Touch end handled by clearing state if needed, or rely on global?
                                    // Touch is tricky with glissando. For now, simple touch support:
                                    onTouchEnd={(e) => { e.preventDefault(); setHeldByMouse(null); }}
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
