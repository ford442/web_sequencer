import { useState, useEffect, memo, useRef, useMemo, useCallback } from 'react';
import { getNoteColor } from '../utils/noteColors';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface LiveKeyboardProps { onPlayNote: (note: string) => void; onStopNote?: (note: string) => void; activeTrackColor?: string; }

// PC Key Mapping for Classic Piano Layout
// Top row: 5 black keys (C#5, D#5, F#5, G#5, A#5) - mapped to keys 9, 8, 6, 5, 4
// Bottom row: 8 white keys (C5, D5, E5, F5, G5, A5, B5, C6) - mapped to F8-F1
const PC_KEY_MAPPING: Record<string, string> = {
    // F-key row (bottom) - White keys
    'F8': 'C5',   'F7': 'D5',   'F6': 'E5',   'F5': 'F5',
    'F4': 'G5',   'F3': 'A5',   'F2': 'B5',   'F1': 'C6',
    // Digit row (top) - Black keys (staggered between white keys)
    'Digit9': 'C#5',  'Digit8': 'D#5',  'Digit6': 'F#5',  'Digit5': 'G#5',  'Digit4': 'A#5',
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

// Note colors for chromatic coloring
const NOTE_COLORS: Record<string, string> = {
    'C': '#dc2626',   // Red-600
    'C#': '#1f2937',  // Black (sharp)
    'D': '#f97316',   // Orange-500
    'D#': '#1f2937',  // Black (sharp)
    'E': '#eab308',   // Yellow-500
    'F': '#22c55e',   // Green-500
    'F#': '#1f2937',  // Black (sharp)
    'G': '#06b6d4',   // Cyan-500
    'G#': '#1f2937',  // Black (sharp)
    'A': '#3b82f6',   // Blue-500
    'A#': '#1f2937',  // Black (sharp)
    'B': '#a855f7',   // Purple-500
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
                    <h3 id="keyboard-guide-title" className="text-2xl font-orbitron font-bold text-cyan-400 mb-2 tracking-widest">PIANO KEYBOARD</h3>
                    <p className="text-gray-400 font-mono text-sm">Classic piano layout with 5 black keys and 8 white keys.</p>
                </div>

                {/* Visual Schematic */}
                <div className="flex justify-center mb-8">
                    <svg width="400" height="140" viewBox="0 0 400 140" className="drop-shadow-2xl">
                        <rect x="10" y="10" width="380" height="120" rx="10" fill="none" stroke="#334155" strokeWidth="2" strokeDasharray="5,5" />

                        {/* Black keys row (staggered between white keys) */}
                        <g transform="translate(30, 20)">
                            <text x="-5" y="18" fill="#f97316" fontSize="9" fontFamily="monospace" textAnchor="end">BLACK</text>
                            {/* C# between C and D */}
                            <g transform="translate(35, 0)">
                                <rect width="30" height="40" rx="2" fill="#1f2937" stroke="#000" strokeWidth="2" />
                                <text x="15" y="24" textAnchor="middle" fill="#fff" fontWeight="bold" fontSize="10" fontFamily="monospace">9</text>
                            </g>
                            {/* D# between D and E */}
                            <g transform="translate(85, 0)">
                                <rect width="30" height="40" rx="2" fill="#1f2937" stroke="#000" strokeWidth="2" />
                                <text x="15" y="24" textAnchor="middle" fill="#fff" fontWeight="bold" fontSize="10" fontFamily="monospace">8</text>
                            </g>
                            {/* F# between F and G */}
                            <g transform="translate(185, 0)">
                                <rect width="30" height="40" rx="2" fill="#1f2937" stroke="#000" strokeWidth="2" />
                                <text x="15" y="24" textAnchor="middle" fill="#fff" fontWeight="bold" fontSize="10" fontFamily="monospace">6</text>
                            </g>
                            {/* G# between G and A */}
                            <g transform="translate(235, 0)">
                                <rect width="30" height="40" rx="2" fill="#1f2937" stroke="#000" strokeWidth="2" />
                                <text x="15" y="24" textAnchor="middle" fill="#fff" fontWeight="bold" fontSize="10" fontFamily="monospace">5</text>
                            </g>
                            {/* A# between A and B */}
                            <g transform="translate(285, 0)">
                                <rect width="30" height="40" rx="2" fill="#1f2937" stroke="#000" strokeWidth="2" />
                                <text x="15" y="24" textAnchor="middle" fill="#fff" fontWeight="bold" fontSize="10" fontFamily="monospace">4</text>
                            </g>
                        </g>

                        {/* White keys row */}
                        <g transform="translate(30, 70)">
                            <text x="-5" y="25" fill="#22c55e" fontSize="9" fontFamily="monospace" textAnchor="end">WHITE</text>
                            {['F8','F7','F6','F5','F4','F3','F2','F1'].map((key, i) => (
                                <g key={key} transform={`translate(${i * 42}, 0)`}>
                                    <rect width="40" height="50" rx="3" fill="#f8fafc" stroke="#cbd5e1" strokeWidth="2" />
                                    <text x="20" y="30" textAnchor="middle" fill="#0f172a" fontWeight="bold" fontSize="9" fontFamily="monospace">{key}</text>
                                </g>
                            ))}
                        </g>
                    </svg>
                </div>

                {/* Color legend */}
                <div className="flex justify-center gap-2 mb-6 flex-wrap">
                    {[
                        { note: 'C', color: '#dc2626', label: 'Red' },
                        { note: 'D', color: '#f97316', label: 'Orange' },
                        { note: 'E', color: '#eab308', label: 'Yellow' },
                        { note: 'F', color: '#22c55e', label: 'Green' },
                        { note: 'G', color: '#06b6d4', label: 'Cyan' },
                        { note: 'A', color: '#3b82f6', label: 'Blue' },
                        { note: 'B', color: '#a855f7', label: 'Purple' },
                    ].map(({ note, color, label }) => (
                        <div key={note} className="flex items-center gap-1 bg-black/30 px-2 py-1 rounded">
                            <div className="w-3 h-3 rounded" style={{ backgroundColor: color }} />
                            <span className="text-xs font-mono text-gray-400">{note}={label}</span>
                        </div>
                    ))}
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
    x: number;
    y: number;
    width: number;
    height: number;
    label: string | null;
    isBlack: boolean;
    isActive: boolean;
    isHeldByMouse: boolean;
    activeColor: string;
    onMouseDown: (note: string) => void;
    onMouseEnter: (note: string) => void;
    onStopMouse: () => void;
}

const PianoKey = memo(({
    note, x, y, width, height, label, isBlack,
    isActive, activeColor, onMouseDown, onMouseEnter, onStopMouse
}: PianoKeyProps) => {
    const noteBase = getNoteBase(note);
    const noteColor = NOTE_COLORS[noteBase] || '#94a3b8';

    // Active state with glow
    const glowColor = isActive ? activeColor : noteColor;
    const pressOffset = isActive ? 3 : 0;

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
                x={isBlack ? 2 : 2} 
                y={height - 6 + pressOffset} 
                width={width - 4} 
                height={isBlack ? 6 : 8} 
                rx={isBlack ? 2 : 4} 
                fill="#000" 
                opacity={0.4} 
            />
            
            <g transform={`translate(0, ${pressOffset})`} style={{ transition: 'transform 0.03s ease-out' }}>
                {/* Key body */}
                <rect 
                    x={0} 
                    y={0} 
                    width={width} 
                    height={height} 
                    rx={isBlack ? 3 : 4} 
                    fill={isBlack ? '#0f172a' : '#f8fafc'}
                    stroke={isBlack ? '#000' : '#cbd5e1'}
                    strokeWidth={2}
                />
                
                {/* Key face (main surface) */}
                <rect 
                    x={2} 
                    y={2} 
                    width={width - 4} 
                    height={height - 8} 
                    rx={isBlack ? 2 : 3} 
                    fill={isActive ? activeColor : (isBlack ? '#1f2937' : '#f8fafc')}
                />

                {/* Specular highlight */}
                {!isBlack && (
                    <rect 
                        x={4} 
                        y={3} 
                        width={width - 8} 
                        height={4} 
                        rx={1} 
                        fill="rgba(255,255,255,0.8)"
                        opacity={0.7}
                    />
                )}

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

                {/* Note name */}
                <text 
                    x={width / 2} 
                    y={height / 2 + (isBlack ? 3 : 5)} 
                    fill={isActive ? '#fff' : (isBlack ? '#e2e8f0' : noteColor)}
                    fontSize={isBlack ? 12 : 16} 
                    fontWeight="bold"
                    textAnchor="middle" 
                    pointerEvents="none"
                    style={{ textShadow: isActive ? '0 0 8px rgba(255,255,255,0.8)' : 'none' }}
                >
                    {note}
                </text>

                {/* PC Key label */}
                {label && (
                    <text 
                        x={width / 2} 
                        y={height - (isBlack ? 8 : 12)} 
                        fill={isBlack ? '#94a3b8' : '#475569'}
                        fontSize={isBlack ? 9 : 10} 
                        textAnchor="middle" 
                        fontFamily="monospace"
                        fontWeight="bold"
                        pointerEvents="none"
                        opacity={0.9}
                    >
                        {isBlack ? `[${label}]` : label}
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

    // --- CLASSIC PIANO LAYOUT ---
    // 8 white keys on bottom, 5 black keys on top (staggered between white keys)
    const totalWidth = 800;
    const numWhiteKeys = 8;
    const fKeyGap = 30; // Gap between F5 and F4 key groups
    const whiteKeyWidth = (totalWidth - fKeyGap) / numWhiteKeys; // Adjusted for gap
    const whiteKeyHeight = 90;
    const blackKeyWidth = whiteKeyWidth * 0.85; // Increased from 0.65 to 0.85
    const blackKeyHeight = whiteKeyHeight * 0.75; // Increased from 0.65 to 0.75
    const rowGap = 5;

    // White keys (bottom row)
    const whiteNotes = ['C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6'];
    const whiteKeyCodes = ['F8', 'F7', 'F6', 'F5', 'F4', 'F3', 'F2', 'F1'];

    // Black keys (top row) - positioned between specific white keys
    // C# between C-D, D# between D-E, F# between F-G, G# between G-A, A# between A-B
    // Positions: after key 0 (C), after key 1 (D), after key 3 (F), after key 4 (G), after key 5 (A)
    const blackKeyData = [
        { note: 'C#5', keyCode: 'Digit9', position: 0 }, // Between C and D
        { note: 'D#5', keyCode: 'Digit8', position: 1 }, // Between D and E
        { note: 'F#5', keyCode: 'Digit6', position: 3 }, // Between F and G
        { note: 'G#5', keyCode: 'Digit5', position: 4 }, // Between G and A
        { note: 'A#5', keyCode: 'Digit4', position: 5 }, // Between A and B
    ];

    const whiteRowY = blackKeyHeight + rowGap;
    const svgHeight = whiteRowY + whiteKeyHeight + 10;

    return (
        <div className="w-full max-w-[820px] mx-auto mt-4 select-none relative">
            {/* PIANO LAYOUT INFO Banner */}
            <div className="absolute -top-7 right-0 flex items-center gap-2 z-40">
                <button onClick={() => setShowGuide(true)} title="Show Keyboard Layout Guide" className="flex items-center gap-1 text-[10px] text-cyan-500/80 hover:text-cyan-400 font-mono tracking-wider px-2 py-1 rounded border border-cyan-900/30 bg-black/20 hover:bg-black/40 transition-all">
                    <span className="text-xs">⌨</span> PIANO LAYOUT INFO
                </button>
            </div>

            {showGuide && <KeyboardGuide onClose={() => setShowGuide(false)} />}

            {/* Piano Keyboard SVG */}
            <svg viewBox={`0 0 ${totalWidth} ${svgHeight}`} className="w-full drop-shadow-2xl bg-black/20 rounded-lg p-2">
                {/* White keys (bottom row) */}
                {whiteNotes.map((note, i) => (
                    <PianoKey
                        key={note}
                        note={note}
                        x={i * whiteKeyWidth}
                        y={whiteRowY}
                        width={whiteKeyWidth - 2}
                        height={whiteKeyHeight}
                        label={whiteKeyCodes[i].replace('F', 'F')}
                        isBlack={false}
                        isActive={targetActiveNotes.has(note)}
                        isHeldByMouse={heldByMouse === note}
                        activeColor={getNoteColor(note)}
                        onMouseDown={handleMouseDownStable}
                        onMouseEnter={handleMouseEnterStable}
                        onStopMouse={handleStopMouseStable}
                    />
                ))}

                {/* Black keys (top row) - positioned between white keys */}
                {blackKeyData.map(({ note, keyCode, position }) => {
                    // Position black key to the right of the specified white key position
                    // Centered on the border between white keys
                    const x = (position + 1) * whiteKeyWidth - (blackKeyWidth / 2);
                    return (
                        <PianoKey
                            key={note}
                            note={note}
                            x={x}
                            y={0}
                            width={blackKeyWidth}
                            height={blackKeyHeight}
                            label={keyCode.replace('Digit', '')}
                            isBlack={true}
                            isActive={targetActiveNotes.has(note)}
                            isHeldByMouse={heldByMouse === note}
                            activeColor={getNoteColor(note)}
                            onMouseDown={handleMouseDownStable}
                            onMouseEnter={handleMouseEnterStable}
                            onStopMouse={handleStopMouseStable}
                        />
                    );
                })}
            </svg>
        </div>
    );
});
