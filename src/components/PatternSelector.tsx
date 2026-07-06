
import React, { useRef } from 'react';
import { getNoteColor } from '../utils/noteColors';
import { useFocusTrap } from '../hooks/useFocusTrap';
import {
    TRACK_PATTERN_SLOT_INDICES,
    MAX_TRACK_PATTERN_SLOT_INDEX,
} from '../utils/trackStorageUtils';

interface PatternSelectorProps {
    x: number;
    y: number;
    currentPattern: number | null;
    onSelect: (pattern: number | null) => void;
    onClose: () => void;
}

// Map pattern slot numbers to note colors (cycles every 8 slots)
const PATTERN_NOTES = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'];
const getPatternColor = (slotIndex: number): string => {
    return getNoteColor(PATTERN_NOTES[slotIndex % PATTERN_NOTES.length]);
};

const SLOT_COUNT = TRACK_PATTERN_SLOT_INDICES.length;

// ⚡ Bolt: Added React.memo to prevent unnecessary re-renders when parent state changes.
export const PatternSelector: React.FC<PatternSelectorProps> = React.memo(({
    x, y, currentPattern, onSelect, onClose
}) => {
    const dialogRef = useFocusTrap(true, onClose);
    const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

    const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
        let nextIndex = -1;
        if (e.key === 'ArrowRight') {
            nextIndex = (index + 1) % SLOT_COUNT;
        } else if (e.key === 'ArrowLeft') {
            nextIndex = (index - 1 + SLOT_COUNT) % SLOT_COUNT;
        } else if (e.key === 'ArrowDown') {
            nextIndex = index + 8 < SLOT_COUNT ? index + 8 : index;
        } else if (e.key === 'ArrowUp') {
            nextIndex = index - 8 >= 0 ? index - 8 : index;
        }

        if (nextIndex !== -1 && nextIndex !== index) {
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
                className="fixed z-50 bg-gray-900 border border-gray-700 rounded shadow-xl p-2 outline-none max-h-[min(420px,80vh)] overflow-y-auto"
                style={{
                    left: Math.min(x, window.innerWidth - 220),
                    top: Math.min(y, window.innerHeight - 420)
                }}
            >
                <div className="flex justify-between items-center mb-2 px-1">
                    <span id="pattern-selector-title" className="text-xs font-bold text-gray-400">SELECT PTN (1–{MAX_TRACK_PATTERN_SLOT_INDEX + 1})</span>
                    <button type="button" onClick={onClose} aria-label="Close pattern selector" title="Close pattern selector" className="text-gray-500 hover:text-white text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-white rounded"><span aria-hidden="true">✕</span></button>
                </div>

                <div
                    className="grid grid-cols-8 gap-1"
                    role="radiogroup"
                    aria-labelledby="pattern-selector-title"
                >
                    {TRACK_PATTERN_SLOT_INDICES.map(slot => {
                        const color = getPatternColor(slot);
                        const isSelected = currentPattern === slot;

                        return (
                            <button type="button"
                                key={slot}
                                ref={(el) => { buttonRefs.current[slot] = el; }}
                                onClick={() => onSelect(slot)}
                                onKeyDown={(e) => handleKeyDown(e, slot)}
                                tabIndex={slot === focusIndex ? 0 : -1}
                                aria-label={`Pattern ${slot + 1}`}
                                title={`Pattern ${slot + 1}`}
                                role="radio"
                                aria-checked={isSelected}
                                className="w-8 h-7 rounded text-[10px] font-bold flex items-center justify-center transition-all hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ring-offset-gray-900"
                                style={{
                                    backgroundColor: isSelected ? '#fff' : color,
                                    color: '#000',
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

                <button type="button"
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
