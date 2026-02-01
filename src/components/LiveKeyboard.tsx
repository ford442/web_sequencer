import { useState, useEffect, memo, useRef, useMemo, useCallback } from 'react';
import { getNoteColor } from '../utils/noteColors';

interface LiveKeyboardProps { onPlayNote: (note: string) => void; onStopNote?: (note: string) => void; activeTrackColor: string; }

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']; 
const OCTAVES = [5, 4, 3, 2]; // Top to bottom

// Configuration for "Chromatic Zig-Zag" style playing
const KEY_TO_NOTE: Record<string, string> = {
    // --- Col 1 ---
    'F1':     'C4',
    'Digit1': 'C#4',

    // --- Col 2 ---
    'F2':     'D4',
    'Digit2': 'D#4',

    // --- Col 3 ---
    'F3':     'E4',
    'Digit3': 'F4', // E->F is semitone

    // --- Col 4 ---
    'F4':     'F#4',
    'Digit4': 'G4',

    // --- Col 5 ---
    'F5':     'G#4',
    'Digit5': 'A4',

    // --- Col 6 ---
    'F6':     'A#4',
    'Digit6': 'B4',

    // --- Col 7 (Next Octave) ---
    'F7':     'C5',
    'Digit7': 'C#5',

    // --- Col 8 ---
    'F8':     'D5',
    'Digit8': 'D#5',
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

// --- KEYBOARD GUIDE COMPONENT ---
const KeyboardGuide = ({ onClose }: { onClose: () => void }) => {
    return (
        <div
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 backdrop-blur-sm rounded-xl animate-fadeIn"
            onClick={onClose}
        >
            <div className="relative p-8 border-2 border-dashed border-cyan-500/50 rounded-2xl bg-[#0d1015] shadow-[0_0_50px_rgba(6,182,212,0.15)] max-w-2xl w-full mx-4" onClick={e => e.stopPropagation()}>
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
                    aria-label="Close Guide"
                >
                    ✕
                </button>

                <div className="text-center mb-8">
                    <h3 className="text-2xl font-orbitron font-bold text-cyan-400 mb-2 tracking-widest">FLIPPED MODE</h3>
                    <p className="text-gray-400 font-mono text-sm">Rotate your physical keyboard 180° to play chromatically.</p>
                </div>

                <div className="flex justify-center mb-8">
                    {/* Schematic Drawing */}
                    <svg width="400" height="220" viewBox="0 0 400 220" className="drop-shadow-2xl">
                        {/* Keyboard Outline (Flipped) */}
                        <rect x="10" y="10" width="380" height="200" rx="10" fill="none" stroke="#334155" strokeWidth="2" strokeDasharray="5,5" />

                        {/* Spacebar Area (Top because flipped) */}
                        <rect x="80" y="25" width="240" height="30" rx="4" fill="#1e293b" stroke="#334155" strokeWidth="1" />
                        <text x="200" y="44" textAnchor="middle" fill="#475569" fontSize="10" fontFamily="monospace">SPACEBAR (TOP)</text>

                        {/* Connection Lines (Abstract) */}
                        <path d="M 60 80 L 340 80" stroke="#334155" strokeWidth="1" strokeDasharray="2,2" />

                        {/* Digit Row (Middle - Acts as Black Keys) */}
                        <g transform="translate(40, 100)">
                            <text x="-25" y="20" fill="#94a3b8" fontSize="10" fontFamily="monospace" textAnchor="end">DIGITS</text>
                            <text x="-25" y="32" fill="#06b6d4" fontSize="9" fontFamily="monospace" textAnchor="end">(Sharps)</text>
                            {[1, 2, 3, 4, 5, 6, 7, 8].map((num, i) => (
                                <g key={num} transform={`translate(${i * 40}, 0)`}>
                                    <rect width="32" height="32" rx="4" fill="#0f172a" stroke="#06b6d4" strokeWidth="2" />
                                    <text x="16" y="20" textAnchor="middle" fill="#fff" fontWeight="bold" fontSize="14" fontFamily="monospace">{num}</text>
                                </g>
                            ))}
                        </g>

                        {/* F-Key Row (Bottom - Acts as White Keys) */}
                        <g transform="translate(40, 150)">
                            <text x="-25" y="20" fill="#94a3b8" fontSize="10" fontFamily="monospace" textAnchor="end">F-KEYS</text>
                            <text x="-25" y="32" fill="#fff" fontSize="9" fontFamily="monospace" textAnchor="end">(Naturals)</text>
                            {[1, 2, 3, 4, 5, 6, 7, 8].map((num, i) => (
                                <g key={num} transform={`translate(${i * 40}, 0)`}>
                                    <rect width="32" height="32" rx="4" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1" />
                                    <text x="16" y="20" textAnchor="middle" fill="#0f172a" fontWeight="bold" fontSize="12" fontFamily="monospace">F{num}</text>
                                </g>
                            ))}
                        </g>
                    </svg>
                </div>

                <div className="text-center">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-cyan-900/30 hover:bg-cyan-800/50 text-cyan-300 border border-cyan-700/50 rounded font-orbitron text-xs tracking-wider transition-all"
                    >
                        GOT IT
                    </button>
                </div>
            </div>
        </div>
    );
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
    const [showGuide, setShowGuide] = useState(false);

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
            {/* Guide Toggle */}
            <div className="absolute -top-7 right-0 flex items-center gap-2 z-40">
                <button
                    onClick={() => setShowGuide(true)}
                    className="flex items-center gap-1 text-[10px] text-cyan-500/80 hover:text-cyan-400 font-mono tracking-wider px-2 py-1 rounded border border-cyan-900/30 bg-black/20 hover:bg-black/40 transition-all"
                    title="Show Keyboard Layout Guide"
                >
                    <span className="text-xs">⌨</span> FLIPPED LAYOUT INFO
                </button>
            </div>

            {/* Guide Overlay */}
            {showGuide && <KeyboardGuide onClose={() => setShowGuide(false)} />}

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
