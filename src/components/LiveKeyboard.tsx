import { useState, useEffect, memo, useRef, useMemo, useCallback } from 'react';
import { getNoteColor } from '../utils/noteColors';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface LiveKeyboardProps { onPlayNote: (note: string) => void; onStopNote?: (note: string) => void; activeTrackColor: string; }

// Piano Layout Data
const OCTAVES = [2, 3, 4, 5]; // Arranged left to right (low to high)
const WHITE_NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const BLACK_NOTES_MAP: Record<string, string> = {
    'C': 'C#',
    'D': 'D#',
    'F': 'F#',
    'G': 'G#',
    'A': 'A#'
};

// Configuration for "Chromatic Zig-Zag" style playing (Flipped Mode)
const KEY_TO_NOTE: Record<string, string> = {
    'F1': 'C4', 'Digit1': 'C#4',
    'F2': 'D4', 'Digit2': 'D#4',
    'F3': 'E4', 'Digit3': 'F4', 
    'F4': 'F#4', 'Digit4': 'G4',
    'F5': 'G#4', 'Digit5': 'A4',
    'F6': 'A#4', 'Digit6': 'B4',
    'F7': 'C5', 'Digit7': 'C#5',
    'F8': 'D5', 'Digit8': 'D#5',
};

const NOTE_TO_KEY = Object.entries(KEY_TO_NOTE).reduce((acc, [keyCode, note]) => {
    acc[note] = keyCode;
    return acc;
}, {} as Record<string, string>);

const formatKeyLabel = (code: string) => {
    if (code.startsWith('Digit')) return code.replace('Digit', '');
    if (code.startsWith('Key')) return code.replace('Key', '');
    return code;
};

// --- KEYBOARD GUIDE COMPONENT ---
const KeyboardGuide = ({ onClose }: { onClose: () => void }) => {
    const guideRef = useFocusTrap<HTMLDivElement>(true, onClose);

    return (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 backdrop-blur-sm rounded-xl animate-fadeIn" onClick={onClose}>
            <div ref={guideRef} className="relative p-8 border-2 border-dashed border-cyan-500/50 rounded-2xl bg-[#0d1015] shadow-[0_0_50px_rgba(6,182,212,0.15)] max-w-2xl w-full mx-4" onClick={e => e.stopPropagation()}>
                <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors" aria-label="Close guide">✕</button>
                <div className="text-center mb-8">
                    <h3 className="text-2xl font-orbitron font-bold text-cyan-400 mb-2 tracking-widest">FLIPPED MODE</h3>
                    <p className="text-gray-400 font-mono text-sm">Rotate your physical keyboard 180° to play chromatically.</p>
                </div>
                
                {/* Visual Schematic */}
                <div className="flex justify-center mb-8">
                    <svg width="400" height="220" viewBox="0 0 400 220" className="drop-shadow-2xl">
                        <rect x="10" y="10" width="380" height="200" rx="10" fill="none" stroke="#334155" strokeWidth="2" strokeDasharray="5,5" />
                        <rect x="80" y="25" width="240" height="30" rx="4" fill="#1e293b" stroke="#334155" strokeWidth="1" />
                        <text x="200" y="44" textAnchor="middle" fill="#475569" fontSize="10" fontFamily="monospace">SPACEBAR (TOP)</text>
                        <path d="M 60 80 L 340 80" stroke="#334155" strokeWidth="1" strokeDasharray="2,2" />
                        
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
                    <button onClick={onClose} className="px-6 py-2 bg-cyan-900/30 hover:bg-cyan-800/50 text-cyan-300 border border-cyan-700/50 rounded font-orbitron text-xs tracking-wider transition-all">GOT IT</button>
                </div>
            </div>
        </div>
    );
};

// --- PC KEYCAP COMPONENT ---
interface LiveKeyProps {
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

const LiveKey = memo(({
    note, type, isActive, x, y, width, height, label,
    activeColor, onMouseDown, onMouseEnter, onStopMouse
}: LiveKeyProps) => {
    const isBlack = type === 'black';

    // Mechanical Keycap Colors
    const baseColor = isBlack ? '#1e293b' : '#e2e8f0'; 
    const topColor = isBlack ? '#0f172a' : '#f8fafc';
    const sideShadow = isBlack ? '#020617' : '#94a3b8';
    
    // Active State styling
    const activeTop = isActive ? activeColor : topColor;
    const opacity = isActive ? 0.9 : 1;
    const bevel = 6; // Deep dish bevel
    const pressOffset = isActive ? 3 : 0; // Push down effect

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
            className="focus:outline-none focus-ring-group"
        >
            {/* Key Shadow/Hole */}
            <rect x={0} y={height - 4} width={width} height={4 + pressOffset} rx={4} fill="#000" opacity={0.6} />
            
            <g transform={`translate(0, ${pressOffset})`} style={{ transition: 'transform 0.05s ease-out' }}>
                {/* Key Base (Bottom Edge) */}
                <rect x={0} y={0} width={width} height={height} rx={4} fill={sideShadow} />
                
                {/* Key Base (Main Body) */}
                <rect x={0} y={0} width={width} height={height - 4} rx={4} fill={baseColor} />

                {/* Key Top (The indented finger surface) */}
                <rect 
                    x={bevel} 
                    y={bevel - 2} 
                    width={width - bevel * 2} 
                    height={height - bevel * 2} 
                    rx={4} 
                    fill={activeTop} 
                    opacity={opacity}
                />

                {/* Top Highlight (creates 3D dish effect) */}
                <path 
                    d={`M ${bevel} ${bevel - 2} L ${width - bevel} ${bevel - 2} L ${width - bevel - 2} ${bevel} L ${bevel + 2} ${bevel} Z`} 
                    fill="rgba(255,255,255,0.4)" 
                />

                {/* Active LED Glow Border */}
                {isActive && (
                    <rect 
                        x={bevel} y={bevel - 2} 
                        width={width - bevel * 2} height={height - bevel * 2} 
                        rx={4} fill="transparent" stroke="#fff" strokeWidth={1.5} 
                        style={{ filter: `drop-shadow(0 0 8px ${activeColor})` }} 
                    />
                )}

                {/* Note Label */}
                <text 
                    x={width / 2} 
                    y={height / 2 + 1} 
                    fill={isActive ? '#fff' : (isBlack ? '#94a3b8' : '#64748b')} 
                    fontSize={10} 
                    textAnchor="middle" 
                    fontWeight="bold" 
                    pointerEvents="none"
                >
                    {note}
                </text>

                {/* Desktop Mapping Label (e.g., F1, 1) */}
                {label && (
                    <text 
                        x={width / 2} 
                        y={height - 8} 
                        fill={isActive ? '#000' : (isBlack ? '#38bdf8' : '#3b82f6')} 
                        fontSize={9} 
                        textAnchor="middle" 
                        fontFamily="monospace" 
                        fontWeight="bold" 
                        pointerEvents="none"
                        opacity={isActive ? 1 : 0.8}
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
            const note = KEY_TO_NOTE[e.code];
            if (note && !e.repeat) {
                e.preventDefault();
                setHeldByKeys(prev => new Set(prev).add(note));
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

    // --- PC PIANO STAGGERED LAYOUT CALCULATIONS ---
    const totalWidth = 920;
    const numWhiteKeys = OCTAVES.length * 7;
    const gap = 4; // Space between keycaps
    const keyWidth = (totalWidth - (numWhiteKeys - 1) * gap) / numWhiteKeys;
    const keyHeight = 54; // Square-ish mechanical keycaps
    const rowOffset = keyHeight + gap + 4; // Drop bottom row down

    const whiteKeys: any[] = [];
    const blackKeys: any[] = [];

    let whiteIdx = 0;
    OCTAVES.forEach(octave => {
        WHITE_NOTES.forEach(noteName => {
            const fullNote = `${noteName}${octave}`;
            const x = whiteIdx * (keyWidth + gap);
            
            // White keys on the BOTTOM row
            whiteKeys.push({ note: fullNote, x, y: rowOffset, width: keyWidth, height: keyHeight, type: 'white' });

            if (BLACK_NOTES_MAP[noteName]) {
                const blackNote = `${BLACK_NOTES_MAP[noteName]}${octave}`;
                // Black keys staggered perfectly halfway between the white keys on the TOP row
                const bx = x + (keyWidth + gap) / 2;
                blackKeys.push({ note: blackNote, x: bx, y: 0, width: keyWidth, height: keyHeight, type: 'black' });
            }
            whiteIdx++;
        });
    });

    const svgHeight = keyHeight * 2 + gap + 16;

    return (
        <div className="w-full max-w-[920px] mx-auto mt-4 select-none relative">
            <div className="absolute -top-7 right-0 flex items-center gap-2 z-40">
                <button onClick={() => setShowGuide(true)} className="flex items-center gap-1 text-[10px] text-cyan-500/80 hover:text-cyan-400 font-mono tracking-wider px-2 py-1 rounded border border-cyan-900/30 bg-black/20 hover:bg-black/40 transition-all">
                    <span className="text-xs">⌨</span> FLIPPED LAYOUT INFO
                </button>
            </div>

            {showGuide && <KeyboardGuide onClose={() => setShowGuide(false)} />}

            {/* Render Staggered Keyboard SVG */}
            <svg viewBox={`0 0 ${totalWidth} ${svgHeight}`} className="w-full drop-shadow-xl bg-black/20 rounded p-2">
                
                {/* Render White Keys (Bottom Row) */}
                {whiteKeys.map(k => (
                    <LiveKey
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

                {/* Render Black Keys (Top Row) */}
                {blackKeys.map(k => (
                    <LiveKey
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
