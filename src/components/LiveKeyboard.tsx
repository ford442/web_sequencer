import { useState, useEffect, memo, useRef, useMemo, useCallback } from 'react';
import { getNoteColor } from '../utils/noteColors';

interface LiveKeyboardProps { onPlayNote: (note: string) => void; onStopNote?: (note: string) => void; activeTrackColor: string; }

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']; 
const OCTAVES = [5, 4, 3, 2]; // Top to bottom

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

// 1. Generate Reverse Mapping for Visual Overlay
const NOTE_TO_KEY = Object.entries(KEY_TO_NOTE).reduce((acc, [keyCode, note]) => {
    acc[note] = keyCode;
    return acc;
}, {} as Record<string, string>);

// 2. Helper to format key codes for display (e.g. 'Digit9' -> '9')
const formatKeyLabel = (code: string) => {
    if (code.startsWith('Digit')) return code.replace('Digit', '');
    if (code.startsWith('Key')) return code.replace('Key', '');
    return code;
};

// PERFORMANCE: Memoized Key Component to prevent full keyboard re-renders
interface LiveKeyProps {
    note: string;
    isActive: boolean;
    isHeldByMouse: boolean;
    x: number;
    width: number;
    height: number;
    label: string | null;
    noteColor: string;
    activeColor: string; // Used for stroke/highlights
    baseColor: string;
    inactiveTint: string;
    onMouseDown: (note: string) => void;
    onMouseEnter: (note: string) => void;
    onStopMouse: () => void;
}

const LiveKey = memo(({
    note, isActive, isHeldByMouse, x, width, height, label,
    noteColor, activeColor, baseColor, inactiveTint,
    onMouseDown, onMouseEnter, onStopMouse
}: LiveKeyProps) => {
    return (
        <g
            transform={`translate(${x}, 0)`}
            role="button"
            aria-label={`Play ${note}`}
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onMouseDown(note);
                }
            }}
            onKeyUp={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onStopMouse();
                }
            }}
            onBlur={() => {
                // Safety: stop note if tabbing away while holding Enter/Space
                if (isHeldByMouse) {
                    onStopMouse();
                }
            }}
            onMouseDown={(e) => {
                if (e.button === 0) {
                    onMouseDown(note);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (e.currentTarget as any).focus();
                }
            }}
            onMouseEnter={(e) => {
                if (e.buttons === 1) {
                    onMouseEnter(note);
                } else {
                    // Check if we need to clear global state (logic delegated to parent via check,
                    // but here we just call onStopMouse if we aren't pressing anything)
                    // The parent logic was: else if (heldByMouse) setHeldByMouse(null);
                    // We can always call onStopMouse() if buttons !== 1 safely if the handler is stable.
                    onStopMouse();
                }
            }}
            onTouchStart={(e) => { e.preventDefault(); onMouseDown(note); }}
            onTouchEnd={(e) => { e.preventDefault(); onStopMouse(); }}
            cursor="pointer"
            className="focus:outline-none"
        >
            {/* Focus Ring Indicator (only visible when focused) */}
            <rect
                x={-2} y={-2} width={width + 4} height={height + 4} rx={6}
                fill="none"
                stroke="#a855f7"
                strokeWidth={2}
                opacity={0}
                className="focus-ring"
                style={{ transition: 'opacity 0.2s' }}
            />

            {/* Base / Bevel Shadow */}
            <rect width={width} height={height} rx={4} fill="#000" />

            {/* Main Body */}
            <rect
                x={1} y={1} width={width - 2} height={height - 2} rx={3}
                fill={isActive ? '#1f2e25' : baseColor}
            />

            {/* Top Highlight (Bevel) */}
            <path d={`M 2 2 L ${width - 2} 2 L ${width - 4} 4 L 4 4 Z`} fill="rgba(255,255,255,0.2)" />

            {/* Bottom Shadow (Bevel) */}
            <path d={`M 2 ${height - 2} L ${width - 2} ${height - 2} L ${width - 4} ${height - 4} L 4 ${height - 4} Z`} fill="rgba(0,0,0,0.6)" />

            {/* Inner Cap */}
            <rect
                x={3} y={3} width={width - 6} height={height - 6} rx={2}
                fill={isActive ? activeColor : inactiveTint}
                fillOpacity={isActive ? 0.6 : (note.includes('#') ? 1 : 0.12)}
                stroke={isActive ? activeColor : 'none'}
                strokeWidth={1}
            />

            {/* Glassy Shine */}
            <rect
                x={4} y={4} width={width - 8} height={(height - 8) / 2} rx={2}
                fill="url(#keyGlass)"
                pointerEvents="none"
            />

            {/* Note Name Label */}
            <text
                x={width / 2} y={height - 8}
                textAnchor="middle"
                fontSize={10}
                fontFamily="monospace"
                fontWeight="bold"
                fill={isActive ? '#fff' : noteColor}
                pointerEvents="none"
            >
                {note}
            </text>

            {/* Desktop Key Binding Overlay */}
            {label && (
                <g pointerEvents="none">
                    <rect
                        x={width / 2 - 9} y={5} width={18} height={14} rx={3}
                        fill={isActive ? '#fff' : '#000'}
                        fillOpacity={isActive ? 0.9 : 0.6}
                        stroke={isActive ? activeColor : '#444'}
                        strokeWidth={1}
                    />
                    <text
                        x={width / 2} y={15}
                        textAnchor="middle"
                        fontSize={9}
                        fontFamily="Arial, sans-serif"
                        fontWeight="bold"
                        fill={isActive ? '#000' : '#ccc'}
                    >
                        {label}
                    </text>
                </g>
            )}

            {/* Active LED Glow */}
            {isActive && (
                <rect
                    x={6} y={height - 5} width={width - 12} height={2} rx={1}
                    fill="#fff"
                    filter="drop-shadow(0 0 4px #fff)"
                />
            )}
        </g>
    );
});

export const LiveKeyboard = memo(({ onPlayNote, onStopNote, activeTrackColor }: LiveKeyboardProps) => {
    // State to track which notes are held by which source
    const [heldByKeys, setHeldByKeys] = useState<Set<string>>(new Set());
    const [heldByMouse, setHeldByMouse] = useState<string | null>(null);

    // PERFORMANCE: Use ref to track heldByMouse for stable event handlers
    const heldByMouseRef = useRef(heldByMouse);
    useEffect(() => { heldByMouseRef.current = heldByMouse; }, [heldByMouse]);

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

    // PERFORMANCE: Stable Handlers
    const handleMouseDownStable = useCallback((note: string) => {
        setHeldByMouse(note);
    }, []);

    const handleMouseEnterStable = useCallback((note: string) => {
        // Only update if we are already holding the mouse down (glissando)
        if (heldByMouseRef.current !== null) {
            setHeldByMouse(note);
        }
    }, []);

    const handleStopMouseStable = useCallback(() => {
        // Only trigger update if we actually have a note held
        if (heldByMouseRef.current !== null) {
            setHeldByMouse(null);
        }
    }, []);

    // Width calculations
    const totalWidth = 920;
    const gap = 4;
    const keyWidth = (totalWidth - (11 * gap)) / 12;
    const keyHeight = 40;
    const rowGap = 6;

    return (
        <div className="w-full max-w-[920px] mx-auto mt-4 select-none relative">
            {/* Legend / Tip */}
            <div className="absolute -top-6 right-0 text-[10px] text-gray-500 font-mono tracking-wider opacity-70">
                DESKTOP KEY BINDINGS (MIRRORED)
            </div>

            <svg viewBox={`0 0 ${totalWidth} ${keyHeight * 4 + rowGap * 3}`} className="w-full drop-shadow-lg">
                <defs>
                    <linearGradient id="keyGlass" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="white" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="white" stopOpacity="0" />
                    </linearGradient>
                    <filter id="keyGlow" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="2" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                    <style>{`
                        g:focus > .focus-ring { opacity: 1 !important; }
                    `}</style>
                </defs>

                {OCTAVES.map((octave, rowIndex) => (
                    <g key={octave} transform={`translate(0, ${rowIndex * (keyHeight + rowGap)})`}>
                        {NOTES.map((noteName, colIndex) => {
                            const fullNote = `${noteName}${octave}`;
                            const isBlack = noteName.includes('#');
                            const isActive = targetActiveNotes.has(fullNote);
                            
                            // Check for binding
                            const bindKey = NOTE_TO_KEY[fullNote];
                            const label = bindKey ? formatKeyLabel(bindKey) : null;

                            // Visuals
                            const baseColor = isBlack ? '#080a0c' : '#151a21'; 
                            const noteColor = getNoteColor(fullNote);
                            const activeColor = isActive ? noteColor : activeTrackColor;
                            const inactiveTint = isBlack ? '#0b1220' : noteColor;

                            const x = colIndex * (keyWidth + gap);

                            return (
                                <LiveKey
                                    key={fullNote}
                                    note={fullNote}
                                    isActive={isActive}
                                    isHeldByMouse={heldByMouse === fullNote}
                                    x={x}
                                    width={keyWidth}
                                    height={keyHeight}
                                    label={label}
                                    noteColor={noteColor}
                                    activeColor={activeColor}
                                    baseColor={baseColor}
                                    inactiveTint={inactiveTint}
                                    onMouseDown={handleMouseDownStable}
                                    onMouseEnter={handleMouseEnterStable}
                                    onStopMouse={handleStopMouseStable}
                                />
                            );
                        })}
                    </g>
                ))}
            </svg>
        </div>
    );
});
