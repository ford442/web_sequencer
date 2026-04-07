import { useState, useEffect, memo, useRef, useMemo, useCallback } from 'react';
import { getNoteColor } from '../utils/noteColors';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface LiveKeyboardProps { onPlayNote: (note: string) => void; onStopNote?: (note: string) => void; activeTrackColor?: string; }

// White notes for reference
const WHITE_NOTES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

// PC Key Mapping for Whole-Tone Stagger Layout
// F-key row: Whole-tone scale I (C, D, E, F#, G#, A#, C, D)
// Digit row: Whole-tone scale II (C#, D#, F, G, A, B, C#, D#)
// Horizontal = whole step, Vertical = half step
const PC_KEY_MAPPING: Record<string, string> = {
    // F-key row (bottom) - F8 to F1
    'F8': 'C5',   'F7': 'D5',   'F6': 'E5',   'F5': 'F#5',
    'F4': 'G#5',  'F3': 'A#5',  'F2': 'C6',   'F1': 'D6',
    // Digit row (top, staggered) - 1 to 8
    'Digit1': 'C#5',  'Digit2': 'D#5',  'Digit3': 'F5',   'Digit4': 'G5',
    'Digit5': 'A5',   'Digit6': 'B5',   'Digit7': 'C#6',  'Digit8': 'D#6',
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

// Concept 2: Whole-Tone Stagger - Chromatic Coloring
// C=Red, D=Orange, E=Yellow, F=Green, G=Cyan, A=Blue, B=Purple
const NOTE_COLORS: Record<string, string> = {
    'C': '#dc2626',   // Red-600
    'C#': '#ea580c',  // Orange-600
    'D': '#f97316',   // Orange-500
    'D#': '#f59e0b',  // Amber-500
    'E': '#eab308',   // Yellow-500
    'F': '#22c55e',   // Green-500
    'F#': '#10b981',  // Emerald-500
    'G': '#06b6d4',   // Cyan-500
    'G#': '#0ea5e9',  // Sky-500
    'A': '#3b82f6',   // Blue-500
    'A#': '#6366f1',  // Indigo-500
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
                    <h3 id="keyboard-guide-title" className="text-2xl font-orbitron font-bold text-cyan-400 mb-2 tracking-widest">WHOLE-TONE STAGGER</h3>
                    <p className="text-gray-400 font-mono text-sm">Digit row offset by half key. Horizontal = whole step, Vertical = half step.</p>
                </div>

                {/* Visual Schematic */}
                <div className="flex justify-center mb-8">
                    <svg width="360" height="160" viewBox="0 0 360 160" className="drop-shadow-2xl">
                        <rect x="10" y="10" width="340" height="140" rx="10" fill="none" stroke="#334155" strokeWidth="2" strokeDasharray="5,5" />

                        {/* Stagger indicator */}
                        <text x="180" y="28" fill="#06b6d4" fontSize="10" fontFamily="monospace" textAnchor="middle">↳ Staggered by ½ key</text>

                        {/* Digit row (staggered) */}
                        <g transform="translate(55, 35)">
                            <text x="-8" y="15" fill="#f97316" fontSize="9" fontFamily="monospace" textAnchor="end">DIGIT</text>
                            {['1','2','3','4','5','6','7','8'].map((num, i) => (
                                <g key={num} transform={`translate(${i * 38 + 19}, 0)`}>
                                    <rect width="34" height="28" rx="3" fill="#1e293b" stroke="#f97316" strokeWidth="2" />
                                    <text x="17" y="18" textAnchor="middle" fill="#fff" fontWeight="bold" fontSize="11" fontFamily="monospace">{num}</text>
                                </g>
                            ))}
                        </g>

                        {/* Connector lines */}
                        <g stroke="#64748b" strokeWidth="2" strokeDasharray="4,4" opacity="0.5">
                            {[0,1,2,3,4,5,6,7].map(i => (
                                <line key={i} x1={74 + i * 38 + 17} y1="65" x2={55 + i * 38 + 17} y2="90" />
                            ))}
                        </g>

                        {/* F-key row (flush) */}
                        <g transform="translate(55, 90)">
                            <text x="-8" y="20" fill="#22c55e" fontSize="9" fontFamily="monospace" textAnchor="end">F-KEYS</text>
                            {['F8','F7','F6','F5','F4','F3','F2','F1'].map((key, i) => (
                                <g key={key} transform={`translate(${i * 38}, 0)`}>
                                    <rect width="34" height="40" rx="3" fill="#f8fafc" stroke="#22c55e" strokeWidth="2" />
                                    <text x="17" y="25" textAnchor="middle" fill="#0f172a" fontWeight="bold" fontSize="9" fontFamily="monospace">{key}</text>
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

// --- STAGGERED KEY COMPONENT (Concept 2) ---
interface StaggeredKeyProps {
    note: string;
    x: number;
    y: number;
    width: number;
    height: number;
    label: string | null;
    type: 'digit' | 'fkey';
    isActive: boolean;
    isHeldByMouse: boolean;
    activeColor: string;
    onMouseDown: (note: string) => void;
    onMouseEnter: (note: string) => void;
    onStopMouse: () => void;
}

const StaggeredKey = memo(({
    note, x, y, width, height, label, type,
    isActive, activeColor, onMouseDown, onMouseEnter, onStopMouse
}: StaggeredKeyProps) => {
    const noteBase = getNoteBase(note);
    const noteColor = NOTE_COLORS[noteBase] || '#94a3b8';
    const isDigit = type === 'digit';

    // Styling based on row type
    const baseColor = isDigit ? '#1e293b' : '#f8fafc';
    const sideColor = isDigit ? '#0f172a' : '#e2e8f0';
    
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
                x={2} 
                y={height - 6 + pressOffset} 
                width={width - 4} 
                height={6} 
                rx={4} 
                fill="#000" 
                opacity={0.4} 
            />
            
            <g transform={`translate(0, ${pressOffset})`} style={{ transition: 'transform 0.03s ease-out' }}>
                {/* Key body (sides - 3D thickness) */}
                <rect 
                    x={0} 
                    y={0} 
                    width={width} 
                    height={height} 
                    rx={4} 
                    fill={sideColor}
                />
                
                {/* Key face (main surface) */}
                <rect 
                    x={2} 
                    y={2} 
                    width={width - 4} 
                    height={height - 8} 
                    rx={3} 
                    fill={isActive ? activeColor : baseColor}
                />

                {/* Chromatic color tint (note identity visible on key face) */}
                {!isActive && (
                    <rect 
                        x={2} 
                        y={2} 
                        width={width - 4} 
                        height={height - 8} 
                        rx={3} 
                        fill={noteColor} 
                        opacity={isDigit ? 0.4 : 0.2}
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
                    opacity={isDigit ? 0.2 : 0.7}
                />

                {/* LED rim glow when active */}
                {isActive && (
                    <rect 
                        x={2} 
                        y={2} 
                        width={width - 4} 
                        height={height - 8} 
                        rx={3} 
                        fill="transparent" 
                        stroke={glowColor}
                        strokeWidth={3}
                        style={{ filter: `drop-shadow(0 0 12px ${glowColor}) drop-shadow(0 0 4px #fff)` }}
                    />
                )}

                {/* Note name (large, centered, colored) */}
                <text 
                    x={width / 2} 
                    y={height / 2 + 5} 
                    fill={isActive ? '#fff' : (isDigit ? '#e2e8f0' : noteColor)}
                    fontSize={16} 
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
                        y={height - 10} 
                        fill={isDigit ? '#64748b' : '#475569'}
                        fontSize={10} 
                        textAnchor="middle" 
                        fontFamily="monospace"
                        fontWeight="bold"
                        pointerEvents="none"
                        opacity={0.9}
                    >
                        {isDigit ? `[${label}]` : label}
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

    // --- WHOLE-TONE STAGGER LAYOUT (Concept 2) ---
    // Digit row offset by half key width to show half-step relationship
    const totalWidth = 800;
    const numColumns = 8; // 8 columns for F-keys and Digit keys
    const columnWidth = totalWidth / numColumns;
    const keyHeight = 70;
    const rowGap = 15;
    const staggerOffset = columnWidth / 2; // Half-key stagger for Digit row

    // Row positions
    const digitRowY = 0;
    const fKeyRowY = keyHeight + rowGap;

    // Build key positions with stagger
    type KeyPosition = {
        note: string;
        x: number;
        y: number;
        width: number;
        height: number;
        label: string | null;
        row: 'digit' | 'fkey';
    };

    const digitKeys: KeyPosition[] = [];
    const fkeyKeys: KeyPosition[] = [];

    // Digit row notes (whole-tone scale II: C#, D#, F, G, A, B, C#, D#)
    const digitNotes = ['C#5', 'D#5', 'F5', 'G5', 'A5', 'B5', 'C#6', 'D#6'];
    // F-key row notes (whole-tone scale I: C, D, E, F#, G#, A#, C, D)
    const fkeyNotes = ['C5', 'D5', 'E5', 'F#5', 'G#5', 'A#5', 'C6', 'D6'];

    digitNotes.forEach((note, i) => {
        digitKeys.push({
            note,
            x: i * columnWidth + staggerOffset,
            y: digitRowY,
            width: columnWidth - 4,
            height: keyHeight,
            label: (i + 1).toString(), // 1-8
            row: 'digit'
        });
    });

    fkeyNotes.forEach((note, i) => {
        fkeyKeys.push({
            note,
            x: i * columnWidth,
            y: fKeyRowY,
            width: columnWidth - 4,
            height: keyHeight,
            label: `F${8 - i}`, // F8, F7, F6, F5, F4, F3, F2, F1
            row: 'fkey'
        });
    });

    const svgHeight = fKeyRowY + keyHeight + 10;

    // Vertical connector lines for half-step visualization
    // Connect each Digit key to the F-key below it (half-step relationship)
    const connectorLines = digitKeys.map((digitKey, i) => {
        const fkeyKey = fkeyKeys[i];
        if (!fkeyKey) return null;
        
        // Line from bottom-center of digit key to top-center of fkey
        const x1 = digitKey.x + digitKey.width / 2;
        const y1 = digitKey.y + digitKey.height;
        const x2 = fkeyKey.x + fkeyKey.width / 2;
        const y2 = fkeyKey.y;
        
        return { x1, y1, x2, y2, id: `connector-${i}` };
    }).filter(Boolean);

    return (
        <div className="w-full max-w-[820px] mx-auto mt-4 select-none relative">
            {/* PIANO LAYOUT INFO Banner */}
            <div className="absolute -top-7 right-0 flex items-center gap-2 z-40">
                <button onClick={() => setShowGuide(true)} title="Show Keyboard Layout Guide" className="flex items-center gap-1 text-[10px] text-cyan-500/80 hover:text-cyan-400 font-mono tracking-wider px-2 py-1 rounded border border-cyan-900/30 bg-black/20 hover:bg-black/40 transition-all">
                    <span className="text-xs">⌨</span> PIANO LAYOUT INFO
                </button>
            </div>

            {showGuide && <KeyboardGuide onClose={() => setShowGuide(false)} />}

            {/* Whole-Tone Stagger Keyboard SVG: Digit row offset by half key */}
            <svg viewBox={`0 0 ${totalWidth} ${svgHeight}`} className="w-full drop-shadow-2xl bg-black/20 rounded-lg p-2">
                {/* Vertical connector lines showing half-step relationships */}
                <g className="connector-lines" opacity="0.4">
                    {connectorLines.map(line => line && (
                        <line
                            key={line.id}
                            x1={line.x1}
                            y1={line.y1}
                            x2={line.x2}
                            y2={line.y2}
                            stroke="#64748b"
                            strokeWidth="2"
                            strokeDasharray="4,4"
                        />
                    ))}
                </g>

                {/* Digit row (top, staggered) */}
                {digitKeys.map(k => (
                    <StaggeredKey
                        key={k.note}
                        {...k}
                        type="digit"
                        isActive={targetActiveNotes.has(k.note)}
                        isHeldByMouse={heldByMouse === k.note}
                        activeColor={getNoteColor(k.note)}
                        onMouseDown={handleMouseDownStable}
                        onMouseEnter={handleMouseEnterStable}
                        onStopMouse={handleStopMouseStable}
                    />
                ))}

                {/* F-key row (bottom, flush left) */}
                {fkeyKeys.map(k => (
                    <StaggeredKey
                        key={k.note}
                        {...k}
                        type="fkey"
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
