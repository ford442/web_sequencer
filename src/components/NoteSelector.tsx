import React from 'react';
import { NOTES } from '../utils/musicTheory';

interface NoteSelectorProps {
    x: number;
    y: number;
    trackType: 'synth' | 'drum';
    currentNote: string;
    currentLength: number; // NEW: Receive current length
    onSelect: (note: string) => void;
    onLengthChange: (length: number) => void; // NEW: Handle length changes
    onClose: () => void;
    getNoteColor: (note: string) => string;
}

export const NoteSelector: React.FC<NoteSelectorProps> = ({
    x, y, trackType, currentNote, currentLength, onSelect, onLengthChange, onClose, getNoteColor
}) => {
    // Determine octave range based on track type
    const octaves = trackType === 'synth' ? [2, 3, 4] : [2];

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="note-selector-title"
            className="fixed z-50 bg-slate-900 border border-slate-600 rounded shadow-xl p-3 grid gap-3"
            style={{
                left: Math.min(x, window.innerWidth - 320),
                top: Math.min(y, window.innerHeight - 400)
            }}
        >
            <div className="flex justify-between items-center pb-2 border-b border-slate-700">
                <span id="note-selector-title" className="text-xs font-bold text-slate-300">NOTE PROPERTIES</span>
                <button onClick={onClose} aria-label="Close" className="text-slate-500 hover:text-white">✕</button>
            </div>

            {/* NEW: Duration Control */}
            <div className="flex flex-col gap-1">
                <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase">
                    <label htmlFor="note-duration">Duration</label>
                    <span className="text-cyan-400">{currentLength} Steps</span>
                </div>
                <input
                    id="note-duration"
                    type="range"
                    min="1"
                    max="16"
                    value={currentLength || 1}
                    onChange={(e) => onLengthChange(parseInt(e.target.value))}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                />
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
                                    aria-label={`Select ${fullNote}`}
                                    className="w-8 h-6 text-[10px] font-mono rounded flex items-center justify-center transition-all hover:scale-110"
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
                         <div className="text-center text-[9px] text-slate-600 font-bold mt-1">OCT {octave}</div>
                    </div>
                ))}
            </div>
        </div>
    );
};
