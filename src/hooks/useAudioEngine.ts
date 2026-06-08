import { type AlignmentResult } from '../engines/rubberband/PhonemeAligner';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type {
    SamplerBankParams, SynthParams, AudioEngine, PartSequence, MultisampleBank, PhonemeData
} from '../types';
import { WebGpuOscillator } from '../engines/WebGpuOscillator';
import { WasmOscillator } from '../engines/WasmOscillator';
import { RustOscillator } from '../engines/RustOscillator';
import { Open303Manager } from '../engines/Open303Manager';
import { ProphecyManager } from '../engines/ProphecyManager';
import { PcfEffect } from '../engines/PcfEffect';
import { SingingVoice } from '../engines/SingingVoice';
import { SingingVoiceManager } from '../engines/SingingVoiceManager';
import { VoiceManager } from '../engines/VoiceManager';
import { DrumKitEngine } from '../engines/DrumKitEngine';
import { noteToMidi, type ScaleDefinition } from '../utils/musicTheory';
import { MultisampleGenerator } from '../engines/MultisampleGenerator';
import { Harmonizer, type HarmonizerConfig } from '../engines/Harmonizer';
import { PhonemeBufferPool } from '../services/PhonemeBufferPool';
import {
    createAmbianceControls,
    createNoteOnSynth,
    createPlayDrum,
    createPlaySynth,
    createStopAllNotes,
    noteOffSynth,
    setGlobalPan as setMasterPan,
    setHarmonizerConfig as applyHarmonizerConfig,
    setMasterVolume as setMasterGainVolume,
    setMasterSaturation as setMasterGainSaturation,
    type PlaybackRefs,
} from './audioEngine/audioPlayback';
import { makeDistortionCurve } from './audioEngine/distortion';
import {
    applySamplerVoiceParamUpdate,
    applyVoiceParamUpdate,
    createSampleLibraryControls,
} from './audioEngine/sampleManagement';
import {
    createNoiseBuffer,
    initializeHarmonizer,
    initializeChoirBuses,
    initializeMasterOutput,
    initializeHarmonyBus,
    initializeSustainProcessor,
    loadWavBuffer,
    createReverbImpulseResponse,
} from './audioEngine/initialization';
import { engineTelemetry } from '../utils/engineTelemetry';
import { loadingProgressStore } from '../stores/loadingProgressStore';

// URLs for worklets
import sustainProcessorUrl from '../audio-worklets/sustain-processor.ts?worker&url';
import open303ProcessorUrl from '../audio-worklets/open303-processor.ts?worker&url';
import prophecyProcessorUrl from '../audio-worklets/prophecy-processor.ts?worker&url';
import vocalOverdriveProcessorUrl from '../audio-worklets/vocal-overdrive-processor.ts?worker&url';
import expressiveVoiceProcessorUrl from '../audio-worklets/expressive-voice-processor.ts?worker&url';
import expressiveVoiceProcessorWorkletUrl from '../audio-worklets/expressive-voice-processor-worklet.ts?worker&url';

type AudioWindow = Window & typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
    audioContext?: AudioContext;
};

type ResolvedExpressiveness = {
    vibratoRate: number;
    vibratoDepth: number;
    tremoloDepth: number;
    breathAmount: number;
};

const resolveExpressiveness = (params: SamplerBankParams): ResolvedExpressiveness => {
    const cfg = params.expressiveness;
    const normalizeDepth = (value: number | undefined) => {
        if (value === undefined) return 0;
        // Backward compatibility: older UI/state stores depths as 0-100 percentages,
        // while newer expressiveness config stores normalized 0-1 values.
        return value > 1 ? value / 100 : value;
    };
    return {
        vibratoRate: cfg?.vibratoRate ?? 5.5,
        vibratoDepth: normalizeDepth(cfg?.vibratoDepth ?? params.vibratoDepth),
        tremoloDepth: normalizeDepth(cfg?.tremoloDepth ?? params.tremoloDepth),
        breathAmount: cfg?.breathAmount ?? params.breathIntensity ?? 0,
    };
};

const EXPRESSIVE_STOP_BUFFER_SECONDS = 0.02;

export const useAudioEngine = (pyodide: unknown, tempo: number = 120) => {
    const [isReady, setIsReady] = useState(false);
    const [audioEngine, setAudioEngine] = useState<AudioEngine | null>(null);
    const isInitializing = useRef(false);

    // Polyphonic TTS Manager
    const singingVoiceManagerRef = useRef<SingingVoiceManager | null>(null);

    // Pre-stretched phoneme buffer pool (phoneme-aware time stretching)
    const phonemeBufferPoolRef = useRef<PhonemeBufferPool | null>(null);
    
    // Harmonizer for layered vocals
    const harmonizerRef = useRef<Harmonizer | null>(null);
    const harmonyBusGainRef = useRef<GainNode | null>(null);

    // Left/Right Choir Panning
    const choirLeftGainRef = useRef<GainNode | null>(null);
    const choirRightGainRef = useRef<GainNode | null>(null);
    const choirLeftPannerRef = useRef<StereoPannerNode | null>(null);
    const choirRightPannerRef = useRef<StereoPannerNode | null>(null);

    // Vocal Harmony Parallel Bus
    const harmonyCompressorRef = useRef<DynamicsCompressorNode | null>(null);
    const harmonyEQRef = useRef<BiquadFilterNode | null>(null);
    const harmonyWidenerDelayRef = useRef<DelayNode | null>(null);
    const harmonyWidenerGainRef = useRef<GainNode | null>(null);

    const sustainNodeRef = useRef<AudioWorkletNode | null>(null);
    const noiseBufferRef = useRef<AudioBuffer | null>(null);
    const ambianceSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
    const ambianceGainNodeRef = useRef<GainNode | null>(null);
    const loadedAmbianceBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
    const gpuEngineRef = useRef<WebGpuOscillator | null>(null);
    const wasmEngineRef = useRef<WasmOscillator | null>(null);
    const rustEngineRef = useRef<RustOscillator | null>(null);
    const analyserNodeRef = useRef<AnalyserNode | null>(null);
    const open303ManagerRef = useRef<Open303Manager | null>(null);
    const prophecyManagerRef = useRef<ProphecyManager | null>(null);
    const pcfEffectRef = useRef<PcfEffect | null>(null);

    // Voice Managers
    const voiceManagerARef = useRef<VoiceManager | null>(null);
    const voiceManagerBRef = useRef<VoiceManager | null>(null);

    // Native WAV buffers
    const wavSawBufferRef = useRef<AudioBuffer | null>(null);
    const wavSqrBufferRef = useRef<AudioBuffer | null>(null);

    // Master Volume & Pan
    const masterGainRef = useRef<GainNode | null>(null);
    const masterSaturationRef = useRef<WaveShaperNode | null>(null);
    const sidechainGainRef = useRef<BiquadFilterNode | null>(null);
    const bassSidechainEQBusRef = useRef<BiquadFilterNode | null>(null);
    const sidechainBusRef = useRef<GainNode | null>(null);
    const masterCompressorRef = useRef<DynamicsCompressorNode | null>(null);
    const reverbNodesRef = useRef<Record<string, ConvolverNode>>({});
    const reverbNodeRef = useRef<ConvolverNode | null>(null); // Keep for backwards compatibility if needed temporarily
    const reverbTypeRef = useRef<'room' | 'plate' | 'hall'>('plate');
    const delayNodeRef = useRef<DelayNode | null>(null);
    const delayFeedbackRef = useRef<GainNode | null>(null);
    const masterPannerRef = useRef<StereoPannerNode | null>(null);

    const pyodideRef = useRef(pyodide);

    // Live note tracking
    const nextSynthNoteId = useRef(1);
    const activeSynthNotes = useRef(new Map<number, { stop: () => void }>());
    const nextSamplerNoteId = useRef(1);
    const activeSamplerNotes = useRef(new Map<number, {
        source: AudioBufferSourceNode;
        envGain: GainNode;
        expressiveNode?: AudioWorkletNode | null;
        releaseTime?: number;
    }>());

    const loadedSampleBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
    const vocalAlignmentsRef = useRef<Map<string, AlignmentResult>>(new Map());
    
    // Multisample Generator
    const multisampleGeneratorRef = useRef<MultisampleGenerator | null>(null);
    const multisampleBanksRef = useRef<Map<string, MultisampleBank>>(new Map());

    // Drum Kit Engine (initialized with default 808)
    const drumKitEngineRef = useRef<DrumKitEngine>(new DrumKitEngine('808'));

    const playbackRefs = useMemo<PlaybackRefs>(() => ({
        masterGainRef,
        masterSaturationRef,
        masterCompressorRef,
        reverbNodesRef,
        reverbTypeRef,
        delayNodeRef,
        delayFeedbackRef,
        masterPannerRef,
        noiseBufferRef,
        open303ManagerRef,
        prophecyManagerRef,
        voiceManagerARef,
        voiceManagerBRef,
        nextSynthNoteId,
        activeSynthNotes,
        activeSamplerNotes,
        ambianceSourceNodeRef,
        ambianceGainNodeRef,
        loadedAmbianceBuffersRef,
        singingVoiceManagerRef,
        harmonizerRef,
        sidechainGainRef,
        bassSidechainEQBusRef,
        sidechainBusRef,
        drumKitEngineRef,
    }), []);

    useEffect(() => {
        pyodideRef.current = pyodide;
    }, [pyodide]);

    const initializeAudio = useCallback(async () => {
        if (audioEngine || isInitializing.current) return;
        isInitializing.current = true;
        loadingProgressStore.startLoading();

        try {
            loadingProgressStore.startStep('audioContext');
            const audioWindow = window as AudioWindow;
            const AudioContextCtor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
            if (!AudioContextCtor) {
                throw new Error('AudioContext is not available in this browser');
            }
            const context = new AudioContextCtor();
            audioWindow.audioContext = context;

            // --- CRITICAL FIX: Ensure AudioContext is running ---
            if (context.state === 'suspended') {
                await context.resume();
                console.log("AudioContext resumed");
            }
            loadingProgressStore.completeStep('audioContext');

            loadingProgressStore.startStep('masterChain');
            const masterBusInput = initializeMasterOutput(context, masterGainRef, masterPannerRef, masterSaturationRef, masterCompressorRef, sidechainGainRef, bassSidechainEQBusRef, analyserNodeRef);

            // Initialize Vocal Harmony Parallel Bus
            const harmonyGain = context.createGain();
            harmonyGain.gain.value = 1.0;
            harmonyBusGainRef.current = harmonyGain;

            const harmonyCompressor = context.createDynamicsCompressor();
            harmonyCompressor.threshold.setValueAtTime(-18, context.currentTime);
            harmonyCompressor.knee.setValueAtTime(6, context.currentTime);
            harmonyCompressor.ratio.setValueAtTime(4, context.currentTime);
            harmonyCompressor.attack.setValueAtTime(0.01, context.currentTime);
            harmonyCompressor.release.setValueAtTime(0.1, context.currentTime);
            harmonyCompressorRef.current = harmonyCompressor;

            const harmonyEQ = context.createBiquadFilter();
            harmonyEQ.type = 'lowshelf';
            harmonyEQ.frequency.setValueAtTime(250, context.currentTime);
            harmonyEQ.gain.setValueAtTime(-3.0, context.currentTime);
            harmonyEQRef.current = harmonyEQ;

            harmonyGain.connect(harmonyCompressor);
            harmonyCompressor.connect(harmonyEQ);

            // Initialize Haas Effect Stereo Widener
            // Split into L/R, delay R by up to 30ms, then merge
            const widenerSplitter = context.createChannelSplitter(2);
            const widenerMerger = context.createChannelMerger(2);
            const widenerDelay = context.createDelay(0.05);
            widenerDelay.delayTime.value = 0.0;
            harmonyWidenerDelayRef.current = widenerDelay;

            // Connect EQ to splitter
            harmonyEQ.connect(widenerSplitter);

            // Left channel passes through
            widenerSplitter.connect(widenerMerger, 0, 0);

            // Right channel is delayed
            widenerSplitter.connect(widenerDelay, 1);
            widenerDelay.connect(widenerMerger, 0, 1);

            // Connect widener merger to master
            widenerMerger.connect(masterSaturationRef.current!);

            // Initialize Reverb Node
            // Initialize Reverb Nodes (Room, Plate, Hall)
            const roomNode = context.createConvolver();
            roomNode.buffer = createReverbImpulseResponse(context, 0.5, 1.0);
            roomNode.connect(masterBusInput);

            const plateNode = context.createConvolver();
            plateNode.buffer = createReverbImpulseResponse(context, 1.5, 2.0);
            plateNode.connect(masterBusInput);

            const hallNode = context.createConvolver();
            hallNode.buffer = createReverbImpulseResponse(context, 3.5, 3.0);
            hallNode.connect(masterBusInput);

            reverbNodesRef.current = { room: roomNode, plate: plateNode, hall: hallNode };
            reverbNodeRef.current = plateNode; // Fallback

            // Initialize Global Delay Node
            const delayNode = context.createDelay(2.0);
            delayNode.delayTime.value = 0.375; // ~1/8th note at typical tempo
            const delayFeedback = context.createGain();
            delayFeedback.gain.value = 0.4;
            delayNode.connect(delayFeedback);
            delayFeedback.connect(delayNode);
            delayNode.connect(masterBusInput);
            delayNodeRef.current = delayNode;
            delayFeedbackRef.current = delayFeedback;
            loadingProgressStore.completeStep('masterChain');

            // Initialize Engines
            loadingProgressStore.startStep('webGpuEngine');
            const gpuEngine = new WebGpuOscillator();
            await gpuEngine.init().catch(e => console.warn("GPU Engine init failed", e));
            gpuEngineRef.current = gpuEngine;
            loadingProgressStore.completeStep('webGpuEngine');

            loadingProgressStore.startStep('wasmEngine');
            const wasmEngine = new WasmOscillator();
            await wasmEngine.init().catch(e => console.warn("WASM Engine init failed", e));
            wasmEngineRef.current = wasmEngine;
            loadingProgressStore.completeStep('wasmEngine');

            const rustEngine = new RustOscillator();
            await rustEngine.init().catch(e => console.warn("Rust Engine init failed", e));
            rustEngineRef.current = rustEngine;

            // Initialize Open303 Manager
            loadingProgressStore.startStep('open303Engine');
            const open303Manager = new Open303Manager();
            let open303Ready = false;
            
            try {
                open303Ready = await open303Manager.init(context, open303ProcessorUrl, {
                    preferWorklet: true,
                    preferThreaded: false,
                    forceSingleThreaded: true
                });
                
                if (!open303Ready) {
                    console.warn('[useAudioEngine] Open303Manager failed to initialize');
                    try { engineTelemetry.registerResolution('jc303','fallback','notReady'); } catch (e) { /* noop */ }
                }
            } catch (e) {
                console.error('[useAudioEngine] Open303Manager crashed during init:', e);
                open303Ready = false;
            }
            
            if (!open303Ready) {
                console.log('[useAudioEngine] Open303 bypassed - using fallback bass synthesis');
            }
            loadingProgressStore.completeStep('open303Engine');

            // Initialize PCF (Pattern Controlled Filter) — inserted between 303 and master bus.
            // Enables ReBirth-style pattern-driven filter automation on the 303 output.
            {
                const pcf = new PcfEffect(context);
                let pcfReady = false;
                try {
                    await pcf.init();
                    pcfReady = true;
                    pcfEffectRef.current = pcf;
                    console.log('[useAudioEngine] PcfEffect Ready');
                } catch (e) {
                    console.warn(
                        '[useAudioEngine] PcfEffect failed to initialize; bypassing PCF.' +
                        ' Possible causes: AudioWorklet registration failed (check CORS / module' +
                        ' loading), or AudioContext was suspended at init time.',
                        e
                    );
                }
                // Connect 303 through PCF (if ready) or directly to master bus.
                // open303ManagerRef is set here, after routing is fully established.
                if (open303Ready) {
                    if (pcfReady) {
                        open303Manager.connect(pcf.input);
                        pcf.output.connect(masterBusInput);
                    } else {
                        open303Manager.connect(masterBusInput);
                    }
                    open303ManagerRef.current = open303Manager;
                    console.log('[useAudioEngine] Open303Manager Ready');
                    try { engineTelemetry.registerResolution('jc303','open303','ready'); } catch (e) { /* noop */ }
                }
            }

            // Initialize Prophecy Formant Engine
            loadingProgressStore.startStep('prophecyEngine');
            const prophecyManager = new ProphecyManager();
            let prophecyReady = false;

            try {
                prophecyReady = await prophecyManager.init(context, prophecyProcessorUrl);

                if (prophecyReady) {
                    prophecyManager.connect(masterBusInput);
                    prophecyManagerRef.current = prophecyManager;
                    console.log('[useAudioEngine] ProphecyManager Ready');
                    try { engineTelemetry.registerResolution('prophecy', 'prophecy', 'ready'); } catch (e) { /* noop */ }
                } else {
                    console.warn('[useAudioEngine] ProphecyManager failed to initialize');
                    try { engineTelemetry.registerResolution('prophecy', 'fallback', 'notReady'); } catch (e) { /* noop */ }
                }
            } catch (e) {
                console.error('[useAudioEngine] ProphecyManager crashed during init:', e);
                prophecyReady = false;
            }

            if (!prophecyReady) {
                console.log('[useAudioEngine] Prophecy bypassed - formant waveforms will fall back to standard oscillators');
            }
            loadingProgressStore.completeStep('prophecyEngine');

            loadingProgressStore.startStep('wavFiles');
            const [sawBuf, sqrBuf] = await Promise.all([
                loadWavBuffer(context, './assets/saw.wav'),
                loadWavBuffer(context, './assets/square.wav')
            ]);
            wavSawBufferRef.current = sawBuf;
            wavSqrBufferRef.current = sqrBuf;
            loadingProgressStore.completeStep('wavFiles');

            // Register oscillator backend decision (webgpu -> wasm -> wav -> js)
            try {
                let oscillatorBackend = 'js';
                if (gpuEngine && (gpuEngine as any).isSupported) oscillatorBackend = 'webgpu';
                else if (wasmEngine && (wasmEngine as any).isReady) oscillatorBackend = 'wasm';
                else if (sawBuf || sqrBuf) oscillatorBackend = 'wav';
                engineTelemetry.registerResolution('oscillators', oscillatorBackend, 'init-decision');
            } catch (e) {
                console.warn('Engine telemetry registration failed for oscillators', e);
            }

            // Pre-render WebGPU oscillator cycles at C4 reference so they can be
            // looped synchronously per-note (gpuEngine.generate is async).
            const wgslBuffers: Partial<Record<'saw' | 'sqr' | 'tri' | 'sin', AudioBuffer | null>> = {};
            if ((gpuEngine as any).isSupported) {
                const REF_FREQ = 261.63;
                const REF_DUR = 2.0;
                const shapes: Array<'saw' | 'sqr' | 'tri' | 'sin'> = ['saw', 'sqr', 'tri', 'sin'];
                await Promise.all(shapes.map(async (shape) => {
                    try {
                        const float = await gpuEngine.generate(REF_FREQ, REF_DUR, context.sampleRate, shape);
                        if (float && float.length > 0) {
                            const buf = context.createBuffer(1, float.length, context.sampleRate);
                            buf.getChannelData(0).set(float);
                            wgslBuffers[shape] = buf;
                        }
                    } catch (e) {
                        console.warn(`WebGPU pre-render for ${shape} failed`, e);
                    }
                }));
            }

            const voiceEngineDeps = { wasmEngine: wasmEngineRef.current, rustEngine: rustEngineRef.current, wgslBuffers };

            // Initialize Voice Managers
            voiceManagerARef.current = new VoiceManager(context, masterSaturationRef.current!, 8, false, sawBuf || undefined, sqrBuf || undefined, delayNodeRef.current || undefined, voiceEngineDeps);
            voiceManagerBRef.current = new VoiceManager(context, masterSaturationRef.current!, 1, true, sawBuf || undefined, sqrBuf || undefined, delayNodeRef.current || undefined, voiceEngineDeps);

            await initializeSustainProcessor(context, sustainProcessorUrl, sustainNodeRef, masterGainRef);

            try {
                await context.audioWorklet.addModule(vocalOverdriveProcessorUrl);
            } catch (error) {
                console.error('VocalOverdrive AudioWorklet initialization failed:', error);
            }

            try {
                await context.audioWorklet.addModule(expressiveVoiceProcessorUrl);
            } catch (error) {
                console.error('ExpressiveVoiceProcessor AudioWorklet initialization failed:', error);
            }
            try {
                // Thread boundary constraint: expressive DSP must stay in an AudioWorklet
                // so the rendering thread can process per-voice audio without main-thread hops.
                await context.audioWorklet.addModule(expressiveVoiceProcessorWorkletUrl);
            } catch (error) {
                console.error('ExpressiveVoice worklet initialization failed:', error);
            }

            // --- Singing Voice Manager Init ---
            loadingProgressStore.startStep('singingVoice');
            try {
                let wasmBinary: ArrayBuffer | undefined = undefined;
                try {
                    const response = await fetch(import.meta.env.BASE_URL + 'rubberband.wasm');
                    if (response.ok) wasmBinary = await response.arrayBuffer();
                } catch (e) {
                    console.warn('Failed to pre-fetch rubberband.wasm', e);
                }

                const manager = new SingingVoiceManager(context, 12, {
                    useHighQuality: false,
                    preserveFormants: true,
                    channels: 1,
                    bufferSize: 16384,
                    enablePhonemeStretching: true,
                    enableFormantShifting: true
                });

                await manager.init(wasmBinary, (done, total) => {
                    loadingProgressStore.updateStepProgress('singingVoice', (done / total) * 100);
                });
                singingVoiceManagerRef.current = manager;
                try { engineTelemetry.registerResolution('singingVoice','wasm','loaded'); } catch (e) { /* noop */ }

                initializeChoirBuses(
                    context,
                    masterGainRef,
                    choirLeftGainRef,
                    choirRightGainRef,
                    choirLeftPannerRef,
                    choirRightPannerRef,
                );

                manager.getAllVoices().forEach(voice => {
                    voice.connectOutput(masterSaturationRef.current!);
                });

                // Initialise the phoneme buffer pool and wire it to every voice
                const pool = new PhonemeBufferPool();
                pool.init(context);
                phonemeBufferPoolRef.current = pool;
                manager.getAllVoices().forEach(voice => voice.setPool(pool));

                if (pyodideRef.current) {
                    // Pre-cache logic
                }
            } catch (e) {
                try { engineTelemetry.registerResolution('singingVoice','js','failed to init: ' + String(e)); } catch (err) { /* noop */ }
                console.warn('SingingVoiceManager failed to init:', e);
                loadingProgressStore.failStep('singingVoice', e instanceof Error ? e : new Error(String(e)), true);
            }
            loadingProgressStore.completeStep('singingVoice');

            loadingProgressStore.startStep('complete');
            initializeHarmonizer(harmonizerRef);
            noiseBufferRef.current = createNoiseBuffer(context);
            multisampleGeneratorRef.current = new MultisampleGenerator(context);

            // --- Helper: warm the phoneme pool for all phonemes in a bank ---
            const warmPoolForBank = (sampleName: string, alignment: AlignmentResult, audioBuffer: AudioBuffer): void => {
                const pool = phonemeBufferPoolRef.current;
                if (!pool) return;
                const monoAudio = audioBuffer.getChannelData(0);
                const sr = audioBuffer.sampleRate;
                for (let i = 0; i < alignment.phonemes.length; i++) {
                    const ph = alignment.phonemes[i];
                    const startSample = Math.floor(ph.start * sr);
                    const endSample = Math.floor(ph.end * sr);
                    if (endSample <= startSample) continue;
                    const slice = monoAudio.slice(startSample, endSample);
                    pool.warmPhoneme(`${sampleName}_${i}`, [slice], sr);
                }
            };

            // --- Playback Functions Extraction ---
            const playSynth = (params: any, note: string | string[], time: number, durationSteps?: number, stepTime?: number, slideFromFreq?: number, track?: 'partA' | 'partB' | 'bass2', tuning?: any | null, noteParams?: any) => {
                createPlaySynth(context, playbackRefs)(params, note, time, durationSteps, stepTime, slideFromFreq, track, tuning, noteParams);
            };
            const playDrum = createPlayDrum(context, playbackRefs) as any;
            const {
                loadSampleToEngine,
                getMultisampleBank,
                isMultisampleReady,
                prepareVocal: prepareVocalBase,
                getAlignment,
                setAlignment: setAlignmentBase
            } = createSampleLibraryControls({
                loadedSampleBuffersRef,
                multisampleBanksRef,
                multisampleGeneratorRef,
                vocalAlignmentsRef,
                singingVoiceManagerRef,
            });

            // Wrap prepareVocal to warm the pool once alignment is computed
            const prepareVocal = async (bankIndex: number, text: string): Promise<void> => {
                await prepareVocalBase(bankIndex, text);
                const sampleName = `bank_${bankIndex}`;
                const alignment = vocalAlignmentsRef.current.get(sampleName);
                const audioBuffer = (multisampleBanksRef.current.get(sampleName)?.baseBuffer)
                    ?? loadedSampleBuffersRef.current.get(sampleName);
                if (alignment && audioBuffer) {
                    warmPoolForBank(sampleName, alignment, audioBuffer);
                }
            };

            // Wrap setAlignment to warm the pool when alignment is set externally
            const setAlignment = (bankIndex: number, alignment: AlignmentResult | null): void => {
                setAlignmentBase(bankIndex, alignment);
                if (alignment) {
                    const sampleName = `bank_${bankIndex}`;
                    const audioBuffer = (multisampleBanksRef.current.get(sampleName)?.baseBuffer)
                        ?? loadedSampleBuffersRef.current.get(sampleName);
                    if (audioBuffer) {
                        warmPoolForBank(sampleName, alignment, audioBuffer);
                    }
                }
            };
            const playSamplerVoice = (
                params: SamplerBankParams, 
                note: string | string[], 
                time: number, 
                durationSteps: number = 1, 
                stepTime: number = 0.2, 
                noteParams?: { 
                    timbre?: number, 
                    microtiming?: number, 
                    reverse?: boolean, 
                    sliceIndex?: number, 
                    retrigger?: number, 
                    slideFromMidi?: number,
                    slideFromFormant?: number,
                    slideType?: 'linear' | 'exponential',
                    phonemes?: PhonemeData[],
                    freeze?: number,
                    filterCutoff?: number,
                    filterResonance?: number,
                    formantLfoRate?: number,
                    formantLfoDepth?: number,
                    formantLfoShape?: number[],
                    customLfoShape?: number[],
                    vibratoDepth?: number,
                    reverbSend?: number,
                    delaySend?: number,
                    choir?: number,
                    drive?: number,
                    characterMorph?: number,
                    breathIntensity?: number,
                    formantShift?: number,
                    timeStretchEnvDepth?: number,
                    grainPitchQuantize?: number,
                    granularPitchShift?: number,
                    bitcrush?: number,
                    downsample?: number,
                    tranceGate?: number,
                    gateRate?: number,
                    gateDepth?: number,
                    spectralPanRate?: number,
                    spectralPanDepth?: number,
                    reverbLfoRate?: number,
                    reverbLfoDepth?: number,
                    glitchChance?: number,
                    isHarmonyVoice?: boolean
                },
                pitchOffsetSemitones: number = 0,
                tuning?: ScaleDefinition | null
            ) => {
                const multisampleBank = multisampleBanksRef.current.get(params.sampleName);
                const legacyBuffer = loadedSampleBuffersRef.current.get(params.sampleName);
                const buffer = multisampleBank?.baseBuffer || legacyBuffer;
                
                if (!buffer || !masterSaturationRef.current) return;

                // Apply Microtiming
                const actualTime = time + (noteParams?.microtiming ? noteParams.microtiming * stepTime : 0);

                // Retrigger Logic
                const retrigger = Math.max(1, Math.floor(noteParams?.retrigger || 1));
                const subDurationSteps = durationSteps / retrigger;

                // --- GLITCH LOGIC START ---
                const effectiveGlitchChance = noteParams?.glitchChance ?? params.glitchChance ?? 0;
                const shouldGlitch = retrigger === 1 && effectiveGlitchChance > 0 && Math.random() < effectiveGlitchChance;
                // --- GLITCH LOGIC END ---

                // Handle Polyphony (Chords)
                const notes = Array.isArray(note) ? note : [note];

                // If Singing/Stretch Mode
                if (params.mode === 'stretch' && singingVoiceManagerRef.current) {
                    const manager = singingVoiceManagerRef.current;
                    const alignment = vocalAlignmentsRef.current.get(params.sampleName);

                    // For each note in the chord
                    notes.forEach((noteStr, _noteIndex) => {

                        const triggerVoice = (voice: SingingVoice, pitchOffset: number, overrideTime?: number, overrideDuration?: number, destination?: AudioNode) => {
                            const targetDuration = overrideDuration !== undefined ? overrideDuration : (durationSteps * stepTime);
                            const originalDuration = buffer.duration;
                            const triggerTime = overrideTime !== undefined ? overrideTime : actualTime;

                            // Ensure voice connected to correct output
                            voice.disconnectOutput();
                            let finalDest = destination;
                            // Track any ExpressiveVoiceProcessor node created for this voice
                            // so it can be torn down when the voice ends.
                            let expressiveVoiceNode: AudioWorkletNode | null = null;
                            if (!finalDest) {
                                if (noteParams?.isHarmonyVoice && harmonyBusGainRef.current) {
                                    // Insert ExpressiveVoiceProcessor between the effects chain
                                    // and the harmony bus to correct the formant shift introduced
                                    // by the pitch transposition (playbackRate / rubberband).
                                    // `parameterData` sets the initial AudioParam value per spec
                                    // (Web Audio API §AudioWorkletNodeOptions.parameterData).
                                    try {
                                        const node = new AudioWorkletNode(context, 'expressive-voice-processor', {
                                            parameterData: { pitchShift: pitchOffsetSemitones }
                                        });
                                        node.connect(harmonyBusGainRef.current);
                                        expressiveVoiceNode = node;
                                        finalDest = node;
                                    } catch (_err) {
                                        // Worklet not yet registered — fall back to direct harmony bus.
                                        finalDest = harmonyBusGainRef.current;
                                    }
                                } else {
                                    finalDest = masterSaturationRef.current!;
                                }
                            }

                            // Apply Drive/Distortion if present
                            const driveAmount = noteParams?.drive !== undefined ? noteParams.drive : params.drive;
                            if (driveAmount !== undefined && driveAmount > 0) {
                                try {
                                    const overdriveNode = new AudioWorkletNode(context, 'vocal-overdrive-processor', {
                                        parameterData: {
                                            drive: driveAmount
                                        }
                                    });
                                    overdriveNode.connect(finalDest);
                                    finalDest = overdriveNode;
                                } catch (e) {
                                    const shaper = context.createWaveShaper();
                                    shaper.curve = makeDistortionCurve(driveAmount * 100);
                                    shaper.connect(finalDest);
                                    finalDest = shaper;
                                }
                            }

                            // Apply Per-Step Filter if present, or fallback to global filter settings
                            if (noteParams?.filterCutoff !== undefined || noteParams?.filterResonance !== undefined || params.filterCutoff !== undefined || params.filterResonance !== undefined) {
                                const filter = context.createBiquadFilter();
                                filter.type = 'lowpass';

                                const cutoff = noteParams?.filterCutoff !== undefined
                                    ? Math.max(20, noteParams.filterCutoff * 20000)
                                    : (params.filterCutoff ?? 20000);
                                filter.frequency.value = cutoff;

                                const resonance = noteParams?.filterResonance !== undefined
                                    ? noteParams.filterResonance * 20
                                    : (params.filterResonance ?? 0);
                                filter.Q.value = resonance;

                                filter.connect(finalDest);
                                finalDest = filter;
                            }


                            let spectralFinalDest = finalDest;
                            let wetGain: GainNode | null = null;
                            // Apply Spectral Panning
                            const spectralPanRate = noteParams?.spectralPanRate !== undefined ? noteParams.spectralPanRate : (params as any).spectralPanRate;
                            const spectralPanDepth = noteParams?.spectralPanDepth !== undefined ? noteParams.spectralPanDepth : (params as any).spectralPanDepth;
                            if (spectralPanDepth !== undefined && spectralPanDepth > 0) {
                                const lowBand = context.createBiquadFilter();
                                lowBand.type = "lowpass";
                                lowBand.frequency.value = 400;

                                const midBand = context.createBiquadFilter();
                                midBand.type = "bandpass";
                                midBand.frequency.value = 1500;
                                midBand.Q.value = 1;

                                const highBand = context.createBiquadFilter();
                                highBand.type = "highpass";
                                highBand.frequency.value = 4000;

                                const lowPanner = context.createStereoPanner();
                                const midPanner = context.createStereoPanner();
                                const highPanner = context.createStereoPanner();

                                const rate = spectralPanRate || 1;
                                const lfoRate = rate * (tempo / 60);

                                const lowLfo = context.createOscillator();
                                lowLfo.type = "sine";
                                lowLfo.frequency.value = lfoRate * 0.5;
                                const lowGain = context.createGain();
                                lowGain.gain.value = spectralPanDepth;
                                lowLfo.connect(lowGain);
                                lowGain.connect(lowPanner.pan);
                                lowLfo.start(triggerTime);

                                const midLfo = context.createOscillator();
                                midLfo.type = "sine";
                                midLfo.frequency.value = lfoRate * 0.75;
                                const midGain = context.createGain();
                                midGain.gain.value = spectralPanDepth * 0.8;
                                midLfo.connect(midGain);
                                midGain.connect(midPanner.pan);
                                midLfo.start(triggerTime);

                                const highLfo = context.createOscillator();
                                highLfo.type = "sine";
                                highLfo.frequency.value = lfoRate;
                                const highGain = context.createGain();
                                highGain.gain.value = spectralPanDepth * 1.2;
                                highLfo.connect(highGain);
                                highGain.connect(highPanner.pan);
                                highLfo.start(triggerTime);

                                lowBand.connect(lowPanner);
                                midBand.connect(midPanner);
                                highBand.connect(highPanner);

                                lowPanner.connect(finalDest);
                                midPanner.connect(finalDest);
                                highPanner.connect(finalDest);

                                const dryGain = context.createGain();
                                dryGain.gain.value = 1.0 - spectralPanDepth;
                                dryGain.connect(finalDest);

                                wetGain = context.createGain();
                                wetGain.gain.value = spectralPanDepth;
                                wetGain.connect(lowBand);
                                wetGain.connect(midBand);
                                wetGain.connect(highBand);

                                voice.connectOutput(dryGain);
                                voice.connectOutput(wetGain);
                                spectralFinalDest = dryGain;

                                // Clean up LFOs when voice finishes
                                const stopOscillators = () => {
                                    try { lowLfo.stop(); } catch(e){}
                                    try { midLfo.stop(); } catch(e){}
                                    try { highLfo.stop(); } catch(e){}
                                };
                                // this may not be perfect teardown if stretch voice lasts longer, but it is a start
                                setTimeout(stopOscillators, targetDuration * 1000 + 100);
                            } else {
                                voice.connectOutput(finalDest);
                            }

                            // Setup Reverb Send (Formant-Aware)
                            const reverbSendAmount = noteParams?.reverbSend !== undefined ? noteParams.reverbSend : 0;
                            const currentReverbType = (noteParams as any)?.reverbType || reverbTypeRef.current;
                            const targetReverbNode = reverbNodesRef.current[currentReverbType] || reverbNodesRef.current['plate'];
                            if (reverbSendAmount > 0 && targetReverbNode) {
                                const reverbGain = context.createGain();
                                reverbGain.gain.value = reverbSendAmount;

                                // Calculate Formant Brightness for Reverb EQ
                                const baseShift = params.formantShift || 0;
                                const currentShift = noteParams?.formantShift !== undefined ? (baseShift + noteParams.formantShift) : baseShift;
                                const characterMorph = noteParams?.characterMorph !== undefined ? noteParams.characterMorph : (params.characterMorph ?? 0);

                                // High formant shifts or brighter characters -> more high frequencies -> lower cutoff to tame sibilance
                                // Neutral/Low shifts -> higher cutoff to keep reverb clear
                                // We map currentShift from roughly -12 to +12
                                const normalizedShift = Math.max(-12, Math.min(12, currentShift)) / 12; // -1.0 to 1.0

                                // Base cutoff around 6000Hz. If bright (+1), drop to 2000Hz. If dark (-1), raise to 10000Hz.
                                let reverbEqCutoff = 6000 - (normalizedShift * 4000);

                                // Further adjust by character morph (0 to 1). 1 usually means brighter/female.
                                reverbEqCutoff -= (characterMorph * 1000);
                                reverbEqCutoff = Math.max(1000, Math.min(12000, reverbEqCutoff));

                                const formantReverbEq = context.createBiquadFilter();
                                formantReverbEq.type = 'lowpass';
                                formantReverbEq.frequency.value = reverbEqCutoff;
                                formantReverbEq.Q.value = 0.5; // Gentle slope

                                const lfoRate = noteParams?.reverbLfoRate !== undefined ? noteParams.reverbLfoRate : (params.reverbLfoRate || 0.1);
                                const lfoDepth = noteParams?.reverbLfoDepth !== undefined ? noteParams.reverbLfoDepth : (params.reverbLfoDepth || 0);

                                if (lfoDepth > 0 && lfoRate > 0) {
                                    // Base amount minus the max modulation depth ensures we duck down
                                    const minGain = Math.max(0, reverbSendAmount * (1 - lfoDepth));
                                    const maxGain = reverbSendAmount;
                                    const midGain = (maxGain + minGain) / 2;
                                    const amplitude = (maxGain - minGain) / 2;

                                    reverbGain.gain.value = midGain; // Set base level to midpoint

                                    // LFO to modulate gain up to reverbSendAmount
                                    const lfo = context.createOscillator();
                                    lfo.type = 'sine';
                                    lfo.frequency.value = lfoRate;

                                    const lfoDepthGain = context.createGain();
                                    lfoDepthGain.gain.value = amplitude;

                                    lfo.connect(lfoDepthGain);
                                    lfoDepthGain.connect(reverbGain.gain);

                                    lfo.start(triggerTime);
                                    lfo.stop(triggerTime + targetDuration + 1.0); // Stop after duration + tail
                                }

                                reverbGain.connect(formantReverbEq);
                                formantReverbEq.connect(targetReverbNode);
                                voice.connectOutput(reverbGain); // connectOutput appends to existing connections
                            }

                            // Setup Delay Send
                            const delaySendAmount = noteParams?.delaySend !== undefined ? noteParams.delaySend : (params.delaySend || 0);
                            if (delaySendAmount > 0 && delayNodeRef.current) {
                                const delayGain = context.createGain();
                                delayGain.gain.value = delaySendAmount;
                                delayGain.connect(delayNodeRef.current);
                                voice.connectOutput(delayGain);
                            }

                            // Apply Timbre Modulation (Formant Shift)
                            const baseShift = params.formantShift || 0;
                            let targetFormantShift = baseShift;

                            if (noteParams?.formantShift !== undefined) {
                                targetFormantShift = baseShift + noteParams.formantShift;
                            } else if (noteParams?.timbre !== undefined) {
                                targetFormantShift = baseShift + (noteParams.timbre * 12) - 6;
                            }

                            if (noteParams?.slideFromFormant !== undefined && (noteParams?.slideFromMidi !== undefined || noteParams?.slideFromFormant !== undefined)) {
                                const startFormantShift = baseShift + noteParams.slideFromFormant;
                                const glideDuration = Math.min(Math.max(targetDuration * 0.5, 0.15), targetDuration);
                                voice.setFormantGlide(startFormantShift, targetFormantShift, triggerTime, glideDuration);
                            } else {
                                voice.setFormantShift(targetFormantShift, triggerTime);
                            }

                            // Apply Character Morphing
                            const morphAmount = noteParams?.characterMorph !== undefined ? noteParams.characterMorph : (params.characterMorph ?? 0);
                            const morphTarget = params.morphTarget || 'female';
                            voice.setCharacterMorph(morphAmount, morphTarget as any, 0.05); // Use short ramp time

                            // Sync other params
                            const expressiveConfig = resolveExpressiveness(params);
                            if (noteParams?.vibratoDepth !== undefined) {
                                voice.setVibratoDepth(noteParams.vibratoDepth, triggerTime);
                            } else {
                                // SingingVoice setters use legacy percentage depth (0-100).
                                voice.setVibratoDepth(expressiveConfig.vibratoDepth * 100, triggerTime);
                            }
                            voice.setVibratoRate(expressiveConfig.vibratoRate, triggerTime);

                            if (noteParams?.gateDepth !== undefined) {
                                voice.setGateDepth(noteParams.gateDepth, triggerTime);
                            } else if (params.gateDepth !== undefined) {
                                voice.setGateDepth(params.gateDepth, triggerTime);
                            }

                            if (noteParams?.gateRate !== undefined) {
                                const rateHz = (tempo / 60) * (noteParams.gateRate / 4);
                                voice.setGateRate(rateHz, triggerTime);
                            } else if (params.gateRate !== undefined) {
                                const rateHz = (tempo / 60) * (params.gateRate / 4);
                                voice.setGateRate(rateHz, triggerTime);
                            }
                            // SingingVoice setters use legacy percentage depth (0-100).
                            voice.setTremoloDepth(expressiveConfig.tremoloDepth * 100, triggerTime);
                            if (params.tremoloRate !== undefined) voice.setTremoloRate(params.tremoloRate, triggerTime);

                            if (noteParams?.gateDepth !== undefined) {
                                voice.setGateDepth(noteParams.gateDepth, triggerTime);
                            } else if (params.gateDepth !== undefined) {
                                voice.setGateDepth(params.gateDepth, triggerTime);
                            }

                            if (noteParams?.gateRate !== undefined) {
                                voice.setGateRate(noteParams.gateRate, triggerTime);
                            } else if (params.gateRate !== undefined) {
                                voice.setGateRate(params.gateRate, triggerTime);
                            }

                            if (noteParams?.breathIntensity !== undefined) {
                                voice.setBreathIntensity(noteParams.breathIntensity, triggerTime);
                            } else {
                                voice.setBreathIntensity(expressiveConfig.breathAmount, triggerTime);
                            }
                            if (params.attack !== undefined) voice.setAttack(params.attack, triggerTime);
                            if (params.decay !== undefined) voice.setDecay(params.decay, triggerTime);
                            if (params.sustain !== undefined) voice.setSustain(params.sustain, triggerTime);
                            if (params.release !== undefined) voice.setRelease(params.release, triggerTime);

                            // Apply per-step or global freeze
                            if (noteParams?.freeze !== undefined) {
                                voice.setFreeze(noteParams.freeze, triggerTime);
                            } else if (params.freeze !== undefined) {
                                voice.setFreeze(params.freeze, triggerTime);
                            }

                            // Apply Envelope Follower depths (global only)
                            if (params.freezeEnvDepth !== undefined) voice.setFreezeEnvDepth(params.freezeEnvDepth, triggerTime);
                            if (params.grainEnvDepth !== undefined) voice.setGrainEnvDepth(params.grainEnvDepth, triggerTime);
                            if (noteParams?.grainPitchQuantize !== undefined) {
                                voice.setGrainPitchQuantize(noteParams.grainPitchQuantize, triggerTime);
                            } else if (params.grainPitchQuantize !== undefined) {
                                voice.setGrainPitchQuantize(params.grainPitchQuantize, triggerTime);
                            }

                            if (noteParams?.granularPitchShift !== undefined) {
                                voice.setGranularPitchShift(noteParams.granularPitchShift, triggerTime);
                            } else if (params.granularPitchShift !== undefined) {
                                voice.setGranularPitchShift(params.granularPitchShift, triggerTime);
                            }
                            if (noteParams?.bitcrush !== undefined) {
                                voice.setBitcrush(noteParams.bitcrush, triggerTime);
                            } else if (params.bitcrush !== undefined) {
                                voice.setBitcrush(params.bitcrush, triggerTime);
                            }

                            if (noteParams?.downsample !== undefined) {
                                voice.setDownsample(noteParams.downsample, triggerTime);
                            } else if (params.downsample !== undefined) {
                                voice.setDownsample(params.downsample, triggerTime);
                            }


                            if (noteParams?.tranceGate !== undefined) {
                                voice.setTranceGate(noteParams.tranceGate, triggerTime);
                            }

                            // Apply Formant LFO
                            if (noteParams?.formantLfoRate !== undefined) {
                                voice.setFormantLfoRate(noteParams.formantLfoRate, triggerTime);
                            } else if (params.formantLfoRate !== undefined) {
                                voice.setFormantLfoRate(params.formantLfoRate, triggerTime);
                            }
                            if (noteParams?.formantLfoDepth !== undefined) {
                                voice.setFormantLfoDepth(noteParams.formantLfoDepth, triggerTime);
                            } else if (params.formantLfoDepth !== undefined) {
                                voice.setFormantLfoDepth(params.formantLfoDepth, triggerTime);
                            }
                            if (noteParams?.formantLfoShape !== undefined) {
                                voice.setFormantLfoShape(noteParams.formantLfoShape);
                            } else if (params.formantLfoShape !== undefined) {
                                voice.setFormantLfoShape(params.formantLfoShape);
                            } else {
                                voice.setFormantLfoShape(undefined);
                            }

                            // Formant Envelope
                            const envAttack = (noteParams as any)?.formantEnvAttack ?? params.formantEnvAttack ?? 0;
                            const envDecay = (noteParams as any)?.formantEnvDecay ?? params.formantEnvDecay ?? 0;
                            const envAmount = (noteParams as any)?.formantEnvAmount ?? params.formantEnvAmount ?? 0;
                            if (envAmount !== 0) {
                                voice.setFormantEnvelope(envAmount, envAttack, envDecay, triggerTime);
                            }
                            if (noteParams?.customLfoShape !== undefined) {
                                voice.setFormantLfoShape(noteParams.customLfoShape);
                            } else if (params.customLfoShape !== undefined) {
                                voice.setFormantLfoShape(params.customLfoShape);
                            } else {
                                voice.setFormantLfoShape(undefined);
                            }

                            // Load buffer
                            voice.loadBuffer(buffer.getChannelData(0));

                            // CHECK FOR SLICE TRIGGER MODE
                            if (params.sliceMode === 'phoneme' && alignment) {
                                let sliceIndex = -1;
                                let pitchRatio = 1.0;

                                if (noteParams?.sliceIndex !== undefined) {
                                    sliceIndex = noteParams.sliceIndex;
                                    const targetMidi = noteToMidi(noteStr);
                                    const baseMidi = 60;
                                    pitchRatio = Math.pow(2, (targetMidi - baseMidi + pitchOffset + pitchOffsetSemitones) / 12);
                                } else {
                                    const targetMidi = noteToMidi(noteStr);
                                    sliceIndex = targetMidi - 60;
                                    pitchRatio = Math.pow(2, (pitchOffset + pitchOffsetSemitones) / 12);
                                }

                                if (sliceIndex >= 0) {
                                    const phonemeId = `${params.sampleName}_${sliceIndex}`;
                                    voice.triggerSlice(
                                        buffer.getChannelData(0),
                                        sliceIndex,
                                        alignment,
                                        pitchRatio,
                                        noteParams?.reverse,
                                        targetDuration,
                                        triggerTime,
                                        phonemeId,
                                    );
                                    return;
                                }
                            }

                            // 1. Calculate Time Ratio
                            const timeRatio = targetDuration / originalDuration;
                            voice.setTimeRatio(timeRatio, triggerTime);

                            // 2. Pitch Shift (with offset for harmonizer and slide support)
                            const targetMidi = noteToMidi(noteStr) + pitchOffsetSemitones;
                            if (noteParams?.slideFromMidi !== undefined) {
                                const startMidi = noteParams.slideFromMidi + pitchOffsetSemitones;
                                voice.setPitchFromMidi(startMidi + pitchOffset, 60, triggerTime, undefined, undefined, tuning);
                                // Glide over half the target duration or a minimum of 0.15s, bounded by actual duration
                                const glideDuration = Math.min(Math.max(targetDuration * 0.5, 0.15), targetDuration);

                                if (noteParams?.slideType === 'exponential' || params.portamentoType === 'exponential') {
                                    voice.exponentialRampPitchFromMidi(targetMidi + pitchOffset, 60, triggerTime + glideDuration, undefined, undefined, tuning);
                                } else {
                                    voice.linearRampPitchFromMidi(targetMidi + pitchOffset, 60, triggerTime + glideDuration, undefined, undefined, tuning);
                                }
                            } else {
                                voice.setPitchFromMidi(targetMidi + pitchOffset, 60, triggerTime, undefined, undefined, tuning);
                            }

                            // 3. Phoneme Awareness (from Jules branch)
                            if (alignment) {
                                voice.setAlignment(alignment);
                                voice.sendPhonemeDataToWorklet(targetDuration);
                            }

                            // 4. Play
                            voice.play(undefined, undefined, 1.0, noteParams?.reverse);

                            const releaseTime = triggerTime + targetDuration;
                            const delayMs = (releaseTime - context.currentTime) * 1000;
                            if (delayMs > 0) {
                                setTimeout(() => {
                                    voice.noteOff();
                                    expressiveVoiceNode?.port.postMessage({ type: 'TEARDOWN' });
                                }, delayMs);
                            } else {
                                voice.noteOff();
                                expressiveVoiceNode?.port.postMessage({ type: 'TEARDOWN' });
                            }
                        };

                        const runVoices = (timeOffset: number, duration: number) => {
                            const t = actualTime + timeOffset;

                            const mainVoiceData = manager.acquireVoice();
                            manager.registerActiveVoice(mainVoiceData.index, noteStr, t);
                            triggerVoice(mainVoiceData.voice, 0, t, duration);

                            const effectiveChoir = noteParams?.choir !== undefined ? noteParams.choir : (params.choir || 0);

                            if (effectiveChoir > 0 && pitchOffsetSemitones === 0) {
                                const detune = 0.15;
                                const gain = effectiveChoir * 0.7;

                                if (choirLeftGainRef.current) choirLeftGainRef.current.gain.setTargetAtTime(gain, t, 0.02);
                                if (choirRightGainRef.current) choirRightGainRef.current.gain.setTargetAtTime(gain, t, 0.02);

                                const leftVoiceData = manager.acquireVoice();
                                if (leftVoiceData.index !== mainVoiceData.index) {
                                    manager.registerActiveVoice(leftVoiceData.index, `${noteStr}_L`, t);
                                    triggerVoice(leftVoiceData.voice, detune, t, duration, choirLeftGainRef.current!);
                                }

                                const rightVoiceData = manager.acquireVoice();
                                if (rightVoiceData.index !== mainVoiceData.index && rightVoiceData.index !== leftVoiceData.index) {
                                    manager.registerActiveVoice(rightVoiceData.index, `${noteStr}_R`, t);
                                    triggerVoice(rightVoiceData.voice, -detune, t, duration, choirRightGainRef.current!);
                                }
                            } else if (pitchOffsetSemitones === 0) {
                                if (choirLeftGainRef.current) choirLeftGainRef.current.gain.setTargetAtTime(0, t, 0.02);
                                if (choirRightGainRef.current) choirRightGainRef.current.gain.setTargetAtTime(0, t, 0.02);
                            }
                        };

                        if (shouldGlitch) {
                            const numStutters = Math.floor(Math.random() * 3) + 2;
                            const totalDur = durationSteps * stepTime;
                            const stutterLen = Math.min(0.06, totalDur / numStutters);

                            for (let i = 0; i < numStutters; i++) {
                                runVoices(i * stutterLen, stutterLen);
                            }
                            const played = numStutters * stutterLen;
                            if (totalDur > played) {
                                runVoices(played, totalDur - played);
                            }
                        } else {
                            for (let r = 0; r < retrigger; r++) {
                                const offset = r * (subDurationSteps * stepTime);
                                runVoices(offset, subDurationSteps * stepTime);
                            }
                        }
                    });
                    return;
                }

                // Buffer playback mode (non-stretch)
                const playBufferSource = (startTime: number, duration: number, pitchSemitones: number) => {
                    const source = context.createBufferSource();
                    
                    const targetMidi = pitchSemitones;
                    let playbackBuffer: AudioBuffer;
                    let pitchRatio = 1.0;
                    
                    if (multisampleBank?.pitchBank.has(targetMidi)) {
                        playbackBuffer = multisampleBank.pitchBank.get(targetMidi)!;
                        pitchRatio = params.playbackSpeed;
                    } else {
                        playbackBuffer = multisampleBank?.baseBuffer || buffer;
                        const rootMidi = multisampleBank?.rootNote ?? 60;
                        const speed = params.playbackSpeed;
                        pitchRatio = speed * Math.pow(2, (targetMidi - rootMidi) / 12);
                    }
                    
                    source.buffer = playbackBuffer;
                    source.playbackRate.value = pitchRatio;

                    const gain = context.createGain();
                    gain.gain.value = params.volume;

                    const filter = context.createBiquadFilter();
                    filter.type = 'lowpass';
                    const cutoff = noteParams?.filterCutoff !== undefined
                        ? Math.max(20, noteParams.filterCutoff * 20000)
                        : params.filterCutoff;
                    filter.frequency.value = cutoff;

                    const resonance = noteParams?.filterResonance !== undefined
                        ? noteParams.filterResonance * 20
                        : params.filterResonance;
                    filter.Q.value = resonance;

                    let finalShaperDest: AudioNode | null = null;
                    const driveAmount = noteParams?.drive !== undefined ? noteParams.drive : params.drive;
                    if (driveAmount > 0) {
                        try {
                            const overdriveNode = new AudioWorkletNode(context, 'vocal-overdrive-processor', {
                                parameterData: {
                                    drive: driveAmount
                                }
                            });
                            finalShaperDest = overdriveNode;
                        } catch (e) {
                            const shaper = context.createWaveShaper();
                            shaper.curve = makeDistortionCurve(driveAmount * 100);
                            finalShaperDest = shaper;
                        }
                    } else {
                        const shaper = context.createWaveShaper();
                        shaper.curve = null;
                        finalShaperDest = shaper;
                    }

                    // Insert ExpressiveVoiceProcessor before the harmony bus to correct
                    // the formant shift introduced by playbackRate-based pitch transposition.
                    // `parameterData` sets the initial AudioParam value per spec
                    // (Web Audio API §AudioWorkletNodeOptions.parameterData).
                    let finalDestination: AudioNode;
                    if (noteParams?.isHarmonyVoice && harmonyBusGainRef.current) {
                        try {
                            const expressiveNode = new AudioWorkletNode(context, 'expressive-voice-processor', {
                                parameterData: { pitchShift: pitchOffsetSemitones }
                            });
                            expressiveNode.connect(harmonyBusGainRef.current);
                            // Tear down the processor when the source finishes playback.
                            source.addEventListener('ended', () => {
                                expressiveNode.port.postMessage({ type: 'TEARDOWN' });
                            });
                            finalDestination = expressiveNode;
                        } catch (_err) {
                            // Worklet not yet registered — fall back to direct harmony bus.
                            finalDestination = harmonyBusGainRef.current;
                        }
                    } else {
                        finalDestination = masterSaturationRef.current!;
                    }

                    const expressiveConfig = resolveExpressiveness(params);
                    let expressiveNode: AudioWorkletNode | null = null;
                    try {
                        expressiveNode = new AudioWorkletNode(context, 'expressive-voice', {
                            numberOfInputs: 1,
                            numberOfOutputs: 1,
                            outputChannelCount: [1],
                            parameterData: {
                                vibratoRate: expressiveConfig.vibratoRate,
                                vibratoDepth: expressiveConfig.vibratoDepth,
                                tremoloRate: params.tremoloRate ?? 5.0,
                                tremoloDepth: expressiveConfig.tremoloDepth,
                                breathAmount: expressiveConfig.breathAmount,
                                attack: params.attack ?? 0,
                                decay: params.decay ?? 0,
                                sustain: params.sustain ?? 1,
                                release: params.release ?? 0.1,
                                gate: 1,
                            }
                        });
                        expressiveNode.connect(finalDestination);
                        finalDestination = expressiveNode;
                    } catch (_err) {
                        expressiveNode = null;
                    }

                    const spectralPanRate = noteParams?.spectralPanRate !== undefined ? noteParams.spectralPanRate : (params as any).spectralPanRate;
                    const spectralPanDepth = noteParams?.spectralPanDepth !== undefined ? noteParams.spectralPanDepth : (params as any).spectralPanDepth;
                    let spectralFinalDest = finalDestination;
                    let wetGain: GainNode | null = null;
                    if (spectralPanDepth !== undefined && spectralPanDepth > 0) {
                        // Parallel low/band/high bands with independent LFO panners for spectral movement
                        const lowBand = context.createBiquadFilter();
                        lowBand.type = "lowpass";
                        lowBand.frequency.value = 400;

                        const midBand = context.createBiquadFilter();
                        midBand.type = "bandpass";
                        midBand.frequency.value = 1500;
                        midBand.Q.value = 1;

                        const highBand = context.createBiquadFilter();
                        highBand.type = "highpass";
                        highBand.frequency.value = 4000;

                        const lowPanner = context.createStereoPanner();
                        const midPanner = context.createStereoPanner();
                        const highPanner = context.createStereoPanner();

                        const rate = spectralPanRate || 1;
                        const lfoRate = rate * (tempo / 60);

                        const lowLfo = context.createOscillator();
                        lowLfo.type = "sine";
                        lowLfo.frequency.value = lfoRate * 0.5;
                        const lowGain = context.createGain();
                        lowGain.gain.value = spectralPanDepth;
                        lowLfo.connect(lowGain);
                        lowGain.connect(lowPanner.pan);
                        lowLfo.start(startTime);

                        const midLfo = context.createOscillator();
                        midLfo.type = "sine";
                        midLfo.frequency.value = lfoRate * 0.75;
                        const midGain = context.createGain();
                        midGain.gain.value = spectralPanDepth * 0.8;
                        midLfo.connect(midGain);
                        midGain.connect(midPanner.pan);
                        midLfo.start(startTime);

                        const highLfo = context.createOscillator();
                        highLfo.type = "sine";
                        highLfo.frequency.value = lfoRate;
                        const highGain = context.createGain();
                        highGain.gain.value = spectralPanDepth * 1.2;
                        highLfo.connect(highGain);
                        highGain.connect(highPanner.pan);
                        highLfo.start(startTime);

                        lowBand.connect(lowPanner);
                        midBand.connect(midPanner);
                        highBand.connect(highPanner);

                        lowPanner.connect(finalDestination);
                        midPanner.connect(finalDestination);
                        highPanner.connect(finalDestination);

                        const dryGain = context.createGain();
                        dryGain.gain.value = 1.0 - spectralPanDepth;
                        dryGain.connect(finalDestination);

                        wetGain = context.createGain();
                        wetGain.gain.value = spectralPanDepth;
                        wetGain.connect(lowBand);
                        wetGain.connect(midBand);
                        wetGain.connect(highBand);

                        spectralFinalDest = dryGain;

                        source.addEventListener("ended", () => {
                            try { lowLfo.stop(); } catch(e){}
                            try { midLfo.stop(); } catch(e){}
                            try { highLfo.stop(); } catch(e){}
                        });
                    }

                    if (params.pan !== undefined && params.pan !== 0) {
                        const panner = context.createStereoPanner();
                        panner.pan.value = params.pan;
                        panner.connect(finalDestination);
                        finalDestination = panner;
                    }

                    source.connect(filter);
                    if (finalShaperDest) {
                        filter.connect(finalShaperDest);
                        finalShaperDest.connect(gain);
                    } else {
                        filter.connect(gain);
                    }

                    if (wetGain) {
                        gain.connect(spectralFinalDest);
                        gain.connect(wetGain);
                    } else {
                        gain.connect(spectralFinalDest);
                    }

                    if (expressiveNode) {
                        source.addEventListener('ended', () => {
                            try { expressiveNode?.disconnect(); } catch { /* noop */ }
                        });
                    }

                    source.start(startTime);
                    if (duration > 0) {
                        const releaseTime = params.release ?? 0.1;
                        if (expressiveNode) {
                            expressiveNode.parameters.get('gate')?.setValueAtTime(0, startTime + duration);
                            source.stop(startTime + duration + releaseTime + EXPRESSIVE_STOP_BUFFER_SECONDS);
                        } else {
                            source.stop(startTime + duration);
                        }
                    }
                };

                notes.forEach(noteStr => {
                    // Include pitchOffsetSemitones so harmony voices transpose correctly
                    // in buffer-source mode (matches the pitch offset already applied in
                    // stretch mode via noteToMidi(noteStr) + pitchOffsetSemitones).
                    const midi = noteToMidi(noteStr) + pitchOffsetSemitones;

                    if (shouldGlitch) {
                        const numStutters = Math.floor(Math.random() * 3) + 2;
                        const stutterLen = 0.06;

                        for (let i = 0; i < numStutters; i++) {
                            playBufferSource(actualTime + i * stutterLen, stutterLen, midi);
                        }
                        playBufferSource(actualTime + numStutters * stutterLen, 0, midi);
                    } else {
                        for (let r = 0; r < retrigger; r++) {
                            const offset = r * (subDurationSteps * stepTime);
                            playBufferSource(actualTime + offset, subDurationSteps * stepTime, midi);
                        }
                    }
                });
            };

            // Main playSampler function with harmonizer support
            const playSampler = (
                params: SamplerBankParams,
                note: string | string[],
                time: number,
                durationSteps: number = 1,
                stepTime: number = 0.2,
                noteParams?: any,
                tuning?: ScaleDefinition | null
            ) => {
                // Harmonize support - if harmonizer is active, generate multiple harmony voices
                const harmonizer = harmonizerRef.current;
                if (harmonizer?.getIsActive()) {
                    const voices = harmonizer.generateVoices();

                    // Play base voice (index 0) - the original note
                    playSamplerVoice(params, note, time, durationSteps, stepTime, noteParams, 0, tuning);

                    // Play each harmony voice (skip index 0 which is base)
                    voices.forEach((voice) => {
                        if (voice.index === 0) return; // Skip base voice, already played above

                        // Create modified params for this harmony voice
                        const voiceParams: SamplerBankParams = {
                            ...params,
                            pan: Math.max(-1, Math.min(1, (params.pan || 0) + (voice.pan || 0))),
                            volume: params.volume * voice.gain * 0.85,
                            formantShift: (params.formantShift || 0) + voice.formantShift,
                            fineTune: (params.fineTune || 0) + voice.detuneCents
                        };

                        // Play this voice with pitch offset and slight delay for natural ensemble effect
                        const delayMs = voice.index * 5;
                        setTimeout(() => {
                            playSamplerVoice(voiceParams, note, time + (delayMs / 1000), durationSteps, stepTime, { ...noteParams, isHarmonyVoice: voice.index > 0 }, voice.pitchOffset, tuning);
                        }, delayMs);
                    });
                    return;
                }

                playSamplerVoice(params, note, time, durationSteps, stepTime, undefined, 0, tuning);
            };

            const noteOnSampler = (params: SamplerBankParams, note: string, time?: number, tuning?: any | null): number | null => {
                const now = time || context.currentTime;
                
                const multisampleBank = multisampleBanksRef.current.get(params.sampleName);
                const legacyBuffer = loadedSampleBuffersRef.current.get(params.sampleName);
                const buffer = multisampleBank?.baseBuffer || legacyBuffer;
                
                if (!buffer || !masterSaturationRef.current) return null;

                const rootNote = params.rootNote ?? 60;
                const coarseTune = params.coarseTune ?? 0;
                const fineTune = params.fineTune ?? 0;

                const targetMidi = noteToMidi(note);
                const source = context.createBufferSource();
                
                let playbackBuffer: AudioBuffer;
                let pitchRatio: number;
                
                if (multisampleBank?.pitchBank.has(targetMidi)) {
                    playbackBuffer = multisampleBank.pitchBank.get(targetMidi)!;
                    pitchRatio = params.playbackSpeed;
                } else {
                    playbackBuffer = multisampleBank?.baseBuffer || buffer;
                    const rootMidi = multisampleBank?.rootNote ?? rootNote;
                    const effectivePitchOffset = coarseTune + (fineTune / 100);
                    pitchRatio = params.playbackSpeed * Math.pow(2, (targetMidi - rootMidi + effectivePitchOffset) / 12);
                }
                
                source.buffer = playbackBuffer;
                source.playbackRate.value = pitchRatio;

                const gain = context.createGain();
                gain.gain.value = params.volume;

                const expressiveConfig = resolveExpressiveness(params);
                let expressiveNode: AudioWorkletNode | null = null;
                try {
                    expressiveNode = new AudioWorkletNode(context, 'expressive-voice', {
                        numberOfInputs: 1,
                        numberOfOutputs: 1,
                        outputChannelCount: [1],
                        parameterData: {
                            vibratoRate: expressiveConfig.vibratoRate,
                            vibratoDepth: expressiveConfig.vibratoDepth,
                            tremoloRate: params.tremoloRate ?? 5.0,
                            tremoloDepth: expressiveConfig.tremoloDepth,
                            breathAmount: expressiveConfig.breathAmount,
                            attack: params.attack ?? 0,
                            decay: params.decay ?? 0,
                            sustain: params.sustain ?? 1,
                            release: params.release ?? 0.1,
                            gate: 1,
                        }
                    });
                } catch (_err) {
                    expressiveNode = null;
                }

                if (expressiveNode) {
                    source.connect(expressiveNode);
                    expressiveNode.connect(gain);
                } else {
                    source.connect(gain);
                }
                gain.connect(masterSaturationRef.current);
                source.start(now);

                const id = nextSamplerNoteId.current++;
                activeSamplerNotes.current.set(id, {
                    source,
                    envGain: gain,
                    expressiveNode,
                    releaseTime: params.release ?? 0.1,
                });
                return id;
            };

            const noteOffSampler = (id: number) => {
                const note = activeSamplerNotes.current.get(id);
                if (note) {
                    const now = context.currentTime;
                    const releaseTime = note.releaseTime ?? 0.1;
                    note.expressiveNode?.parameters.get('gate')?.setValueAtTime(0, now);
                    note.envGain.gain.cancelScheduledValues(now);
                    note.envGain.gain.linearRampToValueAtTime(0, now + releaseTime);
                    // Keep source alive a tiny bit longer so gate-release tails can render cleanly.
                    note.source.stop(now + releaseTime + EXPRESSIVE_STOP_BUFFER_SECONDS);
                    note.source.addEventListener('ended', () => {
                        try { note.expressiveNode?.disconnect(); } catch { /* noop */ }
                    }, { once: true });
                    activeSamplerNotes.current.delete(id);
                }
            };

            const noteOnSynth = createNoteOnSynth(context, playbackRefs);
            const noteOffSynthById = (id: number) => noteOffSynth(activeSynthNotes.current, id);
            const stopAllNotes = createStopAllNotes(playbackRefs);

            const renderSynthPartToBuffer = (_params: SynthParams, _sequence: PartSequence, _tempo: number): Promise<AudioBuffer> => {
                 return Promise.resolve(context.createBuffer(2, context.sampleRate * 2, context.sampleRate));
            };

            const playBufferedPart = (buffer: AudioBuffer, time: number) => {
                const src = context.createBufferSource();
                src.buffer = buffer;
                src.connect(masterSaturationRef.current!);
                src.start(time);
            };
            const { playAmbiance, stopAmbiance, setAmbianceVolume } = createAmbianceControls(context, playbackRefs);
            const setMasterVolume = (value: number) => setMasterGainVolume(masterGainRef, value);
            const setMasterSaturation = (amount: number) => setMasterGainSaturation(masterSaturationRef, amount);
            const setGlobalPan = (value: number) => setMasterPan(masterPannerRef, value);

            const setReverbType = (type: 'room' | 'plate' | 'hall') => {
                reverbTypeRef.current = type;
            };

            const triggerTapeStop = (duration: number = 2.0) => {
                if (!masterGainRef.current) return;
                const now = context.currentTime;
                const gain = masterGainRef.current.gain;
                const currentVol = gain.value;
                gain.cancelScheduledValues(now);
                gain.setValueAtTime(currentVol, now);
                gain.exponentialRampToValueAtTime(0.0001, now + duration);
            };

            const resetTapeStop = () => {
                if (!masterGainRef.current) return;
                const now = context.currentTime;
                const gain = masterGainRef.current.gain;
                gain.cancelScheduledValues(now);
                gain.setValueAtTime(1.0, now);
            };

            const detectSamplePitch = async (_b: AudioBuffer) => null;
            const processSinging = async (_sampleName: string, _note: string, _steps: number, _tempo: number) => null;
            const processSpoon = async (_sampleName: string, _note: string) => null;
            const setSustainMode = (_mode: 'loop' | 'stretch' | 'wavetable') => {};
            const setSustainGrainSize = (_size: number) => {};
            const setHarmonizerConfig = (config: HarmonizerConfig, isActive: boolean) => {
                applyHarmonizerConfig(harmonizerRef, config, isActive);
                if (harmonyBusGainRef.current) {
                    harmonyBusGainRef.current.gain.setTargetAtTime(isActive ? (config.busGain ?? 0.85) : 0, context.currentTime, 0.05);
                }
                if (harmonyCompressorRef.current) {
                    harmonyCompressorRef.current.threshold.setTargetAtTime(config.busCompressorThreshold ?? -18, context.currentTime, 0.05);
                }
                if (harmonyEQRef.current) {
                    harmonyEQRef.current.gain.setTargetAtTime(config.busEqGain ?? -3.0, context.currentTime, 0.05);
                }
                if (harmonyWidenerDelayRef.current) {
                    // Widener amount 0-1 mapped to 0-30ms delay
                    harmonyWidenerDelayRef.current.delayTime.setTargetAtTime((config.busWidener ?? 0.0) * 0.03, context.currentTime, 0.05);
                }
            };
            const updateSamplerVoiceParams = (_bankIdx: number, _key: string, _value: number | string | boolean) => {};

            // Re-assign to state
            setAudioEngine({
                context,
                analyserNode: analyserNodeRef.current,
                webGpuEngine: gpuEngineRef.current,
                wasmEngine: wasmEngineRef.current,
                open303Engine: open303ManagerRef.current as any,
                pcfEffect: pcfEffectRef.current,
                singingVoice: undefined,
                playSynth,
                playDrum,
                playSampler,
                noteOnSampler,
                noteOffSampler,
                noteOnSynth,
                noteOffSynth: noteOffSynthById,
                stopAllNotes,
                loadSampleToEngine,
                renderSynthPartToBuffer,
                playBufferedPart,
                playAmbiance,
                stopAmbiance,
                setAmbianceVolume,
                setMasterVolume,
                setMasterSaturation,
                setGlobalPan,
                setReverbType,
                detectSamplePitch,
                processSinging,
                prepareVocal,
                getAlignment,
                setAlignment,
                setSustainMode,
                setSustainGrainSize,
                getMultisampleBank,
                isMultisampleReady,
                setHarmonizerConfig,
                updateSamplerVoiceParams,
                triggerTapeStop,
                resetTapeStop
            });

            loadingProgressStore.completeStep('complete');
            loadingProgressStore.finishLoading();
            setIsReady(true);
            isInitializing.current = false;
        } catch (e) {
            console.error("CRITICAL AUDIO INIT FAILURE", e);
            loadingProgressStore.addError(e instanceof Error ? e.message : String(e));
            loadingProgressStore.finishLoading();
            setIsReady(true);
            isInitializing.current = false;
        }
    }, [audioEngine, playbackRefs]);

    const updateVoiceParams = useCallback((_bankIdx: number, key: keyof SamplerBankParams, value: number, rampTime?: number) => {
        applyVoiceParamUpdate({
            manager: singingVoiceManagerRef.current,
            choirLeftGain: choirLeftGainRef.current,
            choirRightGain: choirRightGainRef.current,
            currentTime: audioEngine?.context.currentTime || 0,
            key,
            value,
            rampTime
        });
    }, [audioEngine]);
    
    const updateSamplerVoiceParams = useCallback((_bankIdx: number, param: string, value: number | string | boolean) => {
        applySamplerVoiceParamUpdate({
            manager: singingVoiceManagerRef.current,
            currentTime: audioEngine?.context?.currentTime || 0,
            param,
            value,
        });
    }, [audioEngine]);

    return useMemo(() => ({
        audioEngine,
        isReady,
        initializeAudio,
        onParamChange: updateVoiceParams,
        updateSamplerVoiceParams,
        drumKitEngineRef,
    }), [audioEngine, isReady, initializeAudio, updateVoiceParams, updateSamplerVoiceParams]);
};