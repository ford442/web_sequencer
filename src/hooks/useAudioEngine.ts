import { type AlignmentResult } from '../engines/rubberband/PhonemeAligner';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type {
    SamplerBankParams, SynthParams, AudioEngine, KickParams, SnareParams, HatParams,
    DrumSound, PartSequence
} from '../types';
import { WebGpuOscillator } from '../engines/WebGpuOscillator';
import { WasmOscillator } from '../engines/WasmOscillator';
import { Open303Oscillator } from '../engines/Open303Oscillator';
import { SingingVoice } from '../engines/SingingVoice';
import { noteToMidi } from '../utils/musicTheory';
import { noteToFrequency } from '../constants';

// Import extracted playback functions
import {
    playSynth,
    playDrum,
    playSampler,
    noteOnSampler,
    noteOffSampler,
    noteOnSynth,
    noteOffSynth,
    stopAllSynthNotes,
    stopAllSamplerNotes,
    loadSampleToEngine,
    prepareVocal,
    type SynthPlaybackContext,
    type SynthNoteState,
    type DrumPlaybackContext,
    type SamplerPlaybackContext,
    type SamplerState,
} from '../audio/playback';

// URLs for worklets
const sustainProcessorUrl = new URL('../audio-worklets/sustain-processor.ts', import.meta.url).href;
const open303ProcessorUrl = new URL('../audio-worklets/open303-processor.ts', import.meta.url).href;

export const useAudioEngine = (pyodide: unknown) => {
    const [isReady, setIsReady] = useState(false);
    const [audioEngine, setAudioEngine] = useState<AudioEngine | null>(null);
    const isInitializing = useRef(false);
    const singingVoiceRef = useRef<SingingVoice | null>(null);
    const sustainNodeRef = useRef<AudioWorkletNode | null>(null);
    const noiseBufferRef = useRef<AudioBuffer | null>(null);
    const ambianceSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
    const ambianceGainNodeRef = useRef<GainNode | null>(null);
    const loadedAmbianceBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
    const gpuEngineRef = useRef<WebGpuOscillator | null>(null);
    const wasmEngineRef = useRef<WasmOscillator | null>(null);
    const open303EngineRef = useRef<Open303Oscillator | null>(null);

    // Native WAV buffers
    const wavSawBufferRef = useRef<AudioBuffer | null>(null);
    const wavSqrBufferRef = useRef<AudioBuffer | null>(null);

    // Master Volume & Pan
    const masterGainRef = useRef<GainNode | null>(null);
    const masterPannerRef = useRef<StereoPannerNode | null>(null);

    const pyodideRef = useRef(pyodide);

    // Live note tracking
    const synthNoteStateRef = useRef<SynthNoteState>({
        nextNoteId: 1,
        activeNotes: new Map(),
    });
    const samplerNoteStateRef = useRef<SamplerState>({
        loadedSampleBuffers: new Map(),
        vocalAlignments: new Map(),
        nextNoteId: 1,
        activeNotes: new Map(),
    });

    useEffect(() => {
        pyodideRef.current = pyodide;
    }, [pyodide]);

    const initializeAudio = useCallback(async () => {
        if (audioEngine || isInitializing.current) return;
        isInitializing.current = true;

        try {
            const context = new (window.AudioContext || (window as typeof window & { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

            // Ensure AudioContext is running
            if (context.state === 'suspended') {
                await context.resume();
            }

            // --- MASTER CHAIN ---
            const masterGain = context.createGain();
            masterGain.gain.setValueAtTime(0.8, 0);
            masterGainRef.current = masterGain;

            let masterPanner: StereoPannerNode | null = null;
            if (context.createStereoPanner) {
                masterPanner = context.createStereoPanner();
                masterPanner.pan.setValueAtTime(0, 0);
                masterPannerRef.current = masterPanner;
                masterGain.connect(masterPanner);
                masterPanner.connect(context.destination);
            } else {
                masterGain.connect(context.destination);
            }

            // Initialize Engines
            const gpuEngine = new WebGpuOscillator();
            await gpuEngine.init().catch(() => {});
            gpuEngineRef.current = gpuEngine;

            const wasmEngine = new WasmOscillator();
            await wasmEngine.init().catch(() => {});
            wasmEngineRef.current = wasmEngine;

            // Initialize Open303 Engine (TB-303 clone)
            const open303Engine = new Open303Oscillator();
            const open303Ready = await open303Engine.init(context, open303ProcessorUrl);

            if (open303Ready) {
                open303Engine.connect(masterGain);
                open303EngineRef.current = open303Engine;
            }

            // Load WAV Files
            const loadWav = async (url: string) => {
                try {
                    const res = await fetch(url);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const arrayBuf = await res.arrayBuffer();
                    return await context.decodeAudioData(arrayBuf);
                } catch {
                    return null;
                }
            };

            const [sawBuf, sqrBuf] = await Promise.all([
                loadWav('./assets/saw.wav'),
                loadWav('./assets/square.wav')
            ]);
            wavSawBufferRef.current = sawBuf;
            wavSqrBufferRef.current = sqrBuf;

            // Initialize AudioWorklets
            try {
                await context.audioWorklet.addModule(sustainProcessorUrl);
                const sustainNode = new AudioWorkletNode(context, 'sustain-processor', {
                    numberOfInputs: 0,
                    numberOfOutputs: 1,
                    outputChannelCount: [2]
                });
                sustainNode.connect(masterGainRef.current!);
                sustainNodeRef.current = sustainNode;
            } catch {
                // Sustain worklet not available
            }

            // --- Singing Voice Init (Fail-safe) ---
            try {
                singingVoiceRef.current = new SingingVoice(context, {
                    useHighQuality: false,
                    preserveFormants: true,
                    channels: 1,
                    bufferSize: 16384,
                    enablePhonemeStretching: true
                });
                await singingVoiceRef.current.initWorklet();
                singingVoiceRef.current.getSourceNode().connect(masterGainRef.current!);
            } catch {
                // SingingVoice failed to init
            }

            // Noise Buffer
            const bufferSize = context.sampleRate * 2;
            const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
            const output = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                output[i] = Math.random() * 2 - 1;
            }
            noiseBufferRef.current = buffer;

            // Create playback contexts
            const synthCtx: SynthPlaybackContext = {
                context,
                masterGain,
                open303Engine: open303EngineRef.current,
                wavSawBuffer: wavSawBufferRef.current,
                wavSqrBuffer: wavSqrBufferRef.current,
            };

            const drumCtx: DrumPlaybackContext = {
                context,
                masterGain,
                noiseBuffer: noiseBufferRef.current,
            };

            const samplerCtx: SamplerPlaybackContext = {
                context,
                masterGain,
                singingVoice: singingVoiceRef.current,
            };

            // Wrapped playback functions
            const wrappedPlaySynth = (params: SynthParams, note: string, time: number, durationSteps: number = 1, stepTime: number = 0.2) => {
                playSynth(synthCtx, params, note, time, durationSteps, stepTime);
            };

            const wrappedPlayDrum = (sound: DrumSound, params: KickParams | SnareParams | HatParams, time: number) => {
                playDrum(drumCtx, sound, params, time);
            };

            const wrappedPlaySampler = (params: SamplerBankParams, note: string, time: number, durationSteps: number = 1, stepTime: number = 0.2) => {
                playSampler(samplerCtx, samplerNoteStateRef.current, params, note, time, durationSteps, stepTime);
            };

            const wrappedNoteOnSampler = (params: SamplerBankParams, _note: string, time?: number): number | null => {
                return noteOnSampler(samplerCtx, samplerNoteStateRef.current, params, _note, time);
            };

            const wrappedNoteOffSampler = (id: number) => {
                noteOffSampler(samplerCtx, samplerNoteStateRef.current, id);
            };

            const wrappedNoteOnSynth = (params: SynthParams, note: string, _time?: number): number | null => {
                return noteOnSynth(synthCtx, synthNoteStateRef.current, params, note, _time);
            };

            const wrappedNoteOffSynth = (id: number) => {
                noteOffSynth(synthNoteStateRef.current, id);
            };

            const stopAllNotes = () => {
                stopAllSynthNotes(synthNoteStateRef.current);
                stopAllSamplerNotes(samplerNoteStateRef.current);
            };

            const loadSample = (name: string, buffer: AudioBuffer) => {
                loadSampleToEngine(samplerNoteStateRef.current, name, buffer);
            };

            const prepareVocalWrapper = async (bankIndex: number, text: string) => {
                await prepareVocal(samplerNoteStateRef.current, singingVoiceRef.current, bankIndex, text);
            };

            // Helpers for Render/Ambiance
            const renderSynthPartToBuffer = (_params: SynthParams, _sequence: PartSequence, _tempo: number): Promise<AudioBuffer> => {
                return Promise.resolve(context.createBuffer(2, context.sampleRate * 2, context.sampleRate));
            };

            const playBufferedPart = (buffer: AudioBuffer, time: number) => {
                const src = context.createBufferSource();
                src.buffer = buffer;
                src.connect(masterGainRef.current!);
                src.start(time);
            };

            const playAmbiance = async (url: string) => {
                if (ambianceSourceNodeRef.current) {
                    ambianceSourceNodeRef.current.stop();
                }

                let buffer = loadedAmbianceBuffersRef.current.get(url);
                if (!buffer) {
                    const res = await fetch(url);
                    const ab = await res.arrayBuffer();
                    buffer = await context.decodeAudioData(ab);
                    loadedAmbianceBuffersRef.current.set(url, buffer);
                }

                if (ambianceGainNodeRef.current === null) {
                    ambianceGainNodeRef.current = context.createGain();
                    ambianceGainNodeRef.current.connect(masterGainRef.current!);
                }

                const src = context.createBufferSource();
                src.buffer = buffer;
                src.loop = true;
                src.connect(ambianceGainNodeRef.current);
                src.start(0);
                ambianceSourceNodeRef.current = src;
            };

            const stopAmbiance = () => {
                if (ambianceSourceNodeRef.current) {
                    ambianceSourceNodeRef.current.stop();
                    ambianceSourceNodeRef.current = null;
                }
            };

            const setAmbianceVolume = (v: number) => {
                if (ambianceGainNodeRef.current) {
                    ambianceGainNodeRef.current.gain.value = v;
                }
            };

            const setMasterVolume = (v: number) => {
                if (masterGainRef.current) {
                    masterGainRef.current.gain.value = v;
                }
            };

            const setGlobalPan = (v: number) => {
                if (masterPannerRef.current) {
                    masterPannerRef.current.pan.value = v;
                }
            };

            const detectSamplePitch = async (_b: AudioBuffer) => null;
            const processSinging = async (_sampleName: string, _note: string, _steps: number, _tempo: number) => null;
            const processSpoon = async (_sampleName: string, _note: string) => null;
            const setSustainMode = (_mode: 'loop' | 'stretch' | 'wavetable') => {};
            const setSustainGrainSize = (_size: number) => {};

            // Re-assign to state
            setAudioEngine({
                context,
                webGpuEngine: gpuEngineRef.current,
                wasmEngine: wasmEngineRef.current,
                open303Engine: open303EngineRef.current,
                singingVoice: singingVoiceRef.current || undefined,
                playSynth: wrappedPlaySynth,
                playDrum: wrappedPlayDrum,
                playSampler: wrappedPlaySampler,
                noteOnSampler: wrappedNoteOnSampler,
                noteOffSampler: wrappedNoteOffSampler,
                noteOnSynth: wrappedNoteOnSynth,
                noteOffSynth: wrappedNoteOffSynth,
                stopAllNotes,
                loadSampleToEngine: loadSample,
                renderSynthPartToBuffer,
                playBufferedPart,
                playAmbiance,
                stopAmbiance,
                setAmbianceVolume,
                setMasterVolume,
                setGlobalPan,
                detectSamplePitch,
                processSinging,
                processSpoon,
                prepareVocal: prepareVocalWrapper,
                setSustainMode,
                setSustainGrainSize
            });

            setIsReady(true);
            isInitializing.current = false;
        } catch (e) {
            console.error("CRITICAL AUDIO INIT FAILURE", e);
            // Even if audio fails, set ready so UI doesn't lock up
            setIsReady(true);
            isInitializing.current = false;
        }
    }, [audioEngine]);

    // Function to update voice parameters in real-time
    const updateVoiceParams = useCallback((_bankIdx: number, key: keyof SamplerBankParams, value: number) => {
        const voice = singingVoiceRef.current;
        if (voice) {
            switch (key) {
                case 'timeRatio':
                    voice.setTimeRatio(value);
                    break;
                case 'pitchScale':
                    voice.setPitch(value);
                    break;
                case 'formantShift':
                    voice.setFormantShift(value);
                    break;
                case 'vibratoDepth':
                    voice.setVibratoDepth(value);
                    break;
                case 'breathIntensity':
                    voice.setBreathIntensity(value);
                    break;
            }
        }
    }, []);

    return useMemo(() => ({
        audioEngine,
        isReady,
        initializeAudio,
        onParamChange: updateVoiceParams
    }), [audioEngine, isReady, initializeAudio, updateVoiceParams]);
};
