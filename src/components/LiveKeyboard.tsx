import { useState, useEffect, memo, useRef, useMemo, useCallback } from 'react';
import { getNoteColor } from '../utils/noteColors';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface LiveKeyboardProps { onPlayNote: (note: string) => void; onStopNote?: (note: string) => void; activeTrackColor: string; }

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Configuration for standard piano layout
// Top Visual Row (Naturals): F-Keys
// Bottom Visual Row (Accidentals): Digit keys
const KEY_TO_NOTE: Record<string, string> = {
    // --- Naturals (F-Keys = white keys) ---
    'F8': 'C4',
    'F7': 'D4',
    'F6': 'E4',
    'F5': 'F4',
    'F4': 'G4',
    'F3': 'A4',
    'F2': 'B4',
    'F1': 'C5',

    // --- Accidentals (Digit keys = black keys) ---
    'Digit9': 'C#4',   // between F8(C4) and F7(D4)
    'Digit8': 'D#4',   // between F7(D4) and F6(E4)
    // Digit7 = gap (no E#)
    'Digit6': 'F#4',   // between F5(F4) and F4(G4)
    'Digit5': 'G#4',   // between F4(G4) and F3(A4)
    'Digit4': 'A#4',   // between F3(A4) and F2(B4)
    // Digit3 = gap (no B#)
    'Digit2': 'C#5',   // between F1(C5) and next D5
};

// 1. Generate Reverse Mapping for Visual Overlay
const NOTE_TO_KEY = Object.entries(KEY_TO_NOTE).reduce((acc, [keyCode, note]) => {
    acc[note] = keyCode;
    return acc;
}, {} as Record<string, string>);

const NATURALS = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const ACCIDENTALS = ['C#4', 'D#4', 'F#4', 'G#4', 'A#4', 'C#5'];

// 2. Helper to format key codes for display (e.g. 'Digit9' -> '9')
const formatKeyLabel = (code: string) => {
    if (code.startsWith('Digit')) return code.replace('Digit', '');
    if (code.startsWith('Key')) return code.replace('Key', '');
    if (code === 'Minus') return '-';
    if (code === 'Equal') return '=';
    return code;
};

// --- KEYBOARD GUIDE COMPONENT ---
const KeyboardGuide = ({ onClose }: { onClose: () => void }) => {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const modalRef = useFocusTrap(true, onClose, buttonRef);

    return (
        <div
            className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 backdrop-blur-sm rounded-xl animate-fadeIn"
            onClick={onClose}
        >
            <div
                ref={modalRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="keyboard-guide-title"
                className="relative p-8 border-2 border-dashed border-cyan-500/50 rounded-2xl bg-[#0d1015] shadow-[0_0_50px_rgba(6,182,212,0.15)] max-w-2xl w-full mx-4 outline-none"
                onClick={e => e.stopPropagation()}
                tabIndex={-1}
            >
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors focus:outline-none focus:text-white"
                    aria-label="Close Guide"
                >
                    ✕
                </button>

                <div className="text-center mb-8">
                    <h3 id="keyboard-guide-title" className="text-2xl font-orbitron font-bold text-cyan-400 mb-2 tracking-widest">PIANO MODE</h3>
                    <p className="text-gray-400 font-mono text-sm">F-keys = white keys (naturals) · Digit keys = black keys (accidentals)</p>
                </div>

                <div className="flex justify-center mb-8">
                    {/* Schematic Drawing */}
                    <svg width="400" height="220" viewBox="0 0 400 220" className="drop-shadow-2xl">
                        {/* Keyboard Outline */}
                        <rect x="10" y="10" width="380" height="200" rx="10" fill="none" stroke="#334155" strokeWidth="2" strokeDasharray="5,5" />

                        {/* Connection Lines (Abstract) */}
                        <path d="M 60 80 L 340 80" stroke="#334155" strokeWidth="1" strokeDasharray="2,2" />

                        {/* F-Key Row (Top Visual - White Keys / Naturals) */}
                        <g transform="translate(40, 90)">
                            <text x="-25" y="20" fill="#94a3b8" fontSize="10" fontFamily="monospace" textAnchor="end">F-KEYS</text>
                            <text x="-25" y="32" fill="#fff" fontSize="9" fontFamily="monospace" textAnchor="end">(Naturals)</text>
                            {[8, 7, 6, 5, 4, 3, 2, 1].map((num, i) => (
                                <g key={num} transform={`translate(${i * 40}, 0)`}>
                                    <rect width="32" height="32" rx="4" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1" />
                                    <text x="16" y="20" textAnchor="middle" fill="#0f172a" fontWeight="bold" fontSize="12" fontFamily="monospace">F{num}</text>
                                </g>
                            ))}
                        </g>

                        {/* Digit Row (Bottom Visual - Black Keys / Accidentals) */}
                        <g transform="translate(40, 150)">
                            <text x="-25" y="20" fill="#94a3b8" fontSize="10" fontFamily="monospace" textAnchor="end">DIGITS</text>
                            <text x="-25" y="32" fill="#06b6d4" fontSize="9" fontFamily="monospace" textAnchor="end">(Accidentals)</text>
                            {[
                                { label: '9', offset: 0 },
                                { label: '8', offset: 1 },
                                { label: '—', offset: 2, gap: true },
                                { label: '6', offset: 3 },
                                { label: '5', offset: 4 },
                                { label: '4', offset: 5 },
                                { label: '—', offset: 6, gap: true },
                                { label: '2', offset: 7 },
                            ].map(({ label, offset, gap }) => (
                                <g key={label + offset} transform={`translate(${offset * 40}, 0)`}>
                                    <rect width="32" height="32" rx="4" fill={gap ? '#1e293b' : '#0f172a'} stroke={gap ? '#334155' : '#06b6d4'} strokeWidth={gap ? 1 : 2} />
                                    <text x="16" y="20" textAnchor="middle" fill={gap ? '#334155' : '#fff'} fontWeight="bold" fontSize={gap ? 16 : 14} fontFamily="monospace">{label}</text>
                                </g>
                            ))}
                        </g>
                    </svg>
                </div>

                <div className="text-center">
                    <button
                        ref={buttonRef}
                        onClick={onClose}
                        className="px-6 py-2 bg-cyan-900/30 hover:bg-cyan-800/50 text-cyan-300 border border-cyan-700/50 rounded font-orbitron text-xs tracking-wider transition-all focus:outline-none focus:ring-2 focus:ring-cyan-500"
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
    className?: string;
    style?: React.CSSProperties;
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
    note, isActive, isHeldByMouse, className, style, label,
    noteColor, activeColor, baseColor, inactiveTint,
    onMouseDown, onMouseEnter, onStopMouse
}: LiveKeyProps) => {
    return (
        <div
            className={`relative select-none focus:outline-none ${className}`}
            style={{ ...style, cursor: 'pointer' }}
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
                    e.currentTarget.focus();
                }
            }}
            onMouseEnter={(e) => {
                if (e.buttons === 1) {
                    onMouseEnter(note);
                } else {
                    onStopMouse();
                }
            }}
            onTouchStart={(e) => { e.preventDefault(); onMouseDown(note); }}
            onTouchEnd={(e) => { e.preventDefault(); onStopMouse(); }}
        >
            <svg viewBox="0 0 100 60" preserveAspectRatio="none" className="w-full h-full block drop-shadow-sm overflow-visible">
                <defs>
                    <linearGradient id={`keyGlass-${note.replace('#', 'S')}`} x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="white" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="white" stopOpacity="0" />
                    </linearGradient>
                    <filter id={`keyGlow-${note.replace('#', 'S')}`} x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="2" result="blur" />
                        <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                    <style>{`
                        .focus-ring { opacity: 0; transition: opacity 0.2s; }
                        div:focus > svg .focus-ring { opacity: 1; }
                    `}</style>
                </defs>

                {/* Focus Ring Indicator */}
                <rect
                    x={-2} y={-2} width={104} height={64} rx={6}
                    fill="none"
                    stroke="#a855f7"
                    strokeWidth={2}
                    className="focus-ring"
                />

                {/* Base / Bevel Shadow */}
                <rect width={100} height={60} rx={4} fill="#000" />

                {/* Main Body */}
                <rect
                    x={1} y={1} width={98} height={58} rx={3}
                    fill={isActive ? '#1f2e25' : baseColor}
                />

                {/* Top Highlight (Bevel) */}
                <path d="M 2 2 L 98 2 L 96 4 L 4 4 Z" fill="rgba(255,255,255,0.2)" />

                {/* Bottom Shadow (Bevel) */}
                <path d="M 2 58 L 98 58 L 96 56 L 4 56 Z" fill="rgba(0,0,0,0.6)" />

                {/* Inner Cap */}
                <rect
                    x={3} y={3} width={94} height={54} rx={2}
                    fill={isActive ? activeColor : inactiveTint}
                    fillOpacity={isActive ? 0.6 : (note.includes('#') ? 1 : 0.12)}
                    stroke={isActive ? activeColor : 'none'}
                    strokeWidth={1}
                />

                {/* Glassy Shine */}
                <rect
                    x={4} y={4} width={92} height={26} rx={2}
                    fill={`url(#keyGlass-${note.replace('#', 'S')})`}
                    pointerEvents="none"
                />

                {/* Note Name Label */}
                <text
                    x={50} y={52}
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
                            x={41} y={5} width={18} height={14} rx={3}
                            fill={isActive ? '#fff' : '#000'}
                            fillOpacity={isActive ? 0.9 : 0.6}
                            stroke={isActive ? activeColor : '#444'}
                            strokeWidth={1}
                        />
                        <text
                            x={50} y={15}
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
                        x={6} y={55} width={88} height={2} rx={1}
                        fill="#fff"
                        filter="drop-shadow(0 0 4px #fff)"
                    />
                )}
            </svg>
        </div>
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
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                return;
            }
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
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                return;
            }
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

    const getNoteIndex = (note: string) => {
        const name = note.slice(0, -1);
        const octave = parseInt(note.slice(-1));
        return NOTES.indexOf(name) + (octave - 4) * 12;
    };

    const renderKey = (fullNote: string, rowIndex: number) => {
        const isBlack = fullNote.includes('#');
        const isActive = targetActiveNotes.has(fullNote);
        const bindKey = NOTE_TO_KEY[fullNote];
        const label = bindKey ? formatKeyLabel(bindKey) : null;
        const noteColor = getNoteColor(fullNote);
        const baseColor = isBlack ? '#080a0c' : '#151a21';
        const activeColor = isActive ? noteColor : activeTrackColor;
        const inactiveTint = isBlack ? '#0b1220' : noteColor;

        const colIndex = getNoteIndex(fullNote);
        const gridColumn = `${colIndex + 1} / span 2`;

        return (
            <LiveKey
                key={fullNote}
                note={fullNote}
                isActive={isActive}
                isHeldByMouse={heldByMouse === fullNote}
                className="h-14"
                style={{ gridColumn, gridRow: rowIndex }}
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
    };

    return (
        <div className="w-full max-w-[920px] mx-auto mt-4 select-none relative">
            {/* Guide Toggle */}
            <div className="absolute -top-7 right-0 flex items-center gap-2 z-40">
                <button
                    onClick={() => setShowGuide(true)}
                    className="flex items-center gap-1 text-[10px] text-cyan-500/80 hover:text-cyan-400 font-mono tracking-wider px-2 py-1 rounded border border-cyan-900/30 bg-black/20 hover:bg-black/40 transition-all"
                    title="Show Keyboard Layout Guide"
                >
                    <span className="text-xs">⌨</span> KEYBOARD LAYOUT INFO
                </button>
            </div>

            {/* Guide Overlay */}
            {showGuide && <KeyboardGuide onClose={() => setShowGuide(false)} />}

            <div
                className="grid gap-y-1.5"
                style={{
                    gridTemplateColumns: 'repeat(22, minmax(0, 1fr))',
                    gridTemplateRows: 'repeat(2, 56px)'
                }}
            >
                {/* Row 1: Naturals */}
                {NATURALS.map(note => renderKey(note, 1))}

                {/* Row 2: Accidentals */}
                {ACCIDENTALS.map(note => renderKey(note, 2))}
            </div>
        </div>
    );
});
