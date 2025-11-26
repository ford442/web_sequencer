import React from 'react';

const bankColors = [
    '#3fa34d', // Bank A (Green)
    '#3f8fa3', // Bank B (Cyan)
    '#a33f8f', // Bank C (Magenta)
    '#a38f3f', // Bank D (Yellow)
];

interface PatternSelectorProps {
    x: number;
    y: number;
    onSelect: (patternIndex: number) => void;
    onClose: () => void;
}

export const PatternSelector: React.FC<PatternSelectorProps> = ({ x, y, onSelect, onClose }) => {
    return (
        <div
            className="fixed inset-0 z-50"
            onClick={onClose}
            onContextMenu={(e) => {
                e.preventDefault();
                onClose();
            }}
        >
            <div
                className="absolute bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-2 grid grid-cols-8 gap-1"
                style={{ left: x, top: y }}
                onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside
            >
                {Array.from({ length: 32 }).map((_, i) => {
                    const bank = Math.floor(i / 8);
                    const patternInBank = i % 8;
                    const color = bankColors[bank];
                    return (
                        <button
                            key={i}
                            onClick={() => onSelect(i)}
                            className="w-10 h-10 rounded text-xs font-bold transition-transform duration-100 hover:scale-110"
                            style={{ backgroundColor: color, color: 'black' }}
                        >
                            {String.fromCharCode(65 + bank)}{patternInBank + 1}
                        </button>
                    );
                })}
                 <button
                    onClick={() => onSelect(-1)} // Use -1 or null to represent clearing
                    className="w-full h-8 mt-1 rounded text-xs font-bold transition-transform duration-100 hover:scale-105 bg-red-800 text-white col-span-8"
                >
                    CLEAR
                </button>
            </div>
        </div>
    );
};
