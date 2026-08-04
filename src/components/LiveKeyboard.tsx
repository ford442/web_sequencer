import { useState, useEffect, memo, useRef, useMemo, useCallback } from 'react';
import { getNoteColor } from '../utils/noteColors';
import { useFocusTrap } from '../hooks/useFocusTrap';
import {
    clampOctave, noteForOffset, loadStoredOctave, storeOctave,
    MIN_KEYBOARD_OCTAVE, MAX_KEYBOARD_OCTAVE,
} from '../utils/keyboardOctave';

interface LiveKeyboardProps { onPlayNote: (note: string) => void; onStopNote?: (note: string) => void; activeTrackColor?: string; }

// PC Key Mapping for Classic Piano Layout.
// Values are semitone offsets from the C of the current base octave, so the
// whole layout follows the octave shift. At the default octave (5) these are
// C5..C6 with black keys C#5, D#5, F#5, G#5, A#5.
// Top row: 5 black keys - mapped to keys 9, 8, 6, 5, 4
// Bottom row: 8 white keys - mapped to F8-F1
const PC_KEY_MAPPING: Record<string, number> = {
    // F-key row (bottom) - White keys
    'F8': 0,   'F7': 2,   'F6': 4,   'F5': 5,
    'F4': 7,   'F3': 9,   'F2': 11,  'F1': 12,
    // Digit row (top) - Black keys (staggered between white keys)
    'Digit9': 1,  'Digit8': 3,  'Digit6': 6,  'Digit5': 8,  'Digit4': 10,
};

// Octave shift shortcuts. Chosen to avoid the F-key and digit-row piano
// mapping above: [ shifts down, ] shifts up.
const OCTAVE_DOWN_CODE = 'BracketLeft';
const OCTAVE_UP_CODE = 'BracketRight';

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fadeIn" onClick={onClose} >
            <div role="dialog" aria-modal="true" aria-labelledby="keyboard-guide-title" tabIndex={-1} ref={guideRef} className="relative p-8 border-2 border-dashed border-cyan-500/50 rounded-2xl bg-[#0d1015] shadow-[0_0_50px_rgba(6,182,212,0.15)] max-w-2xl w-full mx-4" onClick={e => e.stopPropagation()}>
                <button type="button" onClick={onClose}  className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d1015] rounded p-1.5" aria-label="Close guide" title="Close Guide"><span aria-hidden="true">✕</span></button>
                <div className="text-center mb-8">
                    <h3 id="keyboard-guide-title" className="text-2xl font-orbitron font-bold text-cyan-400 mb-2 tracking-widest">PIANO KEYBOARD</h3>
                    <p className="text-gray-400 font-mono text-sm">Classic piano layout with 5 black keys and 8 white keys.</p>
                    <p className="text-gray-500 font-mono text-xs mt-2">Press <span className="text-cyan-400">[</span> and <span className="text-cyan-400">]</span> to shift the keyboard down or up an octave.</p>
                </div>

                {/* Visual Schematic — two groups: {C D E F} and {G A B C} */}
                <div className="flex justify-center mb-8">
                    <svg aria-hidden="true" width="400" height="150" viewBox="0 0 400 150" className="drop-shadow-2xl">
                        {/* Outer border */}
                        <rect x="10" y="10" width="380" height="132" rx="10" fill="none" stroke="#334155" strokeWidth="2" strokeDasharray="5,5" />

                        {/* Group labels */}
                        <text x="104" y="22" textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">C D E F</text>
                        <text x="272" y="22" textAnchor="middle" fill="#64748b" fontSize="8" fontFamily="monospace">G A B C</text>

                        {/* Vertical divider between groups */}
                        <line x1="200" y1="24" x2="200" y2="132" stroke="#1e3a5f" strokeWidth="1" strokeDasharray="3,3" />

                        {/* Black keys row (staggered, group-aware) */}
                        {/* Group 1: C# [9] and D# [8] */}
                        <g transform="translate(30, 28)">
                            <text x="-5" y="18" fill="#f97316" fontSize="9" fontFamily="monospace" textAnchor="end">BLACK</text>
                            {/* C# between C(0) and D(1): (0+1)*42 - 16 = 26 */}
                            <g transform="translate(26, 0)">
                                <rect width="32" height="38" rx="2" fill="#1f2937" stroke="#000" strokeWidth="2" />
                                <text x="16" y="23" textAnchor="middle" fill="#fff" fontWeight="bold" fontSize="10" fontFamily="monospace">9</text>
                            </g>
                            {/* D# between D(1) and E(2): (1+1)*42 - 16 = 68 */}
                            <g transform="translate(68, 0)">
                                <rect width="32" height="38" rx="2" fill="#1f2937" stroke="#000" strokeWidth="2" />
                                <text x="16" y="23" textAnchor="middle" fill="#fff" fontWeight="bold" fontSize="10" fontFamily="monospace">8</text>
                            </g>
                            {/* Group 2: F# [6], G# [5], A# [4] — shifted right by gap (16px) */}
                            {/* F# between F(3) and G(4): (3+1)*42 - 16 + 16 = 168 */}
                            <g transform="translate(168, 0)">
                                <rect width="32" height="38" rx="2" fill="#1f2937" stroke="#000" strokeWidth="2" />
                                <text x="16" y="23" textAnchor="middle" fill="#fff" fontWeight="bold" fontSize="10" fontFamily="monospace">6</text>
                            </g>
                            {/* G# between G(4) and A(5): (4+1)*42 - 16 + 16 = 210 */}
                            <g transform="translate(210, 0)">
                                <rect width="32" height="38" rx="2" fill="#1f2937" stroke="#000" strokeWidth="2" />
                                <text x="16" y="23" textAnchor="middle" fill="#fff" fontWeight="bold" fontSize="10" fontFamily="monospace">5</text>
                            </g>
                            {/* A# between A(5) and B(6): (5+1)*42 - 16 + 16 = 252 */}
                            <g transform="translate(252, 0)">
                                <rect width="32" height="38" rx="2" fill="#1f2937" stroke="#000" strokeWidth="2" />
                                <text x="16" y="23" textAnchor="middle" fill="#fff" fontWeight="bold" fontSize="10" fontFamily="monospace">4</text>
                            </g>
                        </g>

                        {/* White keys row — group 1: i=0–3, group 2: i=4–7 with +16px gap */}
                        <g transform="translate(30, 74)">
                            <text x="-5" y="25" fill="#22c55e" fontSize="9" fontFamily="monospace" textAnchor="end">WHITE</text>
                            {(['F8','F7','F6','F5','F4','F3','F2','F1'] as const).map((key, i) => (
                                <g key={key} transform={`translate(${i < 4 ? i * 42 : i * 42 + 16}, 0)`}>
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
                    <button type="button" onClick={onClose}  className="px-6 py-2 bg-cyan-900/30 hover:bg-cyan-800/50 text-cyan-300 border border-cyan-700/50 rounded font-orbitron text-xs tracking-wider transition-all" aria-label="Acknowledge and close guide" title="Acknowledge and close guide">GOT IT</button>
                </div>
            </div>
        </div>
    );
};

// --- PIANO KEY COMPONENT ---
interface PianoKeyProps {
    note: string;
    /** Semitone offset from the base octave's C — what the handlers receive. */
    offset: number;
    x: number;
    y: number;
    width: number;
    height: number;
    label: string | null;
    isBlack: boolean;
    isActive: boolean;
    isHeldByMouse: boolean;
    activeColor: string;
    onMouseDown: (offset: number) => void;
    onMouseEnter: (offset: number) => void;
    onStopMouse: () => void;
}

const PianoKey = memo(({
    note, offset, x, y, width, height, label, isBlack,
    isActive, activeColor, onMouseDown, onMouseEnter, onStopMouse
}: PianoKeyProps) => {
    const noteBase = getNoteBase(note);
    const noteColor = NOTE_COLORS[noteBase] || '#94a3b8';

    // Active state with glow
    const glowColor = isActive ? activeColor : noteColor;
    const pressOffset = isActive ? 3 : 0;

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onMouseDown(offset);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            onStopMouse();
        }
    };

    return (
        <g
            transform={`translate(${x}, ${y})`}
            role="button"
            aria-label={`Play ${note}`}
            aria-pressed={isActive}
            tabIndex={0}
            onMouseDown={(e) => { if (e.button === 0) onMouseDown(offset); }}
            onMouseEnter={(e) => { if (e.buttons === 1) onMouseEnter(offset); else onStopMouse(); }}
            onMouseUp={onStopMouse}
            onMouseLeave={onStopMouse}
            onTouchStart={(e) => { e.preventDefault(); onMouseDown(offset); }}
            onTouchEnd={(e) => { e.preventDefault(); onStopMouse(); }}
            onKeyDown={handleKeyDown}
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
    // Held keys are tracked as semitone offsets, not note names, so shifting
    // the octave re-derives every sounding note. The diffing effect below then
    // stops the old pitches and starts the new ones.
    const [heldByKeys, setHeldByKeys] = useState<Set<number>>(new Set());
    const [heldByMouse, setHeldByMouse] = useState<number | null>(null);
    const [showGuide, setShowGuide] = useState(false);
    const [octave, setOctave] = useState(() => loadStoredOctave());

    const heldByMouseRef = useRef(heldByMouse);
    useEffect(() => { heldByMouseRef.current = heldByMouse; }, [heldByMouse]);

    const playingNotesRef = useRef<Set<string>>(new Set());

    useEffect(() => { storeOctave(octave); }, [octave]);

    const shiftOctave = useCallback((delta: number) => {
        setOctave(prev => clampOctave(prev + delta));
    }, []);

    const targetActiveNotes = useMemo(() => {
        const active = new Set<string>();
        heldByKeys.forEach(offset => active.add(noteForOffset(offset, octave)));
        if (heldByMouse !== null) active.add(noteForOffset(heldByMouse, octave));
        return active;
    }, [heldByKeys, heldByMouse, octave]);

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
            if (e.target instanceof HTMLElement && e.target.isContentEditable) return;

            if (e.code === OCTAVE_DOWN_CODE || e.code === OCTAVE_UP_CODE) {
                e.preventDefault();
                if (!e.repeat) shiftOctave(e.code === OCTAVE_UP_CODE ? 1 : -1);
                return;
            }

            const offset = PC_KEY_MAPPING[e.code];
            if (offset !== undefined && !e.repeat) {
                e.preventDefault();
                setHeldByKeys(prev => new Set(prev).add(offset));
            }
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
            if (e.target instanceof HTMLElement && e.target.isContentEditable) return;
            const offset = PC_KEY_MAPPING[e.code];
            if (offset !== undefined) {
                e.preventDefault();
                setHeldByKeys(prev => {
                    const next = new Set(prev);
                    next.delete(offset);
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
    }, [shiftOctave]);

    // --- MOUSE EVENT HANDLERS ---
    const handleMouseDownStable = useCallback((offset: number) => setHeldByMouse(offset), []);
    const handleMouseEnterStable = useCallback((offset: number) => {
        if (heldByMouseRef.current !== null) setHeldByMouse(offset);
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

    // White keys (bottom row) — semitone offsets from the base octave's C
    const whiteOffsets = [0, 2, 4, 5, 7, 9, 11, 12];
    const whiteKeyCodes = ['F8', 'F7', 'F6', 'F5', 'F4', 'F3', 'F2', 'F1'];

    // Black keys (top row) - positioned between specific white keys
    // C# between C-D, D# between D-E, F# between F-G, G# between G-A, A# between A-B
    // Positions: after key 0 (C), after key 1 (D), after key 3 (F), after key 4 (G), after key 5 (A)
    const blackKeyData = [
        { offset: 1,  keyCode: 'Digit9', position: 0 }, // C# between C and D
        { offset: 3,  keyCode: 'Digit8', position: 1 }, // D# between D and E
        { offset: 6,  keyCode: 'Digit6', position: 3 }, // F# between F and G
        { offset: 8,  keyCode: 'Digit5', position: 4 }, // G# between G and A
        { offset: 10, keyCode: 'Digit4', position: 5 }, // A# between A and B
    ];

    const whiteRowY = blackKeyHeight + rowGap;
    const svgHeight = whiteRowY + whiteKeyHeight + 10;

    return (
        <div className="w-full max-w-[820px] mx-auto mt-4 select-none relative">
            {/* OCTAVE CONTROLS + PIANO LAYOUT INFO Banner */}
            <div className="absolute -top-7 left-0 flex items-center gap-1 z-40">
                <button
                    type="button"
                    onClick={() => shiftOctave(-1)}
                    disabled={octave <= MIN_KEYBOARD_OCTAVE}
                    aria-label="Octave down"
                    title="Octave down ( [ )"
                    className="text-[10px] text-cyan-500/80 hover:text-cyan-400 disabled:text-gray-700 disabled:hover:text-gray-700 font-mono px-2 py-1 rounded border border-cyan-900/30 bg-black/20 hover:bg-black/40 disabled:bg-black/10 transition-all"
                >
                    <span aria-hidden="true">−</span>
                </button>
                <span className="text-[10px] font-mono tracking-wider text-cyan-400 px-2 py-1 rounded border border-cyan-900/30 bg-black/30 tabular-nums">
                    OCT {octave}
                </span>
                <button
                    type="button"
                    onClick={() => shiftOctave(1)}
                    disabled={octave >= MAX_KEYBOARD_OCTAVE}
                    aria-label="Octave up"
                    title="Octave up ( ] )"
                    className="text-[10px] text-cyan-500/80 hover:text-cyan-400 disabled:text-gray-700 disabled:hover:text-gray-700 font-mono px-2 py-1 rounded border border-cyan-900/30 bg-black/20 hover:bg-black/40 disabled:bg-black/10 transition-all"
                >
                    <span aria-hidden="true">+</span>
                </button>
                <span role="status" aria-live="polite" className="sr-only">
                    {`Octave ${octave}, keys ${noteForOffset(0, octave)} to ${noteForOffset(12, octave)}`}
                </span>
            </div>

            <div className="absolute -top-7 right-0 flex items-center gap-2 z-40">
                <button type="button" onClick={() => setShowGuide(true)} aria-label="Show Keyboard Layout Guide" title="Show Keyboard Layout Guide" className="flex items-center gap-1 text-[10px] text-cyan-500/80 hover:text-cyan-400 font-mono tracking-wider px-2 py-1 rounded border border-cyan-900/30 bg-black/20 hover:bg-black/40 transition-all">
                    <span className="text-xs" aria-hidden="true">⌨</span> PIANO LAYOUT INFO
                </button>
            </div>

            {showGuide && <KeyboardGuide onClose={() => setShowGuide(false)} />}

            {/* Piano Keyboard SVG */}
            <svg aria-hidden="true" viewBox={`0 0 ${totalWidth} ${svgHeight}`} className="w-full drop-shadow-2xl bg-black/20 rounded-lg p-2">
                {/* White keys (bottom row) — group 1: C D E F (i=0–3), group 2: G A B C (i=4–7) */}
                {whiteOffsets.map((offset, i) => {
                    const note = noteForOffset(offset, octave);
                    return (
                        <PianoKey
                            key={offset}
                            note={note}
                            offset={offset}
                            x={i < 4 ? i * whiteKeyWidth : i * whiteKeyWidth + fKeyGap}
                            y={whiteRowY}
                            width={whiteKeyWidth - 2}
                            height={whiteKeyHeight}
                            label={whiteKeyCodes[i]}
                            isBlack={false}
                            isActive={targetActiveNotes.has(note)}
                            isHeldByMouse={heldByMouse === offset}
                            activeColor={getNoteColor(note)}
                            onMouseDown={handleMouseDownStable}
                            onMouseEnter={handleMouseEnterStable}
                            onStopMouse={handleStopMouseStable}
                        />
                    );
                })}

                {/* Black keys (top row) - positioned between white keys */}
                {/* positions 0,1 → left group (C#,D#); positions 3,4,5 → right group (F#,G#,A#) */}
                {blackKeyData.map(({ offset, keyCode, position }) => {
                    const note = noteForOffset(offset, octave);
                    // Shift right-group black keys by fKeyGap to align with the offset white keys
                    const x = (position + 1) * whiteKeyWidth - (blackKeyWidth / 2) + (position >= 3 ? fKeyGap : 0);
                    return (
                        <PianoKey
                            key={offset}
                            note={note}
                            offset={offset}
                            x={x}
                            y={0}
                            width={blackKeyWidth}
                            height={blackKeyHeight}
                            label={keyCode.replace('Digit', '')}
                            isBlack={true}
                            isActive={targetActiveNotes.has(note)}
                            isHeldByMouse={heldByMouse === offset}
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
