import React from 'react';
import { NOTES } from '../utils/musicTheory';
import { useFocusTrap } from '../hooks/useFocusTrap';

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
    // NEW: Per-step parameters
    currentTimbre?: number;
    currentVelocity?: number;
    currentProbability?: number;
    currentMicrotiming?: number;
    currentReverse?: boolean;
    currentRetrigger?: number;
    currentFreeze?: number;
    onPropertyChange?: (key: 'timbre' | 'velocity' | 'probability' | 'microtiming' | 'reverse' | 'retrigger' | 'freeze', value: number | boolean) => void;
}

export const NoteSelector: React.FC<NoteSelectorProps> = ({
    x, y, trackType, currentNote, currentLength, onSelect, onLengthChange, onClose, getNoteColor,
    currentTimbre = 0, currentVelocity = 1, currentProbability = 1, currentMicrotiming = 0, currentReverse = false, currentRetrigger = 1, currentFreeze = 0, onPropertyChange
}) => {
    // Determine octave range based on track type
    const octaves = trackType === 'synth' ? [2, 3, 4] : [2];

    const dialogRef = useFocusTrap(true, onClose);

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
                aria-labelledby="note-selector-title"
                tabIndex={-1}
                className="fixed z-50 bg-slate-900 border border-slate-600 rounded shadow-xl p-3 grid gap-3 outline-none"
                style={{
                    left: Math.min(x, window.innerWidth - 320),
                    top: Math.min(y, window.innerHeight - 400)
                }}
            >
                <div className="flex justify-between items-center pb-2 border-b border-slate-700">
                    <span id="note-selector-title" className="text-xs font-bold text-slate-300">NOTE PROPERTIES</span>
                    <button onClick={onClose} aria-label="Close" title="Close" className="text-slate-500 hover:text-white">✕</button>
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
                        aria-valuetext={`${currentLength} Steps`}
                        aria-label="Duration"
                    />
                </div>

                {onPropertyChange && (
                    <>
                        {/* Velocity Control */}
                        <div className="flex flex-col gap-1">
                            <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase">
                                <label htmlFor="note-velocity">Velocity</label>
                                <span className="text-emerald-400">{Math.round((currentVelocity + 0.0001) * 100)}%</span>
                            </div>
                            <input
                                id="note-velocity"
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={currentVelocity}
                                onChange={(e) => onPropertyChange('velocity', parseFloat(e.target.value))}
                                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                                aria-valuetext={`${Math.round((currentVelocity + 0.0001) * 100)}%`}
                                aria-label="Velocity"
                            />
                        </div>

                        {/* Timbre Control */}
                        <div className="flex flex-col gap-1">
                            <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase">
                                <label htmlFor="note-timbre">Expression</label>
                                <span className="text-pink-400">{Math.round((currentTimbre + 0.0001) * 100)}%</span>
                            </div>
                            <input
                                id="note-timbre"
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={currentTimbre}
                                onChange={(e) => onPropertyChange('timbre', parseFloat(e.target.value))}
                                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-pink-500"
                                aria-valuetext={`${Math.round((currentTimbre + 0.0001) * 100)}%`}
                                aria-label="Expression"
                            />
                        </div>

                        {/* Probability Control */}
                        <div className="flex flex-col gap-1">
                            <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase">
                                <label htmlFor="note-prob">Probability</label>
                                <span className="text-yellow-400">{Math.round((currentProbability + 0.0001) * 100)}%</span>
                            </div>
                            <input
                                id="note-prob"
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={currentProbability}
                                onChange={(e) => onPropertyChange('probability', parseFloat(e.target.value))}
                                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                                aria-valuetext={`${Math.round((currentProbability + 0.0001) * 100)}%`}
                                aria-label="Probability"
                            />
                        </div>

                        {/* Microtiming Control */}
                        <div className="flex flex-col gap-1">
                            <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase">
                                <label htmlFor="note-micro">Microtiming</label>
                                <span className="text-purple-400">{currentMicrotiming > 0 ? '+' : ''}{currentMicrotiming.toFixed(2)}</span>
                            </div>
                            <input
                                id="note-micro"
                                type="range"
                                min="-0.5"
                                max="0.5"
                                step="0.01"
                                value={currentMicrotiming}
                                onChange={(e) => onPropertyChange('microtiming', parseFloat(e.target.value))}
                                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                                aria-valuetext={`${currentMicrotiming > 0 ? '+' : ''}${currentMicrotiming.toFixed(2)} steps`}
                                aria-label="Microtiming"
                            />
                        </div>

                        {/* Freeze (Spectral Smear) Control */}
                        {trackType === 'synth' && ( // Only show for sampler/synth, but we can assume 'synth' type includes sampler here
                            <div className="flex flex-col gap-1">
                                <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase">
                                    <label htmlFor="note-freeze">Freeze</label>
                                    <span className="text-cyan-400">{Math.round((currentFreeze + 0.0001) * 100)}%</span>
                                </div>
                                <input
                                    id="note-freeze"
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={currentFreeze}
                                    onChange={(e) => onPropertyChange('freeze', parseFloat(e.target.value))}
                                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                                    aria-valuetext={`${Math.round((currentFreeze + 0.0001) * 100)}%`}
                                    aria-label="Freeze"
                                />
                            </div>
                        )}

                        {/* Retrigger (Ratchet) Control */}
                        <div className="flex flex-col gap-1 pb-1">
                            <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase">
                                <label id="retrigger-label">Retrigger</label>
                                <span className="text-orange-400">{currentRetrigger > 1 ? `${currentRetrigger}x` : 'OFF'}</span>
                            </div>
                            <div
                                role="group"
                                aria-labelledby="retrigger-label"
                                className="flex gap-1"
                            >
                                {[1, 2, 3, 4].map(val => (
                                    <button
                                        key={val}
                                        onClick={() => onPropertyChange('retrigger', val)}
                                        className={`flex-1 py-1 text-[10px] font-bold rounded ${currentRetrigger === val ? 'bg-orange-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
                                        aria-pressed={currentRetrigger === val}
                                        aria-label={val === 1 ? 'No retrigger' : `Retrigger ${val} times`}
                                    >
                                        {val === 1 ? '1x' : `${val}x`}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Reverse Control */}
                        <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold uppercase py-1">
                            <label htmlFor="note-reverse">Reverse Sample</label>
                            <button
                                id="note-reverse"
                                onClick={() => onPropertyChange('reverse', !currentReverse)}
                                className={`w-8 h-4 rounded-full transition-colors flex items-center px-0.5 ${currentReverse ? 'bg-cyan-600 justify-end' : 'bg-slate-700 justify-start'}`}
                                aria-checked={currentReverse}
                                role="switch"
                                title="Play slice in reverse"
                            >
                                <div className="w-3 h-3 rounded-full bg-white shadow-sm" />
                            </button>
                        </div>
                    </>
                )}

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
                                        aria-pressed={isSelected}
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
        </>
    );
};
