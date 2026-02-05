
import React, { useEffect, useRef } from 'react';
import { getNoteColor } from '../utils/noteColors';

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

export const PatternSelector: React.FC<PatternSelectorProps> = ({
    x, y, currentPattern, onSelect, onClose
}) => {
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Focus dialog on mount
        if (dialogRef.current) {
            dialogRef.current.focus();
        }

        // Handle Escape key
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

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
                    <button onClick={onClose} aria-label="Close pattern selector" className="text-gray-500 hover:text-white text-xs focus:outline-none focus-visible:ring-1 focus-visible:ring-white rounded">✕</button>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                    {[0, 1, 2, 3, 4, 5, 6, 7].map(slot => {
                        const color = getPatternColor(slot);
                        const isSelected = currentPattern === slot;

                        return (
                            <button
                                key={slot}
                                onClick={() => onSelect(slot)}
                                aria-label={`Select Pattern ${slot + 1}`}
                                title={`Pattern ${slot + 1}`}
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
                    className="w-full mt-2 py-1 bg-red-900/40 text-red-400 border border-red-900/60 rounded text-[10px] font-bold hover:bg-red-900/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                >
                    CLEAR
                </button>
            </div>
        </>
    );
};
