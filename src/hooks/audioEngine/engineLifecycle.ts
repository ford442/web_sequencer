import type { MutableRefObject } from 'react';
import { WebGpuOscillator } from '../../engines/WebGpuOscillator';
import { WasmOscillator } from '../../engines/WasmOscillator';
import { Open303Manager } from '../../engines/Open303Manager';
import { SingingVoiceManager } from '../../engines/SingingVoiceManager';
import { VoiceManager } from '../../engines/VoiceManager';
import { MultisampleGenerator } from '../../engines/MultisampleGenerator';
import { PhonemeBufferPool } from '../../services/PhonemeBufferPool';
import { engineTelemetry } from '../../utils/engineTelemetry';
import {
    createNoiseBuffer,
    initializeChoirBuses,
    initializeHarmonizer,
    initializeMasterOutput,
    initializeSustainProcessor,
    loadWavBuffer,
    createReverbImpulseResponse,
} from './initialization';

type AudioWindow = Window & typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
    audioContext?: AudioContext;
};

export interface EngineLifecycleRefs {
    masterGainRef: MutableRefObject<GainNode | null>;
    masterPannerRef: MutableRefObject<StereoPannerNode | null>;
    masterSaturationRef: MutableRefObject<WaveShaperNode | null>;
    masterCompressorRef: MutableRefObject<DynamicsCompressorNode | null>;
    sidechainGainRef: MutableRefObject<BiquadFilterNode | null>;
    bassSidechainEQBusRef: MutableRefObject<BiquadFilterNode | null>;
    sidechainBusRef: MutableRefObject<GainNode | null>;
    reverbNodesRef: MutableRefObject<Record<string, ConvolverNode>>;
    reverbNodeRef: MutableRefObject<ConvolverNode | null>;
    reverbTypeRef: MutableRefObject<'room' | 'plate' | 'hall'>;
    delayNodeRef: MutableRefObject<DelayNode | null>;
    delayFeedbackRef: MutableRefObject<GainNode | null>;
    gpuEngineRef: MutableRefObject<WebGpuOscillator | null>;
    wasmEngineRef: MutableRefObject<WasmOscillator | null>;
    open303ManagerRef: MutableRefObject<Open303Manager | null>;
    voiceManagerARef: MutableRefObject<VoiceManager | null>;
    voiceManagerBRef: MutableRefObject<VoiceManager | null>;
    sustainNodeRef: MutableRefObject<AudioWorkletNode | null>;
    singingVoiceManagerRef: MutableRefObject<SingingVoiceManager | null>;
    choirLeftGainRef: MutableRefObject<GainNode | null>;
    choirRightGainRef: MutableRefObject<GainNode | null>;
    choirLeftPannerRef: MutableRefObject<StereoPannerNode | null>;
    choirRightPannerRef: MutableRefObject<StereoPannerNode | null>;
    phonemeBufferPoolRef: MutableRefObject<PhonemeBufferPool | null>;
    harmonizerRef: MutableRefObject<import('../../engines/Harmonizer').Harmonizer | null>;
    noiseBufferRef: MutableRefObject<AudioBuffer | null>;
    multisampleGeneratorRef: MutableRefObject<MultisampleGenerator | null>;
    wavSawBufferRef: MutableRefObject<AudioBuffer | null>;
    wavSqrBufferRef: MutableRefObject<AudioBuffer | null>;
    pyodideRef: MutableRefObject<unknown>;
}

export interface EngineLifecycleUrls {
    sustainProcessorUrl: string;
    open303ProcessorUrl: string;
}

export interface EngineLifecycleResult {
    context: AudioContext;
    masterBusInput: WaveShaperNode;
}

export async function initializeAudioContextAndEngines(
    refs: EngineLifecycleRefs,
    urls: EngineLifecycleUrls,
): Promise<EngineLifecycleResult> {
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

    const masterBusInput = initializeMasterOutput(
        context,
        refs.masterGainRef,
        refs.masterPannerRef,
        refs.masterSaturationRef,
        refs.masterCompressorRef,
        refs.sidechainGainRef,
        refs.bassSidechainEQBusRef,
    );

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

    refs.reverbNodesRef.current = { room: roomNode, plate: plateNode, hall: hallNode };
    refs.reverbNodeRef.current = plateNode; // Fallback

    // Initialize Global Delay Node
    const delayNode = context.createDelay(2.0);
    delayNode.delayTime.value = 0.375; // ~1/8th note at typical tempo
    const delayFeedback = context.createGain();
    delayFeedback.gain.value = 0.4;
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);
    delayNode.connect(masterBusInput);
    refs.delayNodeRef.current = delayNode;
    refs.delayFeedbackRef.current = delayFeedback;

    // Initialize Engines
    const gpuEngine = new WebGpuOscillator();
    await gpuEngine.init().catch(e => console.warn("GPU Engine init failed", e));
    refs.gpuEngineRef.current = gpuEngine;

    const wasmEngine = new WasmOscillator();
    await wasmEngine.init().catch(e => console.warn("WASM Engine init failed", e));
    refs.wasmEngineRef.current = wasmEngine;

    // Initialize Open303 Manager
    const open303Manager = new Open303Manager();
    let open303Ready = false;

    try {
        open303Ready = await open303Manager.init(context, urls.open303ProcessorUrl, {
            preferWorklet: true,
            preferThreaded: false,
            forceSingleThreaded: true
        });

        if (open303Ready) {
            open303Manager.connect(masterBusInput);
            refs.open303ManagerRef.current = open303Manager;
            console.log('[useAudioEngine] Open303Manager Ready');
            try { engineTelemetry.registerResolution('jc303','open303','ready'); } catch (e) { /* noop */ }
        } else {
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

    const [sawBuf, sqrBuf] = await Promise.all([
        loadWavBuffer(context, './assets/saw.wav'),
        loadWavBuffer(context, './assets/square.wav')
    ]);
    refs.wavSawBufferRef.current = sawBuf;
    refs.wavSqrBufferRef.current = sqrBuf;

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

    // Initialize Voice Managers
    refs.voiceManagerARef.current = new VoiceManager(context, refs.masterSaturationRef.current!, 8, false, sawBuf || undefined, sqrBuf || undefined, refs.delayNodeRef.current || undefined);
    refs.voiceManagerBRef.current = new VoiceManager(context, refs.masterSaturationRef.current!, 1, true, sawBuf || undefined, sqrBuf || undefined, refs.delayNodeRef.current || undefined);

    await initializeSustainProcessor(context, urls.sustainProcessorUrl, refs.sustainNodeRef, refs.masterGainRef);

    // --- Singing Voice Manager Init ---
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

        await manager.init(wasmBinary);
        refs.singingVoiceManagerRef.current = manager;
        try { engineTelemetry.registerResolution('singingVoice','wasm','loaded'); } catch (e) { /* noop */ }

        initializeChoirBuses(
            context,
            refs.masterGainRef,
            refs.choirLeftGainRef,
            refs.choirRightGainRef,
            refs.choirLeftPannerRef,
            refs.choirRightPannerRef,
        );

        manager.getAllVoices().forEach(voice => {
            voice.connectOutput(refs.masterSaturationRef.current!);
        });

        // Initialise the phoneme buffer pool and wire it to every voice
        const pool = new PhonemeBufferPool();
        pool.init(context);
        refs.phonemeBufferPoolRef.current = pool;
        manager.getAllVoices().forEach(voice => voice.setPool(pool));

        if (refs.pyodideRef.current) {
            // Pre-cache logic
        }
    } catch (e) {
        try { engineTelemetry.registerResolution('singingVoice','js','failed to init: ' + String(e)); } catch (err) { /* noop */ }
        console.warn('SingingVoiceManager failed to init:', e);
    }

    initializeHarmonizer(refs.harmonizerRef);
    refs.noiseBufferRef.current = createNoiseBuffer(context);
    refs.multisampleGeneratorRef.current = new MultisampleGenerator(context);

    return { context, masterBusInput };
}
