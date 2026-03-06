import { useState, useEffect, memo, useRef, useMemo, useCallback } from 'react';
import { getNoteColor } from '../utils/noteColors';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface LiveKeyboardProps { onPlayNote: (note: string) => void; onStopNote?: (note: string) => void; activeTrackColor?: string; }

// Piano Layout Data - 2 Octaves: C5 to B6
const OCTAVES = [5, 6];
const WHITE_NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const BLACK_NOTES_MAP: Record<string, string> = {
    'C': 'C#',
    'D': 'D#',
    'F': 'F#',
    'G': 'G#',
    'A': 'A#'
};

// PC Key Mapping for 2 Octaves (C5-B6)
// White keys: F7-F12, 7-0 (with shifts for the gap between F12 and 7)
// Black keys: numbers row above
const KEY_TO_NOTE: Record<string, string> = {
    // Octave 5 (C5-B5)
    'F7': 'C5', 'Digit7': 'C#5',
    'F8': 'D5', 'Digit8': 'D#5', 
    'F9': 'E5',
    'F10': 'F5', 'Digit9': 'F#5',
    'F11': 'G5', 'Digit0': 'G#5',
    'F12': 'A5', 'Minus': 'A#5',
    'Digit0': 'B5', // Using 0 key for B5 (shifted)
    
    // Octave 6 (C6-B6) - using number row and letter keys
    'KeyQ': 'C6', 'Digit2': 'C#6',
    'KeyW': 'D6', 'Digit3': 'D#6',
    'KeyE': 'E6',
    'KeyR': 'F6', 'Digit5': 'F#6',
    'KeyT': 'G6', 'Digit6': 'G#6',
    'KeyY': 'A6', 'Digit7': 'A#6', // Digit7 is already used... let me reconsider
};

// Better mapping - F-keys for octave 5, number/letter row for octave 6
const PC_KEY_MAPPING: Record<string, string> = {
    // First Octave (C5-B5) - Function keys row + number row
    'F7': 'C5',      'Digit7': 'C#5',
    'F8': 'D5',      'Digit8': 'D#5',
    'F9': 'E5',
    'F10': 'F5',     'Digit9': 'F#5', 
    'F11': 'G5',     'Digit0': 'G#5',
    'F12': 'A5',     'Minus': 'A#5',
    'BracketLeft': 'B5',  // [ key for B5
    
    // Second Octave (C6-B6) - QWERTY row + number row shifted
    'KeyQ': 'C6',    'Digit2': 'C#6',
    'KeyW': 'D6',    'Digit3': 'D#6', 
    'KeyE': 'E6',
    'KeyR': 'F6',    'Digit5': 'F#6',
    'KeyT': 'G6',    'Digit6': 'G#6',
    'KeyY': 'A6',    'Equal': 'A#6',  // = key for A#6
    'KeyU': 'B6',
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
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors" aria-label="Close guide">✕</button>
                <div className="text-center mb-8">
                    <h3 id="keyboard-guide-title" className="text-2xl font-orbitron font-bold text-cyan-400 mb-2 tracking-widest">PIANO MODE</h3>
                    <p className="text-gray-400 font-mono text-sm">2 Octaves: C5 to B6. White keys = F-keys + QWERTY row. Black keys = Number row.</p>
                </div>
                
                {/* Visual Schematic */}
                <div className="flex justify-center mb-8">
                    <svg width="420" height="180" viewBox="0 0 420 180" className="drop-shadow-2xl">
                        <rect x="10" y="10" width="400" height="160" rx="10" fill="none" stroke="#334155" strokeWidth="2" strokeDasharray="5,5" />
                        
                        {/* Black keys row */}
                        <g transform="translate(30, 30)">
                            <text x="-15" y="15" fill="#06b6d4" fontSize="9" fontFamily="monospace" textAnchor="end">SHARPS</text>
                            {['7','8','9','0','-','2','3','5','6','='].map((num, i) => (
                                <g key={num} transform={`translate(${i * 38}, 0)`}>
                                    <rect width="32" height="28" rx="3" fill="#0f172a" stroke="#06b6d4" strokeWidth="2" />
                                    <text x="16" y="18" textAnchor="middle" fill="#fff" fontWeight="bold" fontSize="12" fontFamily="monospace">{num}</text>
                                </g>
                            ))}
                        </g>

                        {/* White keys row */}
                        <g transform="translate(30, 80)">
                            <text x="-15" y="20" fill="#fff" fontSize="9" fontFamily="monospace" textAnchor="end">NATURALS</text>
                            {['F7','F8','F9','F10','F11','F12','[','Q','W','E','R','T','Y','U'].map((key, i) => (
                                <g key={key} transform={`translate(${i * 28}, 0)`}>
                                    <rect width="24" height="40" rx="3" fill="#e2e8f0" stroke="#94a3b8" strokeWidth="1" />
                                    <text x="12" y="24" textAnchor="middle" fill="#0f172a" fontWeight="bold" fontSize="10" fontFamily="monospace">{key}</text>
                                </g>
                            ))}
                        </g>
                    </svg>
                </div>

                <div className="text-center">
                    <button onClick={onClose} className="px-6 py-2 bg-cyan-900/30 hover:bg-cyan-800/50 text-cyan-300 border border-cyan-700/50 rounded font-orbitron text-xs tracking-wider transition-all">GOT IT</button>
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

    // --- PIANO STAGGERED LAYOUT CALCULATIONS ---
    const totalWidth = 800;
    const numWhiteKeys = OCTAVES.length * 7; // 14 white keys
    const whiteKeyWidth = totalWidth / numWhiteKeys;
    const whiteKeyHeight = 120;
    const blackKeyWidth = whiteKeyWidth * 0.65;
    const blackKeyHeight = whiteKeyHeight * 0.6;

    const whiteKeys: any[] = [];
    const blackKeys: any[] = [];

    let whiteIdx = 0;
    OCTAVES.forEach(octave => {
        WHITE_NOTES.forEach((noteName, noteIdx) => {
            const fullNote = `${noteName}${octave}`;
            const x = whiteIdx * whiteKeyWidth;
            
            // White keys at the bottom
            whiteKeys.push({ 
                note: fullNote, 
                x, 
                y: 0, 
                width: whiteKeyWidth - 2, 
                height: whiteKeyHeight, 
                type: 'white' 
            });

            // Black keys are positioned between certain white keys
            if (BLACK_NOTES_MAP[noteName]) {
                const blackNote = `${BLACK_NOTES_MAP[noteName]}${octave}`;
                // Black key sits between this white key and the next
                const bx = x + whiteKeyWidth - (blackKeyWidth / 2);
                blackKeys.push({ 
                    note: blackNote, 
                    x: bx, 
                    y: 0, 
                    width: blackKeyWidth, 
                    height: blackKeyHeight, 
                    type: 'black' 
                });
            }
            whiteIdx++;
        });
    });

    const svgHeight = whiteKeyHeight + 10;

    return (
        <div className="w-full max-w-[820px] mx-auto mt-4 select-none relative">
            {/* FLIPPED LAYOUT INFO Banner */}
            <div className="absolute -top-7 right-0 flex items-center gap-2 z-40">
                <button onClick={() => setShowGuide(true)} title="Show Keyboard Layout Guide" className="flex items-center gap-1 text-[10px] text-cyan-500/80 hover:text-cyan-400 font-mono tracking-wider px-2 py-1 rounded border border-cyan-900/30 bg-black/20 hover:bg-black/40 transition-all">
                    <span className="text-xs">⌨</span> FLIPPED LAYOUT INFO
                </button>
            </div>

            {showGuide && <KeyboardGuide onClose={() => setShowGuide(false)} />}

            {/* Piano Keyboard SVG */}
            <svg viewBox={`0 0 ${totalWidth} ${svgHeight}`} className="w-full drop-shadow-2xl bg-black/20 rounded-lg p-2">
                {/* Render White Keys (bottom layer) */}
                {whiteKeys.map(k => (
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

                {/* Render Black Keys (top layer, staggered) */}
                {blackKeys.map(k => (
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
