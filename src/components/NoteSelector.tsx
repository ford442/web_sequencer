import React, { memo } from 'react';
import { NOTES, getScaleNotes } from '../utils/musicTheory';
import type { ScaleDefinition } from '../utils/musicTheory';
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
    /** Active scale definition for Key Lock — greys out non-scale keys */
    currentScale?: ScaleDefinition | null;
    // NEW: Per-step parameters
    currentTimbre?: number;
    currentVelocity?: number;
    currentProbability?: number;
    currentMicrotiming?: number;
    currentReverse?: boolean;
    currentRetrigger?: number;
    currentFreeze?: number;
    currentFormantShift?: number;
    currentFilterCutoff?: number;
    currentFilterResonance?: number;
    currentEnvMod?: number;
    currentFormantLfoRate?: number;
    currentFormantLfoDepth?: number;
    currentVibratoDepth?: number;
    currentGateDepth?: number;
    currentGateRate?: number;
    currentDrive?: number;
    currentCharacterMorph?: number;
    currentReverbSend?: number;
    currentReverbType?: import('../types').ReverbType;
    currentFreezeEnvDepth?: number;
    currentGrainEnvDepth?: number;
    currentGrainPitchQuantize?: number;
    currentDelaySend?: number;
    currentChoir?: number;
    onPropertyChange?: (key: 'timbre' | 'velocity' | 'probability' | 'microtiming' | 'reverse' | 'retrigger' | 'freeze' | 'freezeEnvDepth' | 'grainEnvDepth' | 'grainPitchQuantize' | 'formantShift' | 'filterCutoff' | 'filterResonance' | 'envMod' | 'formantLfoRate' | 'formantLfoDepth' | 'formantEnvAttack' | 'formantEnvDecay' | 'formantEnvAmount' | 'vibratoDepth' | 'gateDepth' | 'gateRate' | 'drive' | 'characterMorph' | 'reverbSend' | 'reverbType' | 'delaySend' | 'choir', value: number | boolean | string) => void;
}

export const NoteSelector: React.FC<NoteSelectorProps> = memo(({
    x, y, trackType, currentNote, currentLength, onSelect, onLengthChange, onClose, getNoteColor, currentScale,
    currentTimbre = 0, currentVelocity = 1, currentProbability = 1, currentMicrotiming = 0, currentReverse = false, currentRetrigger = 1, currentFreeze = 0, currentFormantShift, currentFilterCutoff, currentFilterResonance, currentEnvMod, currentFormantLfoRate = 0, currentFormantLfoDepth = 0,  currentVibratoDepth = 0, currentGateDepth, currentGateRate, currentDrive, currentCharacterMorph = 0, currentReverbSend, currentReverbType, currentDelaySend, currentFreezeEnvDepth = 0, currentGrainEnvDepth = 0, currentGrainPitchQuantize = 0, currentChoir, onPropertyChange
}) => {
    // Determine octave range based on track type
    const octaves = trackType === 'synth' ? [2, 3, 4] : [2];
    const scaleNotes = currentScale ? getScaleNotes(currentScale) : null;

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
                className="fixed z-50 bg-gray-900/80 backdrop-blur-md border border-cyan-900/50 rounded-lg shadow-[0_0_20px_rgba(6,182,212,0.15)] p-3 grid gap-3 outline-none animate-in fade-in zoom-in-95 duration-100"
                style={{
                    left: Math.min(x, window.innerWidth - 320),
                    top: Math.min(y, window.innerHeight - 400)
                }}
            >
                <div className="flex justify-between items-center pb-2 border-b border-cyan-900/30">
                    <span id="note-selector-title" className="text-xs font-bold font-orbitron text-cyan-400 tracking-widest drop-shadow-[0_0_8px_rgba(6,182,212,0.5)]">NOTE PROPERTIES</span>
                    <button onClick={onClose} aria-label="Close" title="Close" className="text-cyan-600 hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 rounded">✕</button>
                </div>

                {/* NEW: Duration Control */}
                <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                        <label htmlFor="note-duration">Duration</label>
                        <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">{currentLength} Steps</span>
                    </div>
                    <input
                        id="note-duration"
                        type="range"
                        min="1"
                        max="16"
                        value={currentLength || 1}
                        onChange={(e) => onLengthChange(parseInt(e.target.value))}
                        className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
                        aria-valuetext={`${currentLength} Steps`}
                        aria-label="Duration"
                    />
                </div>

                {onPropertyChange && (
                    <>
                        {/* Velocity Control */}
                        <div className="flex flex-col gap-1">
                            <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                <label htmlFor="note-velocity">Velocity</label>
                                <span className="text-emerald-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(52,211,153,0.5)]">{Math.round((currentVelocity + 0.0001) * 100)}%</span>
                            </div>
                            <input
                                id="note-velocity"
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={currentVelocity}
                                onChange={(e) => onPropertyChange('velocity', parseFloat(e.target.value))}
                                className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-emerald-400 border border-cyan-900/30 hover:accent-emerald-300 transition-all"
                                aria-valuetext={`${Math.round((currentVelocity + 0.0001) * 100)}%`}
                                aria-label="Velocity"
                            />
                        </div>

                        {/* Timbre Control */}
                        <div className="flex flex-col gap-1">
                            <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                <label htmlFor="note-timbre">Expression</label>
                                <span className="text-pink-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(244,114,182,0.5)]">{Math.round((currentTimbre + 0.0001) * 100)}%</span>
                            </div>
                            <input
                                id="note-timbre"
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={currentTimbre}
                                onChange={(e) => onPropertyChange('timbre', parseFloat(e.target.value))}
                                className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-pink-400 border border-pink-900/30 hover:accent-pink-300 transition-all"
                                aria-valuetext={`${Math.round((currentTimbre + 0.0001) * 100)}%`}
                                aria-label="Expression"
                            />
                        </div>

                        {/* Probability Control */}
                        <div className="flex flex-col gap-1">
                            <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                <label htmlFor="note-prob">Probability</label>
                                <span className="text-yellow-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(250,204,21,0.5)]">{Math.round((currentProbability + 0.0001) * 100)}%</span>
                            </div>
                            <input
                                id="note-prob"
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={currentProbability}
                                onChange={(e) => onPropertyChange('probability', parseFloat(e.target.value))}
                                className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-yellow-400 border border-yellow-900/30 hover:accent-yellow-300 transition-all"
                                aria-valuetext={`${Math.round((currentProbability + 0.0001) * 100)}%`}
                                aria-label="Probability"
                            />
                        </div>

                        {/* Microtiming Control */}
                        <div className="flex flex-col gap-1">
                            <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                <label htmlFor="note-micro">Microtiming</label>
                                <span className="text-purple-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(192,132,252,0.5)]">{currentMicrotiming > 0 ? '+' : ''}{currentMicrotiming.toFixed(2)}</span>
                            </div>
                            <input
                                id="note-micro"
                                type="range"
                                min="-0.5"
                                max="0.5"
                                step="0.01"
                                value={currentMicrotiming}
                                onChange={(e) => onPropertyChange('microtiming', parseFloat(e.target.value))}
                                className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-purple-400 border border-purple-900/30 hover:accent-purple-300 transition-all"
                                aria-valuetext={`${currentMicrotiming > 0 ? '+' : ''}${currentMicrotiming.toFixed(2)} steps`}
                                aria-label="Microtiming"
                            />
                        </div>

                        {/* Freeze (Spectral Smear) Control */}
                        {trackType === "synth" && (
                            <>
                            <div className="flex flex-col gap-1">
                                <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                    <label htmlFor="note-freeze">Freeze</label>
                                    <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">{Math.round((currentFreeze + 0.0001) * 100)}%</span>
                                </div>
                                <input
                                    id="note-freeze"
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={currentFreeze}
                                    onChange={(e) => onPropertyChange?.("freeze", parseFloat(e.target.value))}
                                    className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
                                    aria-valuetext={`\${Math.round((currentFreeze + 0.0001) * 100)}%`}
                                    aria-label="Freeze"
                                />
                            </div>

                            <div className="flex flex-col gap-1">
                                <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                    <label htmlFor="note-freeze-env">Env Frz</label>
                                    <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">{Math.round((currentFreezeEnvDepth + 0.0001) * 100)}%</span>
                                </div>
                                <input
                                    id="note-freeze-env"
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={currentFreezeEnvDepth}
                                    onChange={(e) => onPropertyChange?.("freezeEnvDepth", parseFloat(e.target.value))}
                                    className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
                                    aria-valuetext={`\${Math.round((currentFreezeEnvDepth + 0.0001) * 100)}%`}
                                    aria-label="Envelope to Freeze Depth"
                                />
                            </div>

                            <div className="flex flex-col gap-1">
                                <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                    <label htmlFor="note-grain-env">Env Grn</label>
                                    <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">{Math.round((currentGrainEnvDepth + 0.0001) * 100)}%</span>
                                </div>
                                <input
                                    id="note-grain-env"
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={currentGrainEnvDepth}
                                    onChange={(e) => onPropertyChange?.("grainEnvDepth", parseFloat(e.target.value))}
                                    className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
                                    aria-valuetext={`\${Math.round((currentGrainEnvDepth + 0.0001) * 100)}%`}
                                    aria-label="Envelope to Grain Size Depth"
                                />
                            </div>

                            <div className="flex flex-col gap-1">
                                <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                    <label htmlFor="note-grain-quant">Grain Quant</label>
                                    <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">{currentGrainPitchQuantize} st</span>
                                </div>
                                <input
                                    id="note-grain-quant"
                                    type="range"
                                    min="0"
                                    max="12"
                                    step="1"
                                    value={currentGrainPitchQuantize}
                                    onChange={(e) => onPropertyChange?.("grainPitchQuantize", parseFloat(e.target.value))}
                                    className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
                                    aria-valuetext={`${currentGrainPitchQuantize} semitones`}
                                    aria-label="Granular Pitch Quantization"
                                />
                            </div>
                            </>
                        )}

                        {/* Delay Send Control */}
                        {onPropertyChange && (
                            <div className="flex flex-col gap-1">
                                <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                    <label htmlFor="note-delay-send">Delay Send</label>
                                    <span className="text-indigo-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(129,140,248,0.5)]">{currentDelaySend !== undefined ? Math.round(currentDelaySend * 100) : 0}%</span>
                                </div>
                                <input
                                    id="note-delay-send"
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={currentDelaySend !== undefined ? currentDelaySend : 0}
                                    onChange={(e) => onPropertyChange('delaySend', parseFloat(e.target.value))}
                                    className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
                                    aria-valuetext={`${currentDelaySend !== undefined ? Math.round(currentDelaySend * 100) : 0}%`}
                                    aria-label="Delay Send"
                                />
                            </div>
                        )}

                        {/* Rhythmic Gate Parameters */}
                        {currentGateDepth !== undefined && currentGateRate !== undefined && onPropertyChange && trackType === 'sampler' && (
                            <div className="flex flex-col gap-2 mb-2 p-1.5 bg-gray-800/50 rounded border border-gray-700/50">
                                <div className="flex flex-col gap-1">
                                    <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                        <label htmlFor="note-gate-depth">Gate Depth</label>
                                        <span className="text-cyan-400 font-mono text-[10px]">{Math.round((currentGateDepth + 0.0001) * 100)}%</span>
                                    </div>
                                    <input
                                        id="note-gate-depth"
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={currentGateDepth}
                                        onChange={(e) => onPropertyChange('gateDepth', parseFloat(e.target.value))}
                                        className="w-full h-2 bg-gray-900 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
                                    />
                                </div>
                                <div className="flex flex-col gap-1">
                                    <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                        <label htmlFor="note-gate-rate">Gate Rate</label>
                                        <span className="text-cyan-400 font-mono text-[10px]">{currentGateRate.toFixed(1)} Hz</span>
                                    </div>
                                    <input
                                        id="note-gate-rate"
                                        type="range"
                                        min="0.1"
                                        max="50"
                                        step="0.1"
                                        value={currentGateRate}
                                        onChange={(e) => onPropertyChange('gateRate', parseFloat(e.target.value))}
                                        className="w-full h-2 bg-gray-900 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
                                    />
                                </div>
                            </div>
                        )}

                        {/* Reverb Send Control */}
                        {onPropertyChange && (
                            <>
                                <div className="flex flex-col gap-1 mt-2">
                                    <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                        <label htmlFor="note-reverbsend">Reverb Send</label>
                                        <span className="text-indigo-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(129,140,248,0.5)]">{currentReverbSend !== undefined ? Math.round(currentReverbSend * 100) : 0}%</span>
                                    </div>
                                    <input
                                        id="note-reverbsend"
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={currentReverbSend !== undefined ? currentReverbSend : 0}
                                        onChange={(e) => onPropertyChange?.('reverbSend', parseFloat(e.target.value))}
                                        className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
                                        aria-valuetext={`${currentReverbSend !== undefined ? Math.round(currentReverbSend * 100) : 0}%`}
                                        aria-label="Reverb Send"
                                    />
                                    <div className="flex justify-between items-center mt-1">
                                        <span className="text-[9px] text-indigo-200/50 uppercase font-bold">Space</span>
                                        <select
                                            value={currentReverbType || ''}
                                            onChange={(e) => onPropertyChange?.('reverbType', e.target.value)}
                                            className="bg-gray-800/80 text-[10px] text-indigo-200 rounded border border-indigo-900/30 px-1 py-0.5 outline-none focus:border-indigo-500 transition-colors"
                                            aria-label="Reverb Type Override"
                                        >
                                            <option value="">Global</option>
                                            <option value="room">Room</option>
                                            <option value="plate">Plate</option>
                                            <option value="hall">Hall</option>
                                        </select>
                                    </div>
                                </div>


                                {/* Delay Send Control */}
                                <div className="flex flex-col gap-1 mt-2">
                                    <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                        <label htmlFor="note-delaysend">Delay Send</label>
                                        <span className="text-pink-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(244,114,182,0.5)]">{currentDelaySend !== undefined ? Math.round(currentDelaySend * 100) : 0}%</span>
                                    </div>
                                    <input
                                        id="note-delaysend"
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={currentDelaySend !== undefined ? currentDelaySend : 0}
                                        onChange={(e) => onPropertyChange('delaySend', parseFloat(e.target.value))}
                                        className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-pink-400 border border-pink-900/30 hover:accent-pink-300 transition-all"
                                        aria-valuetext={`${currentDelaySend !== undefined ? Math.round(currentDelaySend * 100) : 0}%`}
                                        aria-label="Delay Send"
                                    />
                                </div>

                                <div className="flex flex-col gap-1 mt-2">
                                    <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                        <label htmlFor="note-choir">Chorus Spread</label>
                                        <span className="text-indigo-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(129,140,248,0.5)]">{currentChoir !== undefined ? Math.round(currentChoir * 100) : 0}%</span>
                                    </div>
                                    <input
                                        id="note-choir"
                                        type="range"
                                        min="0"
                                        max="1"
                                        step="0.01"
                                        value={currentChoir !== undefined ? currentChoir : 0}
                                        onChange={(e) => onPropertyChange('choir', parseFloat(e.target.value))}
                                        className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
                                        aria-valuetext={`${currentChoir !== undefined ? Math.round(currentChoir * 100) : 0}%`}
                                        aria-label="Chorus Detune Spread"
                                    />
                                </div>
                            </>
                        )}

                        {/* Formant LFO Rate Control */}
                        {trackType === 'synth' && (
                            <div className="flex flex-col gap-1">
                                <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                    <label htmlFor="note-fmt-rate">Fmt LFO Rate</label>
                                    <span className="text-indigo-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(129,140,248,0.5)]">{currentFormantLfoRate.toFixed(1)} Hz</span>
                                </div>
                                <input
                                    id="note-fmt-rate"
                                    type="range"
                                    min="0"
                                    max="20"
                                    step="0.1"
                                    value={currentFormantLfoRate}
                                    onChange={(e) => onPropertyChange('formantLfoRate', parseFloat(e.target.value))}
                                    className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
                                    aria-valuetext={`${currentFormantLfoRate.toFixed(1)} Hz`}
                                    aria-label="Formant LFO Rate"
                                />
                            </div>
                        )}

                        {/* Formant LFO Depth Control */}
                        {trackType === 'synth' && (
                            <div className="flex flex-col gap-1">
                                <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                    <label htmlFor="note-fmt-depth">Fmt LFO Depth</label>
                                    <span className="text-indigo-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(129,140,248,0.5)]">{Math.round((currentFormantLfoDepth + 0.0001) * 100)}%</span>
                                </div>
                                <input
                                    id="note-fmt-depth"
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={currentFormantLfoDepth}
                                    onChange={(e) => onPropertyChange('formantLfoDepth', parseFloat(e.target.value))}
                                    className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-indigo-400 border border-indigo-900/30 hover:accent-indigo-300 transition-all"
                                    aria-valuetext={`${Math.round((currentFormantLfoDepth + 0.0001) * 100)}%`}
                                    aria-label="Formant LFO Depth"
                                />
                            </div>
                        )}

                        {/* Drive / Distortion Control */}
                        {trackType === 'synth' && (
                            <div className="flex flex-col gap-1">
                                <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                    <label htmlFor="note-drive">Distortion</label>
                                    <span className="text-red-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(248,113,113,0.5)]">{currentDrive !== undefined ? Math.round(currentDrive * 100) : 0}%</span>
                                </div>
                                <input
                                    id="note-drive"
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={currentDrive !== undefined ? currentDrive : 0}
                                    onChange={(e) => onPropertyChange('drive', parseFloat(e.target.value))}
                                    className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-red-400 border border-red-900/30 hover:accent-red-300 transition-all"
                                    aria-valuetext={`${currentDrive !== undefined ? Math.round(currentDrive * 100) : 0}%`}
                                    aria-label="Distortion"
                                />
                            </div>
                        )}

                        {/* Vibrato Depth Control */}
                        {trackType === 'synth' && (
                            <div className="flex flex-col gap-1">
                                <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                    <label htmlFor="note-vibrato-depth">Vibrato Depth</label>
                                    <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">{Math.round((currentVibratoDepth + 0.0001) * 100)}%</span>
                                </div>
                                <input
                                    id="note-vibrato-depth"
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={currentVibratoDepth}
                                    onChange={(e) => onPropertyChange('vibratoDepth', parseFloat(e.target.value))}
                                    className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
                                    aria-valuetext={`${Math.round((currentVibratoDepth + 0.0001) * 100)}%`}
                                    aria-label="Vibrato Depth"
                                />
                            </div>
                        )}

                        {/* Morph Override */}
                        {onPropertyChange && currentCharacterMorph !== undefined && (
                            <div className="flex flex-col gap-1">
                                <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                    <label htmlFor="note-morph">Character Morph</label>
                                    <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">{Math.round((currentCharacterMorph + 0.0001) * 100)}%</span>
                                </div>
                                <input
                                    id="note-morph"
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={currentCharacterMorph}
                                    onChange={(e) => onPropertyChange('characterMorph', parseFloat(e.target.value))}
                                    className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
                                    aria-valuetext={`${Math.round((currentCharacterMorph + 0.0001) * 100)}%`}
                                    aria-label="Character Morph"
                                />
                            </div>
                        )}

                        {/* Filter Cutoff Control */}
                        <div className="flex flex-col gap-1">
                            <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                <label htmlFor="note-cutoff">Filter Cutoff</label>
                                <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">{currentFilterCutoff !== undefined ? Math.round(currentFilterCutoff * 100) : 100}%</span>
                            </div>
                            <input
                                id="note-cutoff"
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={currentFilterCutoff !== undefined ? currentFilterCutoff : 1.0}
                                onChange={(e) => onPropertyChange('filterCutoff', parseFloat(e.target.value))}
                                className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
                                aria-valuetext={`${currentFilterCutoff !== undefined ? Math.round(currentFilterCutoff * 100) : 100}%`}
                                aria-label="Filter Cutoff"
                            />
                        </div>

                        {/* Filter Resonance Control */}
                        <div className="flex flex-col gap-1">
                            <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                <label htmlFor="note-resonance">Filter Res</label>
                                <span className="text-cyan-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(34,211,238,0.5)]">{currentFilterResonance !== undefined ? Math.round(currentFilterResonance * 100) : 0}%</span>
                            </div>
                            <input
                                id="note-resonance"
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={currentFilterResonance || 0}
                                onChange={(e) => onPropertyChange('filterResonance', parseFloat(e.target.value))}
                                className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-cyan-900/30 hover:accent-cyan-300 transition-all"
                                aria-valuetext={`${currentFilterResonance !== undefined ? Math.round(currentFilterResonance * 100) : 0}%`}
                                aria-label="Filter Resonance"
                            />
                        </div>

                        {/* Envelope Mod Control */}
                        <div className="flex flex-col gap-1">
                            <div className="flex justify-between text-[10px] text-slate-400 font-bold uppercase">
                                <label htmlFor="note-envmod">Env Mod</label>
                                <span className="text-emerald-400">{currentEnvMod !== undefined ? Math.round(currentEnvMod * 100) : 50}%</span>
                            </div>
                            <input
                                id="note-envmod"
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={currentEnvMod !== undefined ? currentEnvMod : 0.5}
                                onChange={(e) => onPropertyChange('envMod', parseFloat(e.target.value))}
                                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                                aria-valuetext={`${currentEnvMod !== undefined ? Math.round(currentEnvMod * 100) : 50}%`}
                                aria-label="Envelope Modulation"
                            />
                        </div>

                        {/* Retrigger (Ratchet) Control */}
                        <div className="flex flex-col gap-1 pb-1">
                            <div className="flex justify-between text-[10px] text-cyan-200/70 font-bold uppercase">
                                <label id="retrigger-label">Retrigger</label>
                                <span className="text-purple-400 font-mono text-[10px] drop-shadow-[0_0_5px_rgba(192,132,252,0.5)]">{currentRetrigger > 1 ? `${currentRetrigger}x` : 'OFF'}</span>
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
                                        className={`flex-1 py-1 text-[10px] font-bold rounded transition-all ${currentRetrigger === val ? 'bg-purple-600 text-white shadow-[0_0_10px_rgba(147,51,234,0.3)]' : 'bg-gray-800/80 text-cyan-200/70 hover:bg-gray-700 hover:text-white border border-gray-700/50'}`}
                                        aria-pressed={currentRetrigger === val}
                                        aria-label={val === 1 ? 'No retrigger' : `Retrigger ${val} times`}
                                    >
                                        {val === 1 ? '1x' : `${val}x`}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Reverse Control */}
                        <div className="flex justify-between items-center text-[10px] text-cyan-200/70 font-bold uppercase py-1">
                            <label htmlFor="note-reverse">Reverse Sample</label>
                            <button
                                id="note-reverse"
                                onClick={() => onPropertyChange('reverse', !currentReverse)}
                                className={`w-8 h-4 rounded-full transition-colors flex items-center px-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900 ${currentReverse ? 'bg-cyan-500 justify-end shadow-[0_0_8px_rgba(6,182,212,0.4)]' : 'bg-gray-700 justify-start border border-gray-600'}`}
                                aria-checked={currentReverse}
                                role="switch"
                                aria-label="Play slice in reverse"
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
                                 const isInScale = scaleNotes ? scaleNotes.has(noteName) : true;

                                 return (
                                     <button
                                        key={fullNote}
                                        onClick={() => isInScale && onSelect(fullNote)}
                                        aria-label={`Select ${fullNote}`}
                                        aria-pressed={isSelected}
                                        aria-disabled={!isInScale}
                                        className={`w-8 h-6 text-[10px] font-mono rounded flex items-center justify-center transition-all ${isInScale ? 'hover:scale-110' : 'cursor-not-allowed'}`}
                                        style={{
                                            backgroundColor: isSelected ? '#fff' : (isInScale ? color : '#333'),
                                            color: isSelected ? '#000' : (!isInScale ? '#666' : (['C#', 'D#', 'F#', 'G#', 'A#'].includes(noteName) ? '#ccc' : '#000')),
                                            border: isSelected ? `2px solid ${color}` : 'none',
                                            boxShadow: isSelected ? '0 0 8px rgba(255,255,255,0.5)' : 'none',
                                            opacity: isInScale ? 1 : 0.35,
                                        }}
                                     >
                                         {noteName}
                                     </button>
                                 );
                             })}
                             <div className="text-center text-[9px] text-cyan-800 font-bold mt-1">OCT {octave}</div>
                        </div>
                    ))}
                </div>
            </div>
        </>
    );
});
