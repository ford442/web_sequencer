import React, { useRef, useState, useEffect, memo, useCallback, useMemo } from 'react';
import type { SamplerBankParams, SamplerParams, AudioEngine } from '../types';
import { SupertonicService } from '../services/Supertonic';
import { Knob } from './Knob';
import { WaveformDisplay } from './WaveformDisplay';
import { DrawableLFO } from './DrawableLFO';
import { SamplerPitchControls, type PitchControlValues } from './SamplerPitchControls';
import { PhonemeAligner } from '../engines/rubberband/PhonemeAligner';

interface SamplerPanelProps {
    params: SamplerParams; // Expecting Array[8]
    onChange: (updates: SamplerParams) => void; // Expecting full array update
    onLoadSample: (name: string, buffer: AudioBuffer, onProgress?: (progress: number) => void) => Promise<void>;
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
    // Phase 2: Melodic Lyric Mode
    melodicMode?: boolean;
    onMelodicModeChange?: (enabled: boolean) => void;
    // Multisample Generator
    multisampleProgress?: { bankIdx: number; progress: number; isProcessing: boolean } | null;
    /** Which banks have multisamples ready (fully processed) */
    multisampleReady?: boolean[];
    /** Which banks are currently processing */
    multisampleProcessing?: boolean[];
    // Slicing support
    alignment?: import('../engines/rubberband/PhonemeAligner').AlignmentResult | null;
    onAlignmentChange?: (alignment: import('../engines/rubberband/PhonemeAligner').AlignmentResult) => void;
}

// 8 Banks
const SAMPLE_BANKS = Array.from({ length: 8 }, (_, i) => `${i + 1}`);

// Helper functions for grain size calculations
const grainSizeToMs = (size: number) => Math.round(size / 441 * 10);
const grainSizeToPercent = (size: number) => ((size - 441) / (22050 - 441) * 100);

const SamplerPanelComponent: React.FC<SamplerPanelProps> = ({
    params, onChange, onLoadSample, audioContext, audioEngine, activeBankIdx, onBankChange, onOpenEditor,
    ttsPhrases, onTtsPhraseChange, onGenerateTTS,
    onHarmonize, onParamChange, loadedBanks, sampleBuffer, sliceHighlightRef,
    melodicMode = false, onMelodicModeChange,
    multisampleProgress,
    multisampleReady,
    multisampleProcessing,
    alignment,
    onAlignmentChange
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
    
    // Local multisample progress state
    const [localProgress, setLocalProgress] = useState<{ bankIdx: number; progress: number; isProcessing: boolean } | null>(null);
    
    // Combine external and local progress
    const activeProgress = multisampleProgress || localProgress;

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

    const modes: ('loop' | 'stretch' | 'wavetable')[] = ['loop', 'stretch', 'wavetable'];
    const modeRefs = useRef<(HTMLButtonElement | null)[]>([]);

    const handleModeKeyDown = (e: React.KeyboardEvent, index: number) => {
        let nextIndex = -1;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            nextIndex = (index + 1) % modes.length;
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            nextIndex = (index - 1 + modes.length) % modes.length;
        }

        if (nextIndex !== -1) {
            e.preventDefault();
            const newMode = modes[nextIndex];
            handleModeChange(newMode);
            // Focus new button - wait for render/update
            setTimeout(() => modeRefs.current[nextIndex]?.focus(), 0);
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
    const currentParams = useMemo(() => params[activeBankIdx] || {
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
        tremoloDepth: 0,
        tremoloRate: 0.1,
        breathIntensity: 0,
        freeze: 0,
        formantLfoRate: 0,
        formantLfoDepth: 0,
        characterMorph: 0,
        morphTarget: 'female' as 'default' | 'male' | 'female' | 'child' | 'deep' | 'bright',
        attack: 0.05,
        decay: 0.1,
        sustain: 1.0,
        release: 0.1,
        choir: 0,
        // Phase 1: Vocal Workstation defaults
        rootNote: 60,
        coarse: 0,
        fine: 0,
        formant: 0,
        pitchAttack: 0,
        pitchDecay: 0,
        rbQuality: 'Standard' as 'Fast' | 'Standard' | 'Elastic',
        stretchMode: 'Pitch' as 'Time' | 'Pitch' | 'Formant',
        autoFollow: false
    }, [params, activeBankIdx]);

    // Update single param for active bank
    const updateParam = (key: keyof typeof currentParams, value: number | string) => {
        const newParams = [...params];
        newParams[activeBankIdx] = { ...currentParams, [key]: value };
        onChange(newParams);
    };

    // Ref to access updateParam stably in callbacks even if params change
    const updateParamRef = useRef(updateParam);
    useEffect(() => { updateParamRef.current = updateParam; });

    // Stable Handlers for Knobs - factory pattern to avoid 20 identical useCallback blocks
    const paramHandlers = useMemo(() => {
        const paramNames = [
            'playbackSpeed', 'volume', 'filterCutoff', 'drive',
            'timeRatio', 'pitchScale', 'formantShift', 'vibratoDepth',
            'tremoloRate', 'tremoloDepth', 'breathIntensity', 'freeze',
            'freezeLfoRate', 'freezeLfoDepth', 'formantLfoRate', 'formantLfoDepth', 'characterMorph', 'attack', 'decay',
            'sustain', 'release', 'choir', 'glitchChance'
        ] as const;
        return Object.fromEntries(paramNames.map(p => [p, (v: number) => {
            if (onParamChange) onParamChange(activeBankIdx, p, v);
            else updateParamRef.current(p as any, v);
        }])) as Record<typeof paramNames[number], (v: number) => void>;
    }, [activeBankIdx, onParamChange]);

    const handleSpeedChange = paramHandlers.playbackSpeed;
    const handleVolumeChange = paramHandlers.volume;
    const handleFilterChange = paramHandlers.filterCutoff;
    const handleDriveChange = paramHandlers.drive;
    const handleTimeRatioChange = paramHandlers.timeRatio;
    const handlePitchScaleChange = paramHandlers.pitchScale;
    const handleFormantShiftChange = paramHandlers.formantShift;
    const handleVibratoDepthChange = paramHandlers.vibratoDepth;
    const handleTremoloRateChange = paramHandlers.tremoloRate;
    const handleTremoloDepthChange = paramHandlers.tremoloDepth;
    const handleBreathIntensityChange = paramHandlers.breathIntensity;
    const handleFreezeChange = paramHandlers.freeze;
    const handleFreezeLfoRateChange = paramHandlers.freezeLfoRate;
    const handleFreezeLfoDepthChange = paramHandlers.freezeLfoDepth;
    const handleFormantLfoRateChange = paramHandlers.formantLfoRate;
    const handleFormantLfoDepthChange = paramHandlers.formantLfoDepth;
    const handleCharacterMorphChange = paramHandlers.characterMorph;
    const handleAttackChange = paramHandlers.attack;
    const handleDecayChange = paramHandlers.decay;
    const handleSustainChange = paramHandlers.sustain;
    const handleReleaseChange = paramHandlers.release;
    const handleChoirChange = paramHandlers.choir;
    const handleGlitchChange = paramHandlers.glitchChance;

    // Phase 1: Vocal Workstation - Pitch Control Handlers
    const handlePitchControlChange = useCallback((key: keyof PitchControlValues, value: number | string | boolean) => {
        if (onParamChange) {
            onParamChange(activeBankIdx, key, value);
        } else {
            const newParams = [...params];
            newParams[activeBankIdx] = { ...currentParams, [key]: value };
            onChange(newParams);
        }
        
        // Apply to audio engine immediately for real-time feedback
        if (audioEngine?.singingVoice) {
            const voice = audioEngine.singingVoice;
            switch (key) {
                case 'coarse':
                case 'fine': {
                    // Calculate combined pitch scale
                    const coarse = key === 'coarse' ? (value as number) : (currentParams.coarse ?? 0);
                    const fine = key === 'fine' ? (value as number) : (currentParams.fine ?? 0);
                    const scale = Math.pow(2, (coarse + fine / 1200) / 12);
                    voice.setPitch(scale);
                    break;
                }
                case 'formant':
                    voice.setFormantShift(value as number);
                    break;
                case 'rbQuality': {
                    // Map quality to RubberBand options
                    const qualityMap = {
                        'Fast': 1 | 16,      // RealTime | Faster
                        'Standard': 1 | 32,   // RealTime | Finer
                        'Elastic': 1 | 32 | 1048576 // RealTime | Finer | FormantPreserved
                    };
                    // Note: Actual quality change requires worklet reinit or message
                    const node = voice.getSourceNode();
                    if (node && 'port' in node) {
                        (node as AudioWorkletNode).port.postMessage({
                            type: 'setQuality',
                            options: qualityMap[value as keyof typeof qualityMap]
                        });
                    }
                    break;
                }
                case 'autoFollow':
                    // Enable/disable auto pitch following
                    const node2 = voice.getSourceNode();
                    if (node2 && 'port' in node2) {
                        (node2 as AudioWorkletNode).port.postMessage({
                            type: 'setAutoFollow',
                            enabled: value as boolean
                        });
                    }
                    break;
            }
        }
    }, [activeBankIdx, onParamChange, currentParams, audioEngine, params, onChange]);

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
        // TTS is initialized at app startup (App.tsx handleStart).
        // Poll isServiceReady() until the models finish loading.
        const ready = SupertonicService.getInstance().isServiceReady();
        if (ready) {
            setTtsReady(true);
            return;
        }
        const interval = setInterval(() => {
            if (SupertonicService.getInstance().isServiceReady()) {
                setTtsReady(true);
                clearInterval(interval);
            }
        }, 500);
        return () => clearInterval(interval);
    }, []);

    const loadBufferToBank = async (buffer: AudioBuffer) => {
        const bankName = `bank_${activeBankIdx}`;
        
        // Start progress tracking
        setLocalProgress({ bankIdx: activeBankIdx, progress: 0, isProcessing: true });
        setStatus('Processing...');
        
        try {
            await onLoadSample(bankName, buffer, (progress) => {
                if (progress === -1) {
                    setLocalProgress(prev => prev ? { ...prev, isProcessing: false } : null);
                    setStatus('Processing Error');
                } else if (progress >= 1.0) {
                    setLocalProgress(null);
                    setStatus(`Ready: ${bankName}`);
                } else {
                    setLocalProgress({ bankIdx: activeBankIdx, progress, isProcessing: true });
                }
            });

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
        } catch (err) {
            console.error('Failed to load sample:', err);
            setLocalProgress(null);
            setStatus('Load Error');
        }
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
            await loadBufferToBank(audioBuffer);
        } catch {
            setStatus('Load Error');
            setLocalProgress(null);
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
    const [currentAlignment, setCurrentAlignment] = useState(
        (audioEngine?.getAlignment && activeBankIdx >= 0) ? audioEngine.getAlignment(activeBankIdx) : null
    );

    // Sync local state when bank or engine alignment changes
    useEffect(() => {
        const alg = (audioEngine?.getAlignment && activeBankIdx >= 0) ? audioEngine.getAlignment(activeBankIdx) : null;
        setCurrentAlignment(alg);
    }, [activeBankIdx, audioEngine]);

    const handleAlignmentChange = useCallback((newAlignment: any) => {
        setCurrentAlignment(newAlignment);
        if (audioEngine?.setAlignment && activeBankIdx >= 0) {
            audioEngine.setAlignment(activeBankIdx, newAlignment);
        }
    }, [audioEngine, activeBankIdx]);

    const [autoSliceSensitivity, setAutoSliceSensitivity] = useState(50);

    const handleAutoSlice = useCallback(() => {
        if (!sampleBuffer) return;

        try {
            // Downmix to mono if stereo
            const floatData = new Float32Array(sampleBuffer.length);
            if (sampleBuffer.numberOfChannels === 2) {
                const left = sampleBuffer.getChannelData(0);
                const right = sampleBuffer.getChannelData(1);
                for (let i = 0; i < floatData.length; i++) {
                    floatData[i] = (left[i] + right[i]) * 0.5;
                }
            } else {
                floatData.set(sampleBuffer.getChannelData(0));
            }

            // Sensitivity 0 -> multiplier 3.0 (fewer slices)
            // Sensitivity 100 -> multiplier 0.1 (more slices)
            const thresholdMultiplier = 3.0 - (autoSliceSensitivity / 100) * 2.9;

            // Target -1 triggers the peak-based transient detection
            const segments = PhonemeAligner.detectSegmentBoundaries(floatData, sampleBuffer.sampleRate, -1, thresholdMultiplier);

            // Map segments to the expected PhonemeAligner alignment format
            const phonemes = segments.map((seg, idx) => ({
                phoneme: `S${idx + 1}`,
                start: seg.start,
                end: seg.end,
                isVowel: true, // Mark all slices as stretchable
                category: 'plosive' as const
            }));

            const newAlignment = {
                phonemes,
                sampleRate: sampleBuffer.sampleRate,
                duration: sampleBuffer.duration,
                text: ''
            };

            handleAlignmentChange(newAlignment);
        } catch (e) {
            console.error("Auto-slice failed:", e);
        }
    }, [sampleBuffer, handleAlignmentChange, autoSliceSensitivity]);

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
                {/* Bank Tabs - Mobile touch optimized */}
                <div className="flex gap-1 overflow-x-auto scrollbar-none touch-pan-x" role="tablist" aria-label="Sample Banks">
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
                            className={`relative min-w-[36px] min-h-[44px] py-2 px-2 text-[11px] font-bold border rounded transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 touch-manipulation select-none ${
                                flashBankIdx === i ? 'bg-green-600 border-green-400 text-white animate-pulse' :
                                activeBankIdx === i
                                    ? 'bg-purple-600 border-purple-400 text-white shadow-md'
                                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'
                            }`}
                            title={`Select Bank ${i+1}${multisampleReady?.[i] ? ' (Multisample Ready)' : loadedBanks?.[i] ? ' (Loaded)' : ''}`}
                            style={{ touchAction: 'manipulation' }}
                        >
                            {label}
                            {/* Status indicators */}
                            <div className="absolute -top-0.5 -right-0.5 flex">
                                {multisampleProcessing?.[i] && (
                                    <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse border border-black" 
                                         title="Processing multisamples..." />
                                )}
                                {!multisampleProcessing?.[i] && multisampleReady?.[i] && (
                                    <div className="w-2 h-2 bg-cyan-500 rounded-full shadow-[0_0_4px_rgba(6,182,212,0.8)] border border-black" 
                                         title="Multisample ready" />
                                )}
                                {!multisampleReady?.[i] && loadedBanks?.[i] && (
                                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_4px_rgba(34,197,94,0.8)] border border-black" 
                                         title="Sample loaded" />
                                )}
                            </div>
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
            <div
                id="sampler-bank-panel"
                role="tabpanel"
                aria-labelledby={`sampler-bank-tab-${activeBankIdx}`}
                className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-gray-700"
            >

                {/* 1. Waveform Visualization / Custom Sample Slicing UI */}
                <div className="flex justify-between items-center px-1 mb-1">
                    <span className="text-[10px] font-orbitron font-bold text-gray-400">CUSTOM SAMPLE SLICING UI</span>
                </div>
                <WaveformDisplay
                    buffer={sampleBuffer || null}
                    alignment={currentAlignment}
                    sliceHighlightRef={sliceHighlightRef || dummyRef}
                    onAlignmentChange={handleAlignmentChange}
                    onAutoSlice={handleAutoSlice}
                    autoSliceSensitivity={autoSliceSensitivity}
                    onAutoSliceSensitivityChange={setAutoSliceSensitivity}
                />

                {/* Multisample Generator Progress */}
                {activeProgress?.bankIdx === activeBankIdx && activeProgress.isProcessing && (
                    <div className="bg-gray-800/50 rounded p-2 border border-purple-500/30">
                        <div className="flex items-center justify-between text-[9px] text-purple-300 mb-1.5">
                            <span className="flex items-center gap-1.5">
                                <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                Generating Multisamples...
                            </span>
                            <span className="font-mono">{Math.round(activeProgress.progress * 100)}%</span>
                        </div>
                        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-gradient-to-r from-purple-500 via-cyan-500 to-purple-500 transition-all duration-200 ease-out"
                                style={{ width: `${activeProgress.progress * 100}%` }}
                            />
                        </div>
                        <div className="text-[8px] text-gray-500 mt-1">
                            Pre-rendering pitch variations for instant playback
                        </div>
                    </div>
                )}

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
                            aria-label="Clear Text-to-Speech phrase input"
                            title="Clear Text-to-Speech phrase input"
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
                            className="flex items-center gap-1.5 px-2 h-5 bg-purple-900 border border-purple-600 text-purple-200 rounded text-[10px] hover:bg-purple-800 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 transition-all"
                            aria-label={isGenerating ? "Generating Speech..." : "Generate Speech"}
                            aria-busy={isGenerating}
                        >
                            {isGenerating ? (
                                <svg className="animate-spin h-2.5 w-2.5 text-purple-200" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1M12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" clipRule="evenodd" />
                                </svg>
                            )}
                            GEN
                        </button>
                        {onOpenEditor && (
                            <button
                                onClick={onOpenEditor}
                                className="text-[10px] text-purple-400 underline hover:text-white px-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
                                aria-label="Open Voice Editor for Text-to-Speech"
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
                            className={`flex items-center gap-1.5 px-2 h-5 bg-cyan-900 border border-cyan-600 text-cyan-200 rounded text-[10px] hover:bg-cyan-800 disabled:opacity-50 font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 transition-all ${isProcessingHarmonize ? 'cursor-wait' : ''}`}
                            aria-label={isProcessingHarmonize ? "Applying Harmonization..." : "Apply Harmonization"}
                            aria-busy={isProcessingHarmonize}
                        >
                            {isProcessingHarmonize ? (
                                <svg className="animate-spin h-2.5 w-2.5 text-cyan-200" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z" />
                                </svg>
                            )}
                            HARM
                        </button>
                    </div>
                </div>

                {/* 3. Mode Selector */}
                <div className="bg-gray-800/30 p-1.5 rounded">
                    <div className="flex gap-1 items-center mb-1.5">
                        <label className="text-[10px] text-gray-400 font-bold w-10" id="sampler-mode-label">MODE:</label>
                        <div className="flex gap-1 flex-1" role="radiogroup" aria-labelledby="sampler-mode-label">
                            {modes.map((mode, i) => {
                                const isSelected = (currentParams.mode || 'loop') === mode;
                                return (
                                    <button
                                        key={mode}
                                        ref={(el) => { modeRefs.current[i] = el; }}
                                        onClick={() => handleModeChange(mode)}
                                        onKeyDown={(e) => handleModeKeyDown(e, i)}
                                        tabIndex={isSelected ? 0 : -1}
                                        className={`flex-1 px-1 h-6 text-[9px] font-bold rounded border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                                            isSelected
                                                ? 'bg-purple-600 border-purple-400 text-white'
                                                : 'bg-gray-800 border-gray-600 text-gray-400 hover:bg-gray-700'
                                        }`}
                                        aria-label={`${mode.charAt(0).toUpperCase() + mode.slice(1)} Mode`}
                                        role="radio"
                                        aria-checked={isSelected}
                                    >
                                        {mode === 'wavetable' ? 'WAVE' : mode.toUpperCase()}
                                    </button>
                                );
                            })}
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
                                    aria-valuetext={grainSizeToMs(currentParams.grainSize || 4410) + 'ms'}
                                    title="Grain Size"
                                />
                                <span className="text-[9px] text-gray-500 w-8 text-right">{grainSizeToMs(currentParams.grainSize || 4410)}ms</span>
                            </div>
                            <div className="flex gap-1 items-center">
                                <label id="sampler-slice-label" className="text-[9px] text-gray-500 w-10">Slice:</label>
                                <button
                                    aria-label="Toggle Phoneme Slice Mode"
                                    aria-pressed={currentParams.sliceMode === 'phoneme'}
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
                                >
                                    {currentParams.sliceMode === 'phoneme' ? 'ON (PHONEMES)' : 'OFF'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Phase 2: Melodic Lyric Mode Toggle */}
                <div className="bg-gradient-to-r from-purple-900/30 to-indigo-900/30 border border-purple-500/30 p-2 rounded">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-purple-400" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M18 3a1 1 0 00-1.447-.894L8.763 6H5a3 3 0 000 6h.28l1.771 5.316A1 1 0 008 18h1a1 1 0 001-1v-4.382l6.553 3.276A1 1 0 0018 15V3z" />
                            </svg>
                            <div>
                                <label className="text-[10px] text-purple-300 font-bold block">MELODIC LYRIC MODE</label>
                                <span className="text-[9px] text-gray-500">Drag steps to set pitch</span>
                            </div>
                        </div>
                        <button
                            onClick={() => onMelodicModeChange?.(!melodicMode)}
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                                melodicMode ? 'bg-purple-600' : 'bg-gray-700'
                            }`}
                            aria-label="Melodic Mode"
                            role="switch"
                            aria-checked={melodicMode}
                        >
                            <span
                                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                                    melodicMode ? 'translate-x-5' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>
                    {melodicMode && (
                        <div className="mt-2 pt-2 border-t border-purple-500/20">
                            <div className="flex items-center gap-2 text-[9px] text-gray-400">
                                <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-red-500"></span> C
                                </span>
                                <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-orange-500"></span> D
                                </span>
                                <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-yellow-500"></span> E
                                </span>
                                <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-green-500"></span> F
                                </span>
                                <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-cyan-500"></span> G
                                </span>
                                <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-blue-500"></span> A
                                </span>
                                <span className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-purple-500"></span> B
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                {/* 4. Vocal Workstation - Pitch Controls (Phase 1) */}
                <SamplerPitchControls
                    bankId={activeBankIdx}
                    values={{
                        rootNote: currentParams.rootNote ?? 60,
                        coarse: currentParams.coarse ?? 0,
                        fine: currentParams.fine ?? 0,
                        formant: currentParams.formant ?? 0,
                        pitchAttack: currentParams.pitchAttack ?? 0,
                        pitchDecay: currentParams.pitchDecay ?? 0,
                        rbQuality: currentParams.rbQuality ?? 'Standard',
                        stretchMode: currentParams.stretchMode ?? 'Pitch',
                        autoFollow: currentParams.autoFollow ?? false,
                    }}
                    onChange={handlePitchControlChange}
                />

                {/* 5. Controls Wrapper - Use flex-wrap to prevent cut-off */}
                <div className="flex flex-wrap gap-4 mt-1 pb-4">
                    {/* Basic Params Group */}
                    <div className="flex-1 min-w-[140px] bg-gray-800/30 p-2 rounded">
                        <div className="text-[9px] text-gray-500 font-bold mb-1 border-b border-gray-700 pb-0.5">BASIC</div>
                        <div className="grid grid-cols-2 gap-2">
                            <Knob label="Speed" value={currentParams.playbackSpeed || 1} onChange={handleSpeedChange} min={0.1} max={4.0} color="purple" unit="x" />
                            <Knob label="Vol" value={currentParams.volume} onChange={handleVolumeChange} min={0} max={2.0} color="purple" />
                            <Knob label="Filter" value={currentParams.filterCutoff} onChange={handleFilterChange} min={100} max={20000} color="purple" logarithmic unit="Hz" />
                            <Knob label="Drive" value={currentParams.drive} onChange={handleDriveChange} min={0} max={1} color="red" />
                        </div>
                    </div>

                    {/* Rubberband/Granular Params Group */}
                    <div className="flex-[2] min-w-[200px] bg-indigo-900/50 p-2 rounded">
                        <div className="text-[9px] text-indigo-300 font-bold mb-1 border-b border-indigo-800 pb-0.5">ENGINE</div>
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-8 gap-2">
                            <Knob label="Time" value={currentParams.timeRatio ?? 1} onChange={handleTimeRatioChange} min={0.5} max={2.0} step={0.01} color="indigo" unit="x" />
                            <Knob label="Pitch" value={currentParams.pitchScale ?? 1} onChange={handlePitchScaleChange} min={0.5} max={2.0} step={0.01} color="indigo" unit="x" />
                            <Knob label="Formant" value={currentParams.formantShift ?? 0} onChange={handleFormantShiftChange} min={-12} max={12} step={0.1} color="indigo" />
                            <Knob label="Vibrato" value={currentParams.vibratoDepth ?? 0} onChange={handleVibratoDepthChange} min={0} max={100} color="indigo" unit="%" />
                            <Knob label="Trem Depth" value={currentParams.tremoloDepth ?? 0} onChange={handleTremoloDepthChange} min={0} max={100} color="indigo" unit="%" />
                            <Knob label="Trem Rate" value={currentParams.tremoloRate ?? 0.1} onChange={handleTremoloRateChange} min={0.1} max={20.0} step={0.1} color="indigo" unit="Hz" />
                            <Knob label="Breath" value={currentParams.breathIntensity ?? 0} onChange={handleBreathIntensityChange} min={0} max={1.0} step={0.01} color="indigo" />
                            <Knob label="Freeze" value={currentParams.freeze ?? 0} onChange={handleFreezeChange} min={0} max={1.0} step={0.01} color="indigo" unit="%" />
                            <Knob label="Frz LFO Rate" value={currentParams.freezeLfoRate ?? 0} onChange={handleFreezeLfoRateChange} min={0} max={20.0} step={0.1} color="indigo" unit="Hz" />
                            <Knob label="Frz LFO Depth" value={currentParams.freezeLfoDepth ?? 0} onChange={handleFreezeLfoDepthChange} min={0} max={1.0} step={0.01} color="indigo" unit="%" />
                            <Knob label="Fmt LFO Rate" value={currentParams.formantLfoRate ?? 0} onChange={handleFormantLfoRateChange} min={0} max={20.0} step={0.1} color="indigo" unit="Hz" />
                            <Knob label="Fmt LFO Depth" value={currentParams.formantLfoDepth ?? 0} onChange={handleFormantLfoDepthChange} min={0} max={1.0} step={0.01} color="indigo" unit="%" />

                            {/* Custom LFO Shape */}
                            <div className="flex flex-col items-center justify-start gap-1 col-span-2">
                                <div className="text-[9px] text-indigo-300 font-bold mb-0.5">CUSTOM LFO SHAPE</div>
                                <DrawableLFO
                                    resolution={64}
                                    value={currentParams.customLfoShape || Array(64).fill(0.5)}
                                    onChange={(newValue: number[]) => {
                                        if (onParamChange) onParamChange(activeBankIdx, 'customLfoShape', newValue as any);
                                        else updateParamRef.current('customLfoShape' as any, newValue as any);
                                    }}
                                    width={120}
                                    height={40}
                                />
                            </div>

                            {/* Morph Controls */}
                            <div className="flex flex-col items-center justify-start gap-1">
                                <Knob label="Morph" value={currentParams.characterMorph ?? 0} onChange={handleCharacterMorphChange} min={0} max={1.0} step={0.01} color="indigo" unit="%" />
                                <select
                                    value={currentParams.morphTarget ?? 'female'}
                                    onChange={(e) => updateParamRef.current('morphTarget', e.target.value)}
                                    className="w-[50px] bg-indigo-950 text-[8px] text-indigo-300 border border-indigo-700 rounded px-0.5 py-0.5 outline-none focus:border-indigo-400 mt-1"
                                    title="Morph Target Character"
                                    aria-label="Morph Target Character"
                                >
                                    <option value="male">Male</option>
                                    <option value="female">Female</option>
                                    <option value="child">Child</option>
                                    <option value="deep">Deep</option>
                                    <option value="bright">Bright</option>
                                </select>
                            </div>

                            <Knob label="Choir" value={currentParams.choir ?? 0} onChange={handleChoirChange} min={0} max={1.0} step={0.01} color="indigo" />
                            <Knob label="Glitch" value={currentParams.glitchChance ?? 0} onChange={handleGlitchChange} min={0} max={1.0} step={0.01} color="indigo" unit="%" />
                            <Knob label="Attack" value={currentParams.attack ?? 0.05} onChange={handleAttackChange} min={0.001} max={2.0} step={0.01} color="indigo" unit="s" />
                            <Knob label="Decay" value={currentParams.decay ?? 0.1} onChange={handleDecayChange} min={0.001} max={2.0} step={0.01} color="indigo" unit="s" />
                            <Knob label="Sustain" value={currentParams.sustain ?? 1.0} onChange={handleSustainChange} min={0} max={1.0} step={0.01} color="indigo" />
                            <Knob label="Release" value={currentParams.release ?? 0.1} onChange={handleReleaseChange} min={0.001} max={5.0} step={0.01} color="indigo" unit="s" />
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

    // 9. Check alignment
    if (prev.alignment !== next.alignment) return false;

    return true;
});
