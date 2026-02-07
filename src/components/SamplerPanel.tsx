import React, { useRef, useState, useEffect, memo, useCallback } from 'react';
import type { SamplerParams, AudioEngine } from '../types'; // Note: This is now SamplerBankParams[]
import { SupertonicService } from '../services/Supertonic';
import { Knob } from './Knob';

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
    onHarmonize?: (bankIndex: number, chordType: string) => Promise<void>; // New prop
    onParamChange?: (bankIndex: number, key: string, value: any) => void;
}

// 8 Banks
const SAMPLE_BANKS = Array.from({ length: 8 }, (_, i) => `${i + 1}`);

// Helper functions for grain size calculations
const grainSizeToMs = (size: number) => Math.round(size / 441 * 10);
const grainSizeToPercent = (size: number) => ((size - 441) / (22050 - 441) * 100);

const SamplerPanelComponent: React.FC<SamplerPanelProps> = ({
    params, onChange, onLoadSample, audioContext, audioEngine, activeBankIdx, onBankChange, onOpenEditor,
    ttsPhrases, onTtsPhraseChange,
    onHarmonize, onParamChange
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
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
        if (!audioContext || !SupertonicService.getInstance().isServiceReady()) {
            setStatus("Engine not ready");
            return;
        }

        setIsGenerating(true);
        setStatus("Generating...");
        try {
            const rawData = await SupertonicService.getInstance().generate(currentTtsText);
            const buffer = audioContext.createBuffer(1, rawData.length, 44100);
            buffer.getChannelData(0).set(rawData);

            loadBufferToBank(buffer);
            setStatus(`Gen: Bank ${activeBankIdx + 1}`);
        } catch (e) {
            console.error(e);
            setStatus("Gen Error");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
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

    return (
        <div className="flex flex-col gap-2 p-3 text-xs font-mono text-gray-400 h-full">
            {/* ROW 1: Bank Selectors (8 Banks) */}
            <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar" role="tablist" aria-label="Sample Banks">
                {SAMPLE_BANKS.map((label, i) => (
                    <button
                        key={i}
                        ref={(el) => { tabRefs.current[i] = el; }}
                        id={`sampler-bank-tab-${i}`}
                        role="tab"
                        aria-selected={activeBankIdx === i}
                        aria-controls="sampler-bank-panel"
                        aria-label={`Select Bank ${i + 1}`}
                        tabIndex={activeBankIdx === i ? 0 : -1}
                        onClick={() => onBankChange(i)}
                        onKeyDown={(e) => handleKeyDown(e, i)}
                        className={`min-w-[24px] py-1 text-[10px] font-bold border rounded transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                            flashBankIdx === i ? 'bg-green-600 border-green-400 text-white animate-pulse' :
                            activeBankIdx === i
                                ? 'bg-purple-600 border-purple-400 text-white shadow-md'
                                : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                        }`}
                        title={`Select Bank ${i+1}`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {/* Tab Panel Content */}
            <div
                role="tabpanel"
                id="sampler-bank-panel"
                aria-labelledby={`sampler-bank-tab-${activeBankIdx}`}
                className="flex flex-col gap-2"
            >
                {/* ROW 2: Actions */}
                <div className="flex justify-between items-center gap-2">
                <div className="flex gap-1">
                    <input type="file" accept="audio/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="btn-mini px-2 py-0.5 bg-gray-700 rounded border border-gray-600 hover:bg-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
                        aria-label="Load Sample from File"
                    >
                        LOAD
                    </button>
                    <button
                        onClick={toggleRecording}
                        className={`btn-mini px-2 py-0.5 rounded border focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${isRecording ? 'bg-red-900 border-red-500 animate-pulse text-white' : 'bg-gray-700 border-gray-600 hover:bg-gray-600'}`}
                        aria-label={isRecording ? "Stop Recording" : "Record Sample from Microphone"}
                    >
                        {isRecording ? 'STOP' : 'REC'}
                    </button>
                </div>
                <div
                    className="text-[10px] text-right truncate w-24 text-yellow-500"
                    title={status}
                    role="status"
                    aria-live="polite"
                >
                    {status}
                </div>
            </div>

            {/* ROW 3: TTS */}
            <div className="flex gap-1 mt-1 items-center">
                <div className="relative flex-1 flex items-center">
                    <input
                        value={currentTtsText}
                        onChange={e => setCurrentTtsText(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-700 rounded px-1 pr-4 text-white text-[10px] outline-none focus:border-purple-500"
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
                {/* TTS Status Light */}
                <div
                    className={`w-3 h-3 border border-black shadow-sm flex-shrink-0 rounded-sm transition-colors ${ttsReady ? 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.6)]' : 'bg-red-500'}`}
                    title={ttsReady ? "TTS Engine Ready" : "TTS Engine Loading/Unavailable"}
                    role="status"
                    aria-label={ttsReady ? "TTS Engine Ready" : "TTS Engine Not Ready"}
                />
                <button
                    onClick={handleTTS}
                    disabled={isGenerating || !ttsReady}
                    className="px-2 bg-purple-900 border border-purple-600 text-purple-200 rounded text-[10px] hover:bg-purple-800 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
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

            {/* ROW 4: INSTANT HARMONIZER */}
            <div className="mt-1 bg-gray-800/30 p-1 rounded flex gap-1 items-center">
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

            {/* ROW 5: SAMPLER MODE */}
            <div className="mt-1 bg-gray-800/30 p-1 rounded">
                <div className="flex gap-1 items-center mb-1">
                    <label className="text-[10px] text-gray-400 font-bold w-12" id="sampler-mode-label">MODE:</label>
                    <div className="flex gap-1 flex-1" role="radiogroup" aria-labelledby="sampler-mode-label">
                        <button
                            onClick={() => handleModeChange('loop')}
                            className={`flex-1 px-1 h-5 text-[9px] font-bold rounded border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                                (currentParams.mode || 'loop') === 'loop'
                                    ? 'bg-purple-600 border-purple-400 text-white'
                                    : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
                            }`}
                            aria-label="Loop Mode"
                            title="Standard sample looping"
                            role="radio"
                            aria-checked={(currentParams.mode || 'loop') === 'loop'}
                        >
                            LOOP
                        </button>
                        <button
                            onClick={() => handleModeChange('stretch')}
                            className={`flex-1 px-1 h-5 text-[9px] font-bold rounded border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                                (currentParams.mode || 'loop') === 'stretch'
                                    ? 'bg-purple-600 border-purple-400 text-white'
                                    : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
                            }`}
                            aria-label="Stretch Mode"
                            title="Granular time-stretch for infinite sustain"
                            role="radio"
                            aria-checked={(currentParams.mode || 'loop') === 'stretch'}
                        >
                            STRETCH
                        </button>
                        <button
                            onClick={() => handleModeChange('wavetable')}
                            className={`flex-1 px-1 h-5 text-[9px] font-bold rounded border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                                (currentParams.mode || 'loop') === 'wavetable'
                                    ? 'bg-purple-600 border-purple-400 text-white'
                                    : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
                            }`}
                            aria-label="Wavetable Mode"
                            title="Single-cycle oscillator mode"
                            role="radio"
                            aria-checked={(currentParams.mode || 'loop') === 'wavetable'}
                        >
                            WAVE
                        </button>
                    </div>
                </div>
                {/* Grain Size Control - Only visible in stretch mode */}
                {(currentParams.mode || 'loop') === 'stretch' && (
                    <div className="flex flex-col gap-1">
                        <div className="flex gap-1 items-center">
                            <label className="text-[9px] text-gray-500 w-12">Grain:</label>
                            <input
                                type="range"
                                min="441"
                                max="22050"
                                step="441"
                                value={currentParams.grainSize || 4410}
                                onChange={(e) => handleGrainSizeChange(Number(e.target.value))}
                                className="flex-1 h-1 bg-gray-700 rounded appearance-none cursor-pointer"
                                style={{
                                    background: `linear-gradient(to right, #9333ea 0%, #9333ea ${grainSizeToPercent(currentParams.grainSize || 4410)}%, #374151 ${grainSizeToPercent(currentParams.grainSize || 4410)}%, #374151 100%)`
                                }}
                                aria-label="Grain Size"
                                title={`Grain size: ${grainSizeToMs(currentParams.grainSize || 4410)}ms`}
                            />
                            <span className="text-[9px] text-gray-500 w-10 text-right">{grainSizeToMs(currentParams.grainSize || 4410)}ms</span>
                        </div>
                        {/* Slice Mode Toggle */}
                        <div className="flex gap-1 items-center">
                            <label className="text-[9px] text-gray-500 w-12">Slice:</label>
                            <button
                                onClick={() => {
                                    const newVal = (currentParams.sliceMode === 'phoneme') ? 'off' : 'phoneme';
                                    if (onParamChange) onParamChange(activeBankIdx, 'sliceMode', newVal);
                                    else updateParamRef.current('sliceMode', newVal);
                                }}
                                className={`flex-1 h-4 text-[9px] font-bold rounded border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                                    currentParams.sliceMode === 'phoneme'
                                        ? 'bg-purple-600 border-purple-400 text-white'
                                        : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
                                }`}
                                aria-label="Toggle Slice Mode"
                                title="Map MIDI keys to phoneme slices"
                                aria-pressed={currentParams.sliceMode === 'phoneme'}
                            >
                                {currentParams.sliceMode === 'phoneme' ? 'ON (PHONEMES)' : 'OFF'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

                {/* ROW 6: Parameters for Active Bank */}
                <div className="grid grid-cols-4 gap-2 mt-1 bg-gray-800/30 p-1 rounded">
                    <Knob label="Speed" value={currentParams.playbackSpeed || 1} onChange={handleSpeedChange} min={0.1} max={4.0} color="purple" />
                    <Knob label="Vol" value={currentParams.volume} onChange={handleVolumeChange} min={0} max={2.0} color="purple" />
                    <Knob label="Filter" value={currentParams.filterCutoff} onChange={handleFilterChange} min={100} max={20000} color="purple" logarithmic />
                    <Knob label="Drive" value={currentParams.drive} onChange={handleDriveChange} min={0} max={1} color="red" />
                </div>

                {/* ROW 7: Rubberband Controls */}
                <div className="grid grid-cols-6 gap-1 mt-1 bg-indigo-900/50 p-1 rounded">
                    <Knob label="Time" value={currentParams.timeRatio ?? 1} onChange={handleTimeRatioChange} min={0.5} max={2.0} step={0.01} color="indigo" />
                    <Knob label="Pitch" value={currentParams.pitchScale ?? 1} onChange={handlePitchScaleChange} min={0.5} max={2.0} step={0.01} color="indigo" />
                    <Knob label="Formant" value={currentParams.formantShift ?? 0} onChange={handleFormantShiftChange} min={-12} max={12} step={0.1} color="indigo" />
                    <Knob label="Vibrato" value={currentParams.vibratoDepth ?? 0} onChange={handleVibratoDepthChange} min={0} max={100} color="indigo" />
                    <Knob label="Breath" value={currentParams.breathIntensity ?? 0} onChange={handleBreathIntensityChange} min={0} max={1.0} step={0.01} color="indigo" />
                    <div className="col-span-1" /> {/* Spacer */}
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
    // (App.tsx ensures immutable updates: new array + new object for changed bank)
    if (prev.params[prev.activeBankIdx] !== next.params[next.activeBankIdx]) return false;

    // 3. TTS phrases for active bank must be same
    const prevTTS = prev.ttsPhrases?.[prev.activeBankIdx];
    const nextTTS = next.ttsPhrases?.[next.activeBankIdx];
    if (prevTTS !== nextTTS) return false;

    // 4. Critical props check
    if (prev.audioEngine !== next.audioEngine) return false;
    // We assume handler functions are stable or we don't care if they change as long as data is same

    return true;
});
