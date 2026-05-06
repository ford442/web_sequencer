import React, { useCallback, useRef, useState, useEffect } from 'react';
import { NOTES, noteToMidi, midiToNote, getScaleNotes, isMidiInScale, nextScaleNote } from '../utils/musicTheory';
import type { ScaleDefinition } from '../utils/musicTheory';
import { getNoteColor } from '../utils/noteColors';

const SHARP_KEYS = new Set(['C#', 'D#', 'F#', 'G#', 'A#']);

/** Extract the note name (e.g. "C#") from a full note string (e.g. "C#4") */
const extractNoteName = (fullNote: string): string => fullNote.replace(/\d+$/, '');

/** Whether a note name is a sharp (black key) */
const isSharpKey = (noteName: string): boolean => SHARP_KEYS.has(noteName);

interface AdvancedNoteSelectorProps {
    /** Current note value, e.g. "C4" */
    value: string;
    /** Called when the note changes (drag or flyout pick) */
    onChange: (note: string) => void;
    /** Optional track key for color-coding (e.g. 'partA', 'partB') */
    trackKey?: string;
    /** Minimum MIDI note (default: 36 = C2) */
    minMidi?: number;
    /** Maximum MIDI note (default: 84 = C6) */
    maxMidi?: number;
    /** Active scale definition for "Snap to Scale". When set, drag skips out-of-scale notes
     *  and the flyout greys out non-scale keys. */
    currentScale?: ScaleDefinition;
    /** Compact display label override */
    label?: string;
}

const DRAG_THRESHOLD = 4; // pixels before drag starts

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const AdvancedNoteSelector: React.FC<AdvancedNoteSelectorProps> = React.memo(({
    value,
    onChange,
    trackKey,
    minMidi = 36,
    maxMidi = 84,
    currentScale,
    label,
}) => {
    const [flyoutOpen, setFlyoutOpen] = useState(false);
    const pointerActiveRef = useRef(false);
    const isDraggingRef = useRef(false);
    const didDragRef = useRef(false);
    const startYRef = useRef(0);
    const startMidiRef = useRef(0);
    const lastMidiRef = useRef(0);
    const buttonRef = useRef<HTMLButtonElement>(null);

    const currentMidi = noteToMidi(value) || 60;

    // Clamp MIDI to range
    const clamp = useCallback((midi: number) => Math.max(minMidi, Math.min(maxMidi, midi)), [minMidi, maxMidi]);

    // --- Gestural Drag ---
    const handlePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0) return; // left-click only
        e.preventDefault();
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* jsdom compat */ }

        pointerActiveRef.current = true;
        isDraggingRef.current = false;
        didDragRef.current = false;
        startYRef.current = e.clientY;
        startMidiRef.current = currentMidi;
        lastMidiRef.current = currentMidi;
    }, [currentMidi]);

    const handlePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
        if (!pointerActiveRef.current) return;

        const dy = startYRef.current - e.clientY; // up = positive = higher pitch

        if (!isDraggingRef.current) {
            // Check threshold before starting drag
            if (Math.abs(dy) < DRAG_THRESHOLD) return;
            isDraggingRef.current = true;
            didDragRef.current = true;
        }

        // Sensitivity: ~8px per semitone
        const semitones = Math.round(dy / 8);
        let targetMidi = clamp(startMidiRef.current + semitones);

        // Snap to scale if active
        if (currentScale && !isMidiInScale(targetMidi, currentScale)) {
            // Determine drag direction from the mouse movement delta, not from position comparison
            const dragDirection = dy >= 0 ? 1 : -1;
            const direction = targetMidi !== lastMidiRef.current
                ? (targetMidi > lastMidiRef.current ? 1 : -1)
                : dragDirection;
            targetMidi = nextScaleNote(targetMidi - direction, direction as 1 | -1, currentScale);
            targetMidi = clamp(targetMidi);
        }

        if (targetMidi !== lastMidiRef.current) {
            lastMidiRef.current = targetMidi;
            onChange(midiToNote(targetMidi));
        }
    }, [clamp, currentScale, onChange]);

    const handlePointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
        if (!pointerActiveRef.current) return;
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* jsdom compat */ }
        pointerActiveRef.current = false;
        isDraggingRef.current = false;

        // If no drag happened, treat as a click → open flyout
        if (!didDragRef.current) {
            setFlyoutOpen(prev => !prev);
        }
        didDragRef.current = false;
    }, []);

    // --- Flyout ---
    const closeFlyout = useCallback(() => {
        setFlyoutOpen(false);
        buttonRef.current?.focus();
    }, []);

    useEffect(() => {
        if (!flyoutOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                closeFlyout();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [flyoutOpen, closeFlyout]);

    const handleFlyoutSelect = useCallback((note: string) => {
        onChange(note);
        setFlyoutOpen(false);
    }, [onChange]);

    // Determine octave range from minMidi/maxMidi
    const minOctave = Math.floor(minMidi / 12) - 1;
    const maxOctave = Math.floor(maxMidi / 12) - 1;
    const octaves: number[] = [];
    for (let o = minOctave; o <= maxOctave; o++) {
        octaves.push(o);
    }

    // Scale note set for filtering
    const scaleNotes = currentScale ? getScaleNotes(currentScale) : null;

    const color = getNoteColor(value, trackKey);
    const currentNoteName = extractNoteName(value);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
            e.preventDefault();
            let targetMidi = clamp(currentMidi + 1);
            if (currentScale && !isMidiInScale(targetMidi, currentScale)) {
                targetMidi = nextScaleNote(currentMidi, 1, currentScale);
                targetMidi = clamp(targetMidi);
            }
            if (targetMidi !== currentMidi) {
                onChange(midiToNote(targetMidi));
            }
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
            e.preventDefault();
            let targetMidi = clamp(currentMidi - 1);
            if (currentScale && !isMidiInScale(targetMidi, currentScale)) {
                targetMidi = nextScaleNote(currentMidi, -1, currentScale);
                targetMidi = clamp(targetMidi);
            }
            if (targetMidi !== currentMidi) {
                onChange(midiToNote(targetMidi));
            }
        }
    }, [currentMidi, clamp, currentScale, onChange]);

    return (
        <div className="relative inline-block">
            {/* Main button: displays current note, supports drag */}
            <button
                ref={buttonRef}
                className="px-1.5 py-0.5 text-[10px] font-mono font-bold rounded cursor-ns-resize select-none touch-none border border-transparent hover:border-cyan-500/50 transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400"
                style={{
                    backgroundColor: color,
                    color: isSharpKey(currentNoteName) ? '#ddd' : '#000',
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onKeyDown={handleKeyDown}
                aria-label={label ?? `Note ${value}`}
                aria-haspopup="true"
                aria-expanded={flyoutOpen}
                aria-controls="advanced-note-selector-listbox"
                title="Drag up/down to change pitch, click to open piano"
            >
                {value}
            </button>

            {/* Piano flyout */}
            {flyoutOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-40"
                        onClick={closeFlyout}
                        aria-hidden="true"
                    />

                    <div
                        id="advanced-note-selector-listbox"
                        role="listbox"
                        aria-label="Note picker"
                        className="absolute z-50 left-full top-0 ml-1 bg-gray-900/95 backdrop-blur-sm border border-cyan-900/50 rounded-lg shadow-[0_0_16px_rgba(6,182,212,0.15)] p-1.5 flex gap-1 animate-in fade-in zoom-in-95 duration-100"
                        style={{ minWidth: 'max-content' }}
                    >
                        {octaves.map(octave => (
                            <div key={octave} className="flex flex-col gap-0.5">
                                {NOTES.slice().reverse().map(noteName => {
                                    const fullNote = `${noteName}${octave}`;
                                    const midi = noteToMidi(fullNote);
                                    if (midi < minMidi || midi > maxMidi) return null;

                                    const noteColor = getNoteColor(fullNote, trackKey);
                                    const isSelected = fullNote === value;
                                    const isInScale = scaleNotes ? scaleNotes.has(noteName) : true;

                                    return (
                                        <button
                                            key={fullNote}
                                            role="option"
                                            aria-selected={isSelected}
                                            aria-disabled={!isInScale}
                                            disabled={!isInScale}
                                            onClick={() => isInScale && handleFlyoutSelect(fullNote)}
                                            className={`w-8 h-5 text-[9px] font-mono rounded flex items-center justify-center transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
                                                isInScale ? 'hover:scale-110 cursor-pointer' : 'cursor-not-allowed disabled:opacity-35'
                                            }`}
                                            style={{
                                                backgroundColor: isSelected
                                                    ? '#fff'
                                                    : isInScale
                                                        ? noteColor
                                                        : '#333',
                                                color: isSelected
                                                    ? '#000'
                                                    : !isInScale
                                                        ? '#666'
                                                        : isSharpKey(noteName)
                                                            ? '#ddd'
                                                            : '#000',
                                                border: isSelected ? `2px solid ${noteColor}` : 'none',
                                                boxShadow: isSelected ? '0 0 6px rgba(255,255,255,0.5)' : 'none',
                                            }}
                                        >
                                            {noteName}
                                        </button>
                                    );
                                })}
                                <div className="text-center text-[8px] text-cyan-800 font-bold mt-0.5">
                                    {octave}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
});
