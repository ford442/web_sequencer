import React, { useRef, useState, useEffect, memo, useCallback } from 'react';
import type { SamplerParams, AudioEngine } from '../types'; // Note: This is now SamplerBankParams[]
import { SupertonicService } from '../services/Supertonic';
import { Knob } from './Knob';
import { WaveformDisplay } from './WaveformDisplay';

interface SamplerPanelProps {
    params: SamplerParams; // Expecting Array[8]
    onChange: (updates: SamplerParams) => void; // Expecting full array update
    onLoadSample: (name: string, buffer: AudioBuffer) => void;
    audioContext: AudioContext;
    audioEngine?: AudioEngine; // For sustain processor controls
    activeBankIdx: number;           // Controlled by Parent
    onBankChange: (i: number) => void; // Controlled by Parent
    onOpenEditor?: () => void;
    ttsPhrases: string[];            // Array of 8 TTS phrases
    onTtsPhraseChange: (phrases: string[]) => void; // Update TTS phrases
    onGenerateTTS?: (text: string) => Promise<void>; // Delegate generation to parent
    onHarmonize?: (bankIndex: number, chordType: string) => Promise<void>; // New prop
    onParamChange?: (bankIndex: number, key: string, value: any) => void;
    loadedBanks?: boolean[];         // Visual indicator for loaded samples
    sampleBuffer?: AudioBuffer | null;
    sliceHighlightRef?: React.MutableRefObject<((slice: number) => void) | null>;
}

// 8 Banks
const SAMPLE_BANKS = Array.from({ length: 8 }, (_, i) => `${i + 1}`);

// Helper functions for grain size calculations
const grainSizeToMs = (size: number) => Math.round(size / 441 * 10);
const grainSizeToPercent = (size: number) => ((size - 441) / (22050 - 441) * 100);

const SamplerPanelComponent: React.FC<SamplerPanelProps> = ({
    params, onChange, onLoadSample, audioContext, audioEngine, activeBankIdx, onBankChange, onOpenEditor,
    ttsPhrases, onTtsPhraseChange, onGenerateTTS,
    onHarmonize, onParamChange, loadedBanks, sampleBuffer, sliceHighlightRef
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dummyRef = useRef(null); // Fallback for sliceHighlightRef
    const [isRecording, setIsRecording] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [status, setStatus] = useState<string>('');
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);

    // Keyboard Navigation Refs
    const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
    const shouldFocusRef = useRef(false);

    const [ttsReady, setTtsReady] = useState(false);
    const [flashBankIdx, setFlashBankIdx] = useState<number | null>(null);
    const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [isProcessingHarmonize, setIsProcessingHarmonize] = useState(false);
    const [chordType, setChordType] = useState('minor');

    const handleHarmonizeClick = async () => {
        if (!onHarmonize) return;
        setIsProcessingHarmonize(true);
        setStatus("Harmonizing...");
        try {
            await onHarmonize(activeBankIdx, chordType);
            setStatus("Harmonized!");
        } catch (e) {
            console.error(e);
            setStatus("Error");
        } finally {
            setIsProcessingHarmonize(false);
        }
    };

    // Get the TTS text for the current bank with bounds checking
    const currentTtsText = (ttsPhrases && activeBankIdx >= 0 && activeBankIdx < 8) 
        ? (ttsPhrases[activeBankIdx] || "Hello World")
        : "Hello World";

    // Update TTS text for current bank with bounds validation
    const setCurrentTtsText = (text: string) => {
        if (activeBankIdx < 0 || activeBankIdx >= 8) {
            console.warn(`Invalid bank index: ${activeBankIdx}`);
            return;
        }
        const newPhrases = [...ttsPhrases];
        newPhrases[activeBankIdx] = text;
        onTtsPhraseChange(newPhrases);
    };

    // Helpers to access current bank's params safely
    const currentParams = params[activeBankIdx] || {
        sampleName: `bank_${activeBankIdx}`,
        playbackSpeed: 1.0,
        volume: 1.0,
        filterCutoff: 20000,
        filterResonance: 0,
        drive: 0,
        delaySend: 0,
        mode: 'loop' as 'loop' | 'stretch' | 'wavetable',
        grainSize: 4410,
        timeRatio: 1.0,
        pitchScale: 1.0,
        formantShift: 0,
        vibratoDepth: 0,
        breathIntensity: 0
    };

    // Update single param for active bank
    const updateParam = (key: keyof typeof currentParams, value: number | string) => {
        const newParams = [...params];
        newParams[activeBankIdx] = { ...currentParams, [key]: value };
        onChange(newParams);
    };

    // Ref to access updateParam stably in callbacks even if params change
    const updateParamRef = useRef(updateParam);
    useEffect(() => { updateParamRef.current = updateParam; });

    // Stable Handlers for Knobs to prevent re-renders
    const handleSpeedChange = useCallback((v: number) => {
        if (onParamChange) onParamChange(activeBankIdx, 'playbackSpeed', v);
        else updateParamRef.current('playbackSpeed', v);
    }, [activeBankIdx, onParamChange]);

    const handleVolumeChange = useCallback((v: number) => {
        if (onParamChange) onParamChange(activeBankIdx, 'volume', v);
        else updateParamRef.current('volume', v);
    }, [activeBankIdx, onParamChange]);

    const handleFilterChange = useCallback((v: number) => {
        if (onParamChange) onParamChange(activeBankIdx, 'filterCutoff', v);
        else updateParamRef.current('filterCutoff', v);
    }, [activeBankIdx, onParamChange]);

    const handleDriveChange = useCallback((v: number) => {
        if (onParamChange) onParamChange(activeBankIdx, 'drive', v);
        else updateParamRef.current('drive', v);
    }, [activeBankIdx, onParamChange]);

    const handleTimeRatioChange = useCallback((v: number) => {
        if (onParamChange) onParamChange(activeBankIdx, 'timeRatio', v);
        else updateParamRef.current('timeRatio', v);
    }, [activeBankIdx, onParamChange]);

    const handlePitchScaleChange = useCallback((v: number) => {
        if (onParamChange) onParamChange(activeBankIdx, 'pitchScale', v);
        else updateParamRef.current('pitchScale', v);
    }, [activeBankIdx, onParamChange]);

    const handleFormantShiftChange = useCallback((v: number) => {
        if (onParamChange) onParamChange(activeBankIdx, 'formantShift', v);
        else updateParamRef.current('formantShift', v);
    }, [activeBankIdx, onParamChange]);

    const handleVibratoDepthChange = useCallback((v: number) => {
        if (onParamChange) onParamChange(activeBankIdx, 'vibratoDepth', v);
        else updateParamRef.current('vibratoDepth', v);
    }, [activeBankIdx, onParamChange]);

    const handleBreathIntensityChange = useCallback((v: number) => {
        if (onParamChange) onParamChange(activeBankIdx, 'breathIntensity', v);
        else updateParamRef.current('breathIntensity', v);
    }, [activeBankIdx, onParamChange]);

    // Handle mode change
    const handleModeChange = (mode: 'loop' | 'stretch' | 'wavetable') => {
        if (onParamChange) {
            onParamChange(activeBankIdx, 'mode', mode);
        } else {
            const newParams = [...params];
            newParams[activeBankIdx] = { ...currentParams, mode };
            onChange(newParams);
        }
        
        // Update audio engine immediately
        if (audioEngine?.setSustainMode) {
            audioEngine.setSustainMode(mode);
        }
    };

    // Handle grain size change
    const handleGrainSizeChange = (size: number) => {
        if (onParamChange) {
            onParamChange(activeBankIdx, 'grainSize', size);
        } else {
            const newParams = [...params];
            newParams[activeBankIdx] = { ...currentParams, grainSize: size };
            onChange(newParams);
        }
        
        // Update audio engine immediately
        if (audioEngine?.setSustainGrainSize) {
            audioEngine.setSustainGrainSize(size);
        }
    };

    // Apply current mode and grain size to audio engine when bank changes
    useEffect(() => {
        if (audioEngine?.setSustainMode && currentParams.mode) {
            audioEngine.setSustainMode(currentParams.mode);
        }
        if (audioEngine?.setSustainGrainSize && currentParams.grainSize) {
            audioEngine.setSustainGrainSize(currentParams.grainSize);
        }
    }, [activeBankIdx, audioEngine, currentParams.mode, currentParams.grainSize]);

    // Handle focus for keyboard navigation
    useEffect(() => {
        if (shouldFocusRef.current) {
            tabRefs.current[activeBankIdx]?.focus();
            shouldFocusRef.current = false;
        }
    }, [activeBankIdx]);

    useEffect(() => {
        const initTTS = async () => {
            try {
                await SupertonicService.getInstance().init();
                setTtsReady(SupertonicService.getInstance().isServiceReady());
            } catch (e) {
                console.error("TTS Init Error:", e);
                setStatus("TTS Unavailable");
            }
        };
        initTTS();
    }, []);

    const loadBufferToBank = (buffer: AudioBuffer) => {
        const bankName = `bank_${activeBankIdx}`;
        onLoadSample(bankName, buffer);

        // Ensure name is synced
        if (currentParams.sampleName !== bankName) {
            const newParams = [...params];
            newParams[activeBankIdx] = { ...currentParams, sampleName: bankName };
            onChange(newParams);
        }

        // Flash UI
        if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
        setFlashBankIdx(activeBankIdx);
        flashTimeoutRef.current = setTimeout(() => setFlashBankIdx(null), 1000);
    };

    const handleTTS = async () => {
        if (!onGenerateTTS) return;
        if (!audioContext || !SupertonicService.getInstance().isServiceReady()) {
            setStatus("Engine not ready");
            return;
        }

        setIsGenerating(true);
        setStatus("Generating...");
        try {
            await onGenerateTTS(currentTtsText);
            setStatus(`Gen: Bank ${activeBankIdx + 1}`);
        } catch (e) {
            console.error(e);
            setStatus("Gen Error");
        } finally {
            setIsGenerating(false);
        }
    };

    const loadAudioFile = async (file: File) => {
        setStatus('Loading...');
        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            loadBufferToBank(audioBuffer);
            setStatus(`Loaded: ${file.name.substring(0, 10)}...`);
        } catch {
            setStatus('Load Error');
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        await loadAudioFile(file);
    };

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('audio/')) {
            await loadAudioFile(file);
        } else {
            setStatus("Invalid File");
        }
    }, [loadAudioFile]);

    const toggleRecording = async () => {
        if (isRecording) {
            mediaRecorderRef.current?.stop();
            setIsRecording(false);
            setStatus('Processing...');
        } else {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const mediaRecorder = new MediaRecorder(stream);
                mediaRecorderRef.current = mediaRecorder;
                chunksRef.current = [];

                mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) chunksRef.current.push(e.data);
                };

                mediaRecorder.onstop = async () => {
                    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
                    const arrayBuffer = await blob.arrayBuffer();
                    try {
                        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                        loadBufferToBank(audioBuffer);
                        setStatus('Recorded!');
                    } catch { setStatus('Decode Error'); }
                    stream.getTracks().forEach(track => track.stop());
                };

                mediaRecorder.start();
                setIsRecording(true);
                setStatus('Recording...');
            } catch { setStatus('Mic Error'); }
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
        let nextIndex = -1;
        if (e.key === 'ArrowRight') {
            nextIndex = (index + 1) % 8;
        } else if (e.key === 'ArrowLeft') {
            nextIndex = (index - 1 + 8) % 8;
        } else if (e.key === 'Home') {
            nextIndex = 0;
        } else if (e.key === 'End') {
            nextIndex = 7;
        }

        if (nextIndex !== -1) {
            e.preventDefault();
            shouldFocusRef.current = true;
            onBankChange(nextIndex);
        }
    };

    // Get alignment
    const alignment = (audioEngine?.getAlignment && activeBankIdx >= 0)
        ? audioEngine.getAlignment(activeBankIdx)
        : null;

    return (
        <div
            className="flex flex-col h-full bg-[#1a1d24] text-white overflow-hidden select-none relative"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {isDragging && (
                <div className="absolute inset-0 z-50 bg-purple-900/80 backdrop-blur-sm flex items-center justify-center border-2 border-purple-400 m-2 rounded-xl pointer-events-none">
                    <div className="text-center animate-pulse">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto mb-4 text-purple-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        <h3 className="text-2xl font-bold text-white font-orbitron tracking-widest">DROP AUDIO FILE</h3>
                        <p className="text-purple-200 mt-2 font-mono text-sm">Load sample into Bank {activeBankIdx + 1}</p>
                    </div>
                </div>
            )}
            {/* --- FIXED HEADER --- */}
            <div className="flex-none flex items-center justify-between p-2 border-b border-[#2a2d36] bg-[#141619]">
                {/* Bank Tabs */}
                <div className="flex gap-1 overflow-x-auto scrollbar-none" role="tablist" aria-label="Sample Banks">
                    {SAMPLE_BANKS.map((label, i) => (
                        <button
                            key={i}
                            ref={(el) => { tabRefs.current[i] = el; }}
                            id={`sampler-bank-tab-${i}`}
                            role="tab"
                            aria-selected={activeBankIdx === i}
                            aria-controls="sampler-bank-panel"
                            aria-label={`Select Bank ${i + 1}${loadedBanks?.[i] ? ' (Loaded)' : ''}`}
                            tabIndex={activeBankIdx === i ? 0 : -1}
                            onClick={() => onBankChange(i)}
                            onKeyDown={(e) => handleKeyDown(e, i)}
                            className={`relative min-w-[24px] py-1 text-[10px] font-bold border rounded transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                                flashBankIdx === i ? 'bg-green-600 border-green-400 text-white animate-pulse' :
                                activeBankIdx === i
                                    ? 'bg-purple-600 border-purple-400 text-white shadow-md'
                                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                            }`}
                            title={`Select Bank ${i+1}`}
                        >
                            {label}
                            {loadedBanks?.[i] && (
                                <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_4px_rgba(34,197,94,0.8)] border border-black" />
                            )}
                        </button>
                    ))}
                </div>

                {/* Status Indicator */}
                <div
                    className="text-[10px] text-right truncate w-24 text-yellow-500 ml-2"
                    title={status}
                    role="status"
                    aria-live="polite"
                >
                    {status}
                </div>
            </div>

            {/* --- SCROLLABLE CONTENT --- */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-700">

                {/* 1. Waveform Visualization */}
                <WaveformDisplay
                    buffer={sampleBuffer || null}
                    alignment={alignment}
                    sliceHighlightRef={sliceHighlightRef || dummyRef}
                />

                {/* 2. Actions (Toolbar: Load, Rec, TTS, Harmonize) */}
                <div className="flex flex-col gap-2 bg-gray-800/20 p-2 rounded border border-gray-800">
                    {/* Row A: Load / Record */}
                    <div className="flex justify-between items-center gap-2">
                        <div className="flex gap-1" role="toolbar" aria-label="Sample Management">
                            <input type="file" accept="audio/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 rounded border border-gray-600 hover:bg-gray-600 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 text-[10px] font-bold text-gray-300"
                                aria-label="Load Sample from File"
                                title="Load audio file into current bank"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                </svg>
                                LOAD
                            </button>
                            <button
                                onClick={toggleRecording}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded border focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 text-[10px] font-bold transition-colors ${
                                    isRecording
                                        ? 'bg-red-900 border-red-500 animate-pulse text-white shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                                        : 'bg-gray-700 border-gray-600 hover:bg-gray-600 hover:text-white text-gray-300'
                                }`}
                                aria-label={isRecording ? "Stop Recording" : "Record Sample from Microphone"}
                                title={isRecording ? "Stop recording audio" : "Record audio from microphone"}
                            >
                                {isRecording ? (
                                    <div className="w-2 h-2 bg-white rounded-sm" />
                                ) : (
                                    <div className="w-2 h-2 bg-red-500 rounded-full shadow-[0_0_4px_rgba(239,68,68,0.8)]" />
                                )}
                                {isRecording ? 'STOP' : 'REC'}
                            </button>
                        </div>
                    </div>

                    {/* Row B: TTS */}
                    <div className="flex gap-1 items-center">
                        <div className="relative flex-1 flex items-center">
                            <input
                                value={currentTtsText}
                                onChange={e => setCurrentTtsText(e.target.value)}
                                className="w-full bg-gray-900 border border-gray-700 rounded px-1 pr-4 text-white text-[10px] outline-none focus:border-purple-500 h-5"
                                placeholder="Phrase..."
                                aria-label="Text to Speech Phrase"
                            />
                            {currentTtsText && (
                                <button
                                    onClick={() => setCurrentTtsText('')}
                                    className="absolute right-1 text-gray-500 hover:text-white text-[10px] rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
                                    aria-label="Clear Phrase"
                                    title="Clear"
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                        <div
                            className={`w-2 h-2 border border-black shadow-sm flex-shrink-0 rounded-full transition-colors ${ttsReady ? 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`}
                            title={ttsReady ? "TTS Engine Ready" : "TTS Engine Loading/Unavailable"}
                        />
                        <button
                            onClick={handleTTS}
                            disabled={isGenerating || !ttsReady}
                            className="px-2 h-5 bg-purple-900 border border-purple-600 text-purple-200 rounded text-[10px] hover:bg-purple-800 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
                            aria-label="Generate Speech"
                            aria-busy={isGenerating}
                        >
                            GEN
                        </button>
                        {onOpenEditor && (
                            <button
                                onClick={onOpenEditor}
                                className="text-[10px] text-purple-400 underline hover:text-white px-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
                                aria-label="Open Voice Editor"
                            >
                                EDIT
                            </button>
                        )}
                    </div>

                    {/* Row C: Harmonizer */}
                    <div className="flex gap-1 items-center">
                        <select
                            value={chordType}
                            onChange={(e) => setChordType(e.target.value)}
                            className="flex-1 bg-gray-900 text-[10px] text-gray-300 border border-gray-700 rounded px-1 h-5 outline-none focus:border-purple-500 focus-visible:ring-2 focus-visible:ring-purple-400"
                            aria-label="Harmonization Chord Type"
                        >
                            <option value="major">Major</option>
                            <option value="minor">Minor</option>
                            <option value="maj7">Major 7</option>
                            <option value="min7">Minor 7</option>
                            <option value="octave">Octave</option>
                            <option value="stack">Power Stack</option>
                        </select>
                        <button
                            onClick={handleHarmonizeClick}
                            disabled={isProcessingHarmonize || !onHarmonize}
                            className={`px-2 h-5 bg-cyan-900 border border-cyan-600 text-cyan-200 rounded text-[10px] hover:bg-cyan-800 disabled:opacity-50 font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${isProcessingHarmonize ? 'cursor-wait' : ''}`}
                            aria-label="Apply Harmonization"
                            aria-busy={isProcessingHarmonize}
                        >
                            {isProcessingHarmonize ? '...' : 'HARM'}
                        </button>
                    </div>
                </div>

                {/* 3. Mode Selector */}
                <div className="bg-gray-800/30 p-1.5 rounded">
                    <div className="flex gap-1 items-center mb-1.5">
                        <label className="text-[10px] text-gray-400 font-bold w-10" id="sampler-mode-label">MODE:</label>
                        <div className="flex gap-1 flex-1" role="radiogroup" aria-labelledby="sampler-mode-label">
                            <button
                                onClick={() => handleModeChange('loop')}
                                className={`flex-1 px-1 h-6 text-[9px] font-bold rounded border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                                    (currentParams.mode || 'loop') === 'loop'
                                        ? 'bg-purple-600 border-purple-400 text-white'
                                        : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
                                }`}
                                aria-label="Loop Mode"
                                role="radio"
                                aria-checked={(currentParams.mode || 'loop') === 'loop'}
                            >
                                LOOP
                            </button>
                            <button
                                onClick={() => handleModeChange('stretch')}
                                className={`flex-1 px-1 h-6 text-[9px] font-bold rounded border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                                    (currentParams.mode || 'loop') === 'stretch'
                                        ? 'bg-purple-600 border-purple-400 text-white'
                                        : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
                                }`}
                                aria-label="Stretch Mode"
                                role="radio"
                                aria-checked={(currentParams.mode || 'loop') === 'stretch'}
                            >
                                STRETCH
                            </button>
                            <button
                                onClick={() => handleModeChange('wavetable')}
                                className={`flex-1 px-1 h-6 text-[9px] font-bold rounded border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                                    (currentParams.mode || 'loop') === 'wavetable'
                                        ? 'bg-purple-600 border-purple-400 text-white'
                                        : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
                                }`}
                                aria-label="Wavetable Mode"
                                role="radio"
                                aria-checked={(currentParams.mode || 'loop') === 'wavetable'}
                            >
                                WAVE
                            </button>
                        </div>
                    </div>
                    {/* Grain Size & Slice Mode (Stretch Mode Only) */}
                    {(currentParams.mode || 'loop') === 'stretch' && (
                        <div className="flex flex-col gap-1.5 mt-1 border-t border-white/5 pt-1">
                            <div className="flex gap-1 items-center">
                                <label htmlFor="sampler-grain-size" className="text-[9px] text-gray-500 w-10">Grain:</label>
                                <input
                                    id="sampler-grain-size"
                                    type="range"
                                    min="441"
                                    max="22050"
                                    step="441"
                                    value={currentParams.grainSize || 4410}
                                    onChange={(e) => handleGrainSizeChange(Number(e.target.value))}
                                    className="flex-1 h-1.5 bg-gray-700 rounded appearance-none cursor-pointer"
                                    style={{
                                        background: `linear-gradient(to right, #9333ea 0%, #9333ea ${grainSizeToPercent(currentParams.grainSize || 4410)}%, #374151 ${grainSizeToPercent(currentParams.grainSize || 4410)}%, #374151 100%)`
                                    }}
                                    aria-label="Grain Size"
                                />
                                <span className="text-[9px] text-gray-500 w-8 text-right">{grainSizeToMs(currentParams.grainSize || 4410)}ms</span>
                            </div>
                            <div className="flex gap-1 items-center">
                                <label id="sampler-slice-label" className="text-[9px] text-gray-500 w-10">Slice:</label>
                                <button
                                    aria-labelledby="sampler-slice-label"
                                    onClick={() => {
                                        const newVal = (currentParams.sliceMode === 'phoneme') ? 'off' : 'phoneme';
                                        if (onParamChange) onParamChange(activeBankIdx, 'sliceMode', newVal);
                                        else updateParamRef.current('sliceMode', newVal);
                                    }}
                                    className={`flex-1 h-5 text-[9px] font-bold rounded border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                                        currentParams.sliceMode === 'phoneme'
                                            ? 'bg-purple-600 border-purple-400 text-white'
                                            : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
                                    }`}
                                    aria-label="Toggle Slice Mode"
                                    aria-pressed={currentParams.sliceMode === 'phoneme'}
                                >
                                    {currentParams.sliceMode === 'phoneme' ? 'ON (PHONEMES)' : 'OFF'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* 4. Controls Wrapper - Use flex-wrap to prevent cut-off */}
                <div className="flex flex-wrap gap-4 mt-1 pb-4">
                    {/* Basic Params Group */}
                    <div className="flex-1 min-w-[140px] bg-gray-800/30 p-2 rounded">
                        <div className="text-[9px] text-gray-500 font-bold mb-1 border-b border-gray-700 pb-0.5">BASIC</div>
                        <div className="grid grid-cols-2 gap-2">
                            <Knob label="Speed" value={currentParams.playbackSpeed || 1} onChange={handleSpeedChange} min={0.1} max={4.0} color="purple" />
                            <Knob label="Vol" value={currentParams.volume} onChange={handleVolumeChange} min={0} max={2.0} color="purple" />
                            <Knob label="Filter" value={currentParams.filterCutoff} onChange={handleFilterChange} min={100} max={20000} color="purple" logarithmic />
                            <Knob label="Drive" value={currentParams.drive} onChange={handleDriveChange} min={0} max={1} color="red" />
                        </div>
                    </div>

                    {/* Rubberband/Granular Params Group */}
                    <div className="flex-[2] min-w-[200px] bg-indigo-900/50 p-2 rounded">
                        <div className="text-[9px] text-indigo-300 font-bold mb-1 border-b border-indigo-800 pb-0.5">ENGINE</div>
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                            <Knob label="Time" value={currentParams.timeRatio ?? 1} onChange={handleTimeRatioChange} min={0.5} max={2.0} step={0.01} color="indigo" />
                            <Knob label="Pitch" value={currentParams.pitchScale ?? 1} onChange={handlePitchScaleChange} min={0.5} max={2.0} step={0.01} color="indigo" />
                            <Knob label="Formant" value={currentParams.formantShift ?? 0} onChange={handleFormantShiftChange} min={-12} max={12} step={0.1} color="indigo" />
                            <Knob label="Vibrato" value={currentParams.vibratoDepth ?? 0} onChange={handleVibratoDepthChange} min={0} max={100} color="indigo" />
                            <Knob label="Breath" value={currentParams.breathIntensity ?? 0} onChange={handleBreathIntensityChange} min={0} max={1.0} step={0.01} color="indigo" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Custom comparison for memoization to prevent re-renders when other banks update
export const SamplerPanel = memo(SamplerPanelComponent, (prev, next) => {
    // 1. Must be looking at same bank
    if (prev.activeBankIdx !== next.activeBankIdx) return false;

    // 2. Active bank params must be referentially equal
    if (prev.params[prev.activeBankIdx] !== next.params[next.activeBankIdx]) return false;

    // 3. TTS phrases for active bank must be same
    const prevTTS = prev.ttsPhrases?.[prev.activeBankIdx];
    const nextTTS = next.ttsPhrases?.[next.activeBankIdx];
    if (prevTTS !== nextTTS) return false;

    // 4. Critical props check
    if (prev.audioEngine !== next.audioEngine) return false;

    // 5. Check if loaded banks status changed
    if (JSON.stringify(prev.loadedBanks) !== JSON.stringify(next.loadedBanks)) return false;

    // 6. Check sample buffer
    if (prev.sampleBuffer !== next.sampleBuffer) return false;

    // 7. Check sliceHighlightRef (should be stable, but just in case)
    if (prev.sliceHighlightRef !== next.sliceHighlightRef) return false;

    // 8. Check onGenerateTTS
    if (prev.onGenerateTTS !== next.onGenerateTTS) return false;

    return true;
});
