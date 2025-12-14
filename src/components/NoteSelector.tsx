
import React from 'react';
import { NOTES } from '../utils/musicTheory';

interface NoteSelectorProps {
    x: number;
    y: number;
    trackType: 'synth' | 'drum';
    currentNote: string;
    onSelect: (note: string) => void;
    onClose: () => void;
    getNoteColor: (note: string) => string;
}

export const NoteSelector: React.FC<NoteSelectorProps> = ({
    x, y, trackType, currentNote, onSelect, onClose, getNoteColor
}) => {
    // Determine octave range based on track type
    // Synths: C2 - B4 (3 octaves)
    // Drums: C2 - B2 (1 octave for tuning nuances, usually lower)
    const octaves = trackType === 'synth' ? [2, 3, 4] : [2];

    return (
        <div
            className="fixed z-50 bg-gray-900 border border-gray-700 rounded shadow-xl p-2 grid gap-1"
            style={{
                left: Math.min(x, window.innerWidth - 200), // Prevent overflow right
                top: Math.min(y, window.innerHeight - 300) // Prevent overflow bottom
            }}
        >
            <div className="flex justify-between items-center mb-1 px-1">
                <span className="text-xs font-bold text-gray-400">SELECT NOTE</span>
                <button onClick={onClose} className="text-gray-500 hover:text-white text-xs">✕</button>
            </div>

            <div className="flex gap-2">
                {octaves.map(octave => (
                    <div key={octave} className="flex flex-col gap-1">
                         {NOTES.slice().reverse().map(noteName => {
                             const fullNote = `${noteName}${octave}`;
                             const color = getNoteColor(fullNote);
                             const isSelected = fullNote === currentNote;

                             return (
                                 <button
                                    key={fullNote}
                                    onClick={() => onSelect(fullNote)}
                                    className={`
                                        w-8 h-6 text-[10px] font-mono rounded flex items-center justify-center
                                        transition-all hover:scale-110
                                    `}
                                    style={{
                                        backgroundColor: isSelected ? '#fff' : color,
                                        color: isSelected ? '#000' : (['C#', 'D#', 'F#', 'G#', 'A#'].includes(noteName) ? '#ccc' : '#000'),
                                        border: isSelected ? `2px solid ${color}` : 'none',
                                        boxShadow: isSelected ? '0 0 8px rgba(255,255,255,0.5)' : 'none'
                                    }}
                                 >
                                     {noteName}
                                 </button>
                             );
                         })}
                         <div className="text-center text-[9px] text-gray-600 font-bold mt-1">OCT {octave}</div>
                    </div>
                ))}
            </div>
        </div>
    );
};
