
import React, { useRef, useEffect } from 'react';
import { getNoteColor } from '../utils/noteColors';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface PatternSelectorProps {
    x: number;
    y: number;
    currentPattern: number | null;
    onSelect: (pattern: number | null) => void;
    onClose: () => void;
}

// Map pattern slot numbers (0-7) to note colors (C4, D4, E4, F4, G4, A4, B4, C5)
// Similar to SongMode logic
const PATTERN_NOTES = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const getPatternColor = (slotIndex: number): string => {
    return getNoteColor(PATTERN_NOTES[slotIndex % PATTERN_NOTES.length]);
};

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const PatternSelector: React.FC<PatternSelectorProps> = React.memo(({
    x, y, currentPattern, onSelect, onClose
}) => {
    const dialogRef = useFocusTrap(true, onClose);
    const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

    const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
        let nextIndex = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            nextIndex = (index + 1) % 8;
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            nextIndex = (index - 1 + 8) % 8;
        }

        if (nextIndex !== -1) {
            e.preventDefault();
            buttonRefs.current[nextIndex]?.focus();
        }
    };

    // Determine which button should receive focus if user tabs in
    const focusIndex = currentPattern !== null ? currentPattern : 0;

    return (
        <>
            {/* Backdrop for click-outside */}
            <div
                className="fixed inset-0 z-40 bg-transparent"
                onClick={onClose}
                aria-hidden="true"
            />

            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="pattern-selector-title"
                tabIndex={-1}
                className="fixed z-50 bg-gray-900 border border-gray-700 rounded shadow-xl p-2 outline-none"
                style={{
                    left: Math.min(x, window.innerWidth - 100),
                    top: Math.min(y, window.innerHeight - 300)
                }}
            >
                <div className="flex justify-between items-center mb-2 px-1">
                    <span id="pattern-selector-title" className="text-xs font-bold text-gray-400">SELECT PTN</span>
                    <button onClick={onClose} aria-label="Close pattern selector" title="Close pattern selector" className="text-gray-500 hover:text-white text-xs focus:outline-none focus-visible:ring-1 focus-visible:ring-white rounded"><span aria-hidden="true">✕</span></button>
                </div>

                <div
                    className="grid grid-cols-2 gap-1.5"
                    role="radiogroup"
                    aria-labelledby="pattern-selector-title"
                >
                    {[0, 1, 2, 3, 4, 5, 6, 7].map(slot => {
                        const color = getPatternColor(slot);
                        const isSelected = currentPattern === slot;

                        return (
                            <button
                                key={slot}
                                ref={(el) => { buttonRefs.current[slot] = el; }}
                                onClick={() => onSelect(slot)}
                                onKeyDown={(e) => handleKeyDown(e, slot)}
                                tabIndex={slot === focusIndex ? 0 : -1}
                                aria-label={`Pattern ${slot + 1}`}
                                title={`Pattern ${slot + 1}`}
                                role="radio"
                                aria-checked={isSelected}
                                className="w-10 h-8 rounded text-xs font-bold flex items-center justify-center transition-all hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ring-offset-gray-900"
                                style={{
                                    backgroundColor: isSelected ? '#fff' : color,
                                    color: isSelected ? '#000' : '#000',
                                    opacity: 0.9,
                                    border: isSelected ? `2px solid ${color}` : 'none',
                                    boxShadow: isSelected ? '0 0 8px rgba(255,255,255,0.5)' : 'none'
                                }}
                            >
                                {slot + 1}
                            </button>
                        );
                    })}
                </div>

                <button
                    onClick={() => onSelect(null)}
                    aria-label="Clear pattern from step"
                    title="Clear pattern from step"
                    className="w-full mt-2 py-1 bg-red-900/40 text-red-400 border border-red-900/60 rounded text-[10px] font-bold hover:bg-red-900/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                >
                    CLEAR
                </button>
            </div>
        </>
    );
});
