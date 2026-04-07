import { useState, useEffect, memo, useRef, useMemo, useCallback } from 'react';
import { getNoteColor } from '../utils/noteColors';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface LiveKeyboardProps { onPlayNote: (note: string) => void; onStopNote?: (note: string) => void; activeTrackColor?: string; }

// Piano Layout Data - 1 Octave: C5 to C6
const BASE_OCTAVE = 5;
const WHITE_NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
// Full octave: C5-B5 naturals + C6 at the top
const ALL_NATURAL_NOTES = [...WHITE_NOTES.map(n => `${n}${BASE_OCTAVE}`), `C${BASE_OCTAVE + 1}`];
const BLACK_NOTES_MAP: Record<string, string> = {
    'C': 'C#',
    'D': 'D#',
    'F': 'F#',
    'G': 'G#',
    'A': 'A#'
};

// PC Key Mapping for 1 Octave (C5-C6)
// Naturals: F-keys descending (F8→C5 down to F1→C6)
// Accidentals: Number keys descending (9→C#5 down to 4→A#5)
const PC_KEY_MAPPING: Record<string, string> = {
    'F8': 'C5',      'Digit9': 'C#5',
    'F7': 'D5',      'Digit8': 'D#5',
    'F6': 'E5',
    'F5': 'F5',      'Digit6': 'F#5',
    'F4': 'G5',      'Digit5': 'G#5',
    'F3': 'A5',      'Digit4': 'A#5',
    'F2': 'B5',
    'F1': 'C6',
};

const NOTE_TO_KEY = Object.entries(PC_KEY_MAPPING).reduce((acc, [keyCode, note]) => {
    acc[note] = keyCode;
    return acc;
}, {} as Record<string, string>);

const formatKeyLabel = (code: string) => {
    if (code.startsWith('Digit')) return code.replace('Digit', '');
    if (code.startsWith('Key')) return code.replace('Key', '');
    if (code === 'BracketLeft') return '[';
    if (code === 'Minus') return '-';
    if (code === 'Equal') return '=';
    return code;
};

// Note display names with colors
const NOTE_COLORS: Record<string, string> = {
    'C': '#ef4444',   // Red
    'C#': '#f97316',  // Orange
    'D': '#eab308',   // Yellow
    'D#': '#22c55e',  // Green
    'E': '#06b6d4',   // Cyan
    'F': '#3b82f6',   // Blue
    'F#': '#6366f1',  // Indigo
    'G': '#a855f7',   // Purple
    'G#': '#d946ef',  // Magenta
    'A': '#f43f5e',   // Rose
    'A#': '#fb7185',  // Pink
    'B': '#14b8a6',   // Teal
};

const getNoteBase = (note: string) => note.replace(/\d/, '');

// --- KEYBOARD GUIDE COMPONENT ---
const KeyboardGuide = ({ onClose }: { onClose: () => void }) => {
    const guideRef = useFocusTrap<HTMLDivElement>(true, onClose);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fadeIn" onClick={onClose}>
            <div role="dialog" aria-modal="true" aria-labelledby="keyboard-guide-title" ref={guideRef} className="relative p-8 border-2 border-dashed border-cyan-500/50 rounded-2xl bg-[#0d1015] shadow-[0_0_50px_rgba(6,182,212,0.15)] max-w-2xl w-full mx-4" onClick={e => e.stopPropagation()}>
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors" aria-label="Close guide" title="Close Guide">✕</button>
                <div className="text-center mb-8">
                    <h3 id="keyboard-guide-title" className="text-2xl font-orbitron font-bold text-cyan-400 mb-2 tracking-widest">PIANO MODE</h3>
                    <p className="text-gray-400 font-mono text-sm">1 Octave: C5 to C6. Sharps (top row, staggered) = 9–4. Naturals (bottom row) = F8–F1.</p>
                </div>

                {/* Visual Schematic */}
                <div className="flex justify-center mb-8">
                    <svg width="320" height="180" viewBox="0 0 320 180" className="drop-shadow-2xl">
                        <rect x="10" y="10" width="300" height="160" rx="10" fill="none" stroke="#334155" strokeWidth="2" strokeDasharray="5,5" />

                        {/* Accidental keys row (TOP, offset by ½ key width) */}
                        <g transform="translate(39, 25)">
                            <text x="-8" y="15" fill="#06b6d4" fontSize="9" fontFamily="monospace" textAnchor="end">SHARPS</text>
                            {['9','8','6','5','4'].map((num, i) => (
                                <g key={num} transform={`translate(${i * 50}, 0)`}>
                                    <rect width="36" height="28" rx="3" fill="#0f172a" stroke="#06b6d4" strokeWidth="2" />
                                    <text x="18" y="18" textAnchor="middle" fill="#fff" fontWeight="bold" fontSize="11" fontFamily="monospace">{num}</text>
                                </g>
                            ))}
                        </g>

                        {/* Natural keys row (BOTTOM) */}
                        <g transform="translate(22, 90)">
                            <text x="-8" y="20" fill="#94a3b8" fontSize="9" fontFamily="monospace" textAnchor="end">NATURALS</text>
                            {['F8','F7','F6','F5','F4','F3','F2','F1'].map((key, i) => (
                                <g key={key} transform={`translate(${i * 34}, 0)`}>
                                    <rect width="30" height="40" rx="3" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1" />
                                    <text x="15" y="25" textAnchor="middle" fill="#0f172a" fontWeight="bold" fontSize="9" fontFamily="monospace">{key}</text>
                                </g>
                            ))}
                        </g>
                    </svg>
                </div>

                <div className="text-center">
                    <button onClick={onClose} className="px-6 py-2 bg-cyan-900/30 hover:bg-cyan-800/50 text-cyan-300 border border-cyan-700/50 rounded font-orbitron text-xs tracking-wider transition-all" aria-label="Acknowledge and close guide" title="Acknowledge and close guide">GOT IT</button>
                </div>
            </div>
        </div>
    );
};

// --- PIANO KEY COMPONENT ---
interface PianoKeyProps {
    note: string;
    type: 'white' | 'black';
    isActive: boolean;
    isHeldByMouse: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
    label: string | null;
    activeColor: string;
    onMouseDown: (note: string) => void;
    onMouseEnter: (note: string) => void;
    onStopMouse: () => void;
}

const PianoKey = memo(({
    note, type, isActive, x, y, width, height, label,
    activeColor, onMouseDown, onMouseEnter, onStopMouse
}: PianoKeyProps) => {
    const isBlack = type === 'black';
    const noteBase = getNoteBase(note);
    const noteColor = NOTE_COLORS[noteBase] || '#94a3b8';

    // 3D Faux-plastic styling
    const baseColor = isBlack ? '#1a1a2e' : '#f1f5f9';
    const sideColor = isBlack ? '#0f0f1a' : '#cbd5e1';
    const topColor = isBlack ? '#252542' : '#ffffff';
    
    // Active state with glow
    const glowColor = isActive ? activeColor : noteColor;
    const keyOpacity = isActive ? 1 : 0.95;
    const pressOffset = isActive ? 4 : 0;

    return (
        <g
            transform={`translate(${x}, ${y})`}
            role="button"
            aria-label={`Play ${note}`}
            tabIndex={0}
            onMouseDown={(e) => { if (e.button === 0) onMouseDown(note); }}
            onMouseEnter={(e) => { if (e.buttons === 1) onMouseEnter(note); else onStopMouse(); }}
            onMouseUp={onStopMouse}
            onMouseLeave={onStopMouse}
            onTouchStart={(e) => { e.preventDefault(); onMouseDown(note); }}
            onTouchEnd={(e) => { e.preventDefault(); onStopMouse(); }}
            cursor="pointer"
            className="focus:outline-none"
        >
            {/* Shadow underneath */}
            <rect 
                x={2} 
                y={height - 6 + pressOffset} 
                width={width - 4} 
                height={6} 
                rx={isBlack ? 3 : 4} 
                fill="#000" 
                opacity={0.5} 
            />
            
            <g transform={`translate(0, ${pressOffset})`} style={{ transition: 'transform 0.03s ease-out' }}>
                {/* Key body (sides - 3D thickness) */}
                <rect 
                    x={0} 
                    y={0} 
                    width={width} 
                    height={height} 
                    rx={isBlack ? 3 : 4} 
                    fill={sideColor}
                />
                
                {/* Key face (main surface) */}
                <rect 
                    x={2} 
                    y={2} 
                    width={width - 4} 
                    height={height - 8} 
                    rx={isBlack ? 2 : 3} 
                    fill={isActive ? activeColor : baseColor}
                    opacity={keyOpacity}
                />

                {/* Chromatic color tint (note identity visible on key face) */}
                {!isActive && (
                    <rect 
                        x={2} 
                        y={2} 
                        width={width - 4} 
                        height={height - 8} 
                        rx={isBlack ? 2 : 3} 
                        fill={noteColor} 
                        opacity={isBlack ? 0.35 : 0.15}
                    />
                )}

                {/* Specular highlight (top edge for 3D effect) */}
                <rect 
                    x={4} 
                    y={3} 
                    width={width - 8} 
                    height={3} 
                    rx={1} 
                    fill="rgba(255,255,255,0.6)"
                    opacity={isBlack ? 0.3 : 0.8}
                />

                {/* LED rim glow when active */}
                {isActive && (
                    <rect 
                        x={2} 
                        y={2} 
                        width={width - 4} 
                        height={height - 8} 
                        rx={isBlack ? 2 : 3} 
                        fill="transparent" 
                        stroke={glowColor}
                        strokeWidth={3}
                        style={{ filter: `drop-shadow(0 0 12px ${glowColor}) drop-shadow(0 0 4px #fff)` }}
                    />
                )}

                {/* Note name (large, centered, colored) */}
                <text 
                    x={width / 2} 
                    y={isBlack ? height / 2 + 4 : height / 2 + 6} 
                    fill={isActive ? '#fff' : (isBlack ? '#e2e8f0' : noteColor)}
                    fontSize={isBlack ? 14 : 18} 
                    fontWeight="bold"
                    textAnchor="middle" 
                    pointerEvents="none"
                    style={{ textShadow: isActive ? '0 0 8px rgba(255,255,255,0.8)' : 'none' }}
                >
                    {note}
                </text>

                {/* PC Key label (small, at bottom) */}
                {label && (
                    <text 
                        x={width / 2} 
                        y={height - (isBlack ? 8 : 10)} 
                        fill={isBlack ? '#94a3b8' : '#64748b'}
                        fontSize={isBlack ? 8 : 10} 
                        textAnchor="middle" 
                        fontFamily="monospace"
                        fontWeight="bold"
                        pointerEvents="none"
                        opacity={0.9}
                    >
                        {label}
                    </text>
                )}
            </g>
        </g>
    );
});

export const LiveKeyboard = memo(({ onPlayNote, onStopNote, activeTrackColor: _activeTrackColor }: LiveKeyboardProps) => {
    const [heldByKeys, setHeldByKeys] = useState<Set<string>>(new Set());
    const [heldByMouse, setHeldByMouse] = useState<string | null>(null);
    const [showGuide, setShowGuide] = useState(false);

    const heldByMouseRef = useRef(heldByMouse);
    useEffect(() => { heldByMouseRef.current = heldByMouse; }, [heldByMouse]);

    const playingNotesRef = useRef<Set<string>>(new Set());

    const targetActiveNotes = useMemo(() => {
        const active = new Set(heldByKeys);
        if (heldByMouse) active.add(heldByMouse);
        return active;
    }, [heldByKeys, heldByMouse]);

    useEffect(() => {
        const currentlyPlaying = playingNotesRef.current;
        const target = targetActiveNotes;

        currentlyPlaying.forEach(note => {
            if (!target.has(note)) {
                if (onStopNote) onStopNote(note);
                currentlyPlaying.delete(note);
            }
        });

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
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            const note = PC_KEY_MAPPING[e.code];
            if (note && !e.repeat) {
                e.preventDefault();
                setHeldByKeys(prev => new Set(prev).add(note));
            }
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            const note = PC_KEY_MAPPING[e.code];
            if (note) {
                e.preventDefault();
                setHeldByKeys(prev => {
                    const next = new Set(prev);
                    next.delete(note);
                    return next;
                });
            }
        };
        const handleBlur = () => setHeldByKeys(new Set());

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        window.addEventListener('blur', handleBlur);

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
            window.removeEventListener('blur', handleBlur);
        };
    }, []);

    // --- MOUSE EVENT HANDLERS ---
    const handleMouseDownStable = useCallback((note: string) => setHeldByMouse(note), []);
    const handleMouseEnterStable = useCallback((note: string) => {
        if (heldByMouseRef.current !== null) setHeldByMouse(note);
    }, []);
    const handleStopMouseStable = useCallback(() => setHeldByMouse(null), []);

    // --- REAL PIANO LAYOUT (sharps/black keys top, naturals/white keys bottom) ---
    // Black keys sit on top, staggered between white keys like a real piano
    const totalWidth = 800;
    const numNaturalKeys = ALL_NATURAL_NOTES.length; // 8 natural keys (C5-B5 + C6)
    const naturalKeyWidth = totalWidth / numNaturalKeys;
    const naturalKeyHeight = 85;
    const rowGap = 0; // Overlapping layout like real piano
    const accidentalKeyWidth = naturalKeyWidth * 0.65;
    const accidentalKeyHeight = 55;

    const naturalKeys: Array<{note: string; x: number; y: number; width: number; height: number; type: 'white' | 'black'}> = [];
    const accidentalKeys: Array<{note: string; x: number; y: number; width: number; height: number; type: 'white' | 'black'}> = [];

    ALL_NATURAL_NOTES.forEach((fullNote, natIdx) => {
        const x = natIdx * naturalKeyWidth;
        const noteName = getNoteBase(fullNote);
        const octave = fullNote.replace(/[A-G]#?/, '');

        naturalKeys.push({
            note: fullNote,
            x,
            y: accidentalKeyHeight - 15, // White keys lower, partially overlapped by black keys
            width: naturalKeyWidth - 2,
            height: naturalKeyHeight,
            type: 'white'
        });

        // Only add accidentals within the octave (skip C6 which is just the top boundary)
        if (BLACK_NOTES_MAP[noteName] && natIdx < ALL_NATURAL_NOTES.length - 1) {
            const accNote = `${BLACK_NOTES_MAP[noteName]}${octave}`;
            const accX = (natIdx + 1) * naturalKeyWidth - accidentalKeyWidth / 2;
            accidentalKeys.push({
                note: accNote,
                x: accX,
                y: 0, // Black keys on top
                width: accidentalKeyWidth,
                height: accidentalKeyHeight,
                type: 'black'
            });
        }
    });

    const svgHeight = accidentalKeyHeight + naturalKeyHeight - 5;

    return (
        <div className="w-full max-w-[820px] mx-auto mt-4 select-none relative">
            {/* PIANO LAYOUT INFO Banner */}
            <div className="absolute -top-7 right-0 flex items-center gap-2 z-40">
                <button onClick={() => setShowGuide(true)} title="Show Keyboard Layout Guide" className="flex items-center gap-1 text-[10px] text-cyan-500/80 hover:text-cyan-400 font-mono tracking-wider px-2 py-1 rounded border border-cyan-900/30 bg-black/20 hover:bg-black/40 transition-all">
                    <span className="text-xs">⌨</span> PIANO LAYOUT INFO
                </button>
            </div>

            {showGuide && <KeyboardGuide onClose={() => setShowGuide(false)} />}

            {/* Real Piano Keyboard SVG: black keys (sharps) on top, white keys (naturals) on bottom */}
            <svg viewBox={`0 0 ${totalWidth} ${svgHeight}`} className="w-full drop-shadow-2xl bg-black/20 rounded-lg p-2">
                {/* Render black keys first (bottom layer) */}
                {accidentalKeys.map(k => (
                    <PianoKey
                        key={k.note}
                        {...k}
                        label={NOTE_TO_KEY[k.note] ? formatKeyLabel(NOTE_TO_KEY[k.note]) : null}
                        isActive={targetActiveNotes.has(k.note)}
                        isHeldByMouse={heldByMouse === k.note}
                        activeColor={getNoteColor(k.note)}
                        onMouseDown={handleMouseDownStable}
                        onMouseEnter={handleMouseEnterStable}
                        onStopMouse={handleStopMouseStable}
                    />
                ))}

                {/* Render white keys on top */}
                {naturalKeys.map(k => (
                    <PianoKey
                        key={k.note}
                        {...k}
                        label={NOTE_TO_KEY[k.note] ? formatKeyLabel(NOTE_TO_KEY[k.note]) : null}
                        isActive={targetActiveNotes.has(k.note)}
                        isHeldByMouse={heldByMouse === k.note}
                        activeColor={getNoteColor(k.note)}
                        onMouseDown={handleMouseDownStable}
                        onMouseEnter={handleMouseEnterStable}
                        onStopMouse={handleStopMouseStable}
                    />
                ))}
            </svg>
        </div>
    );
});
