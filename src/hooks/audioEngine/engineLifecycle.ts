import type { MutableRefObject } from 'react';
import { WebGpuOscillator } from '../../engines/WebGpuOscillator';
import { WasmOscillator } from '../../engines/WasmOscillator';
import { Open303Manager } from '../../engines/Open303Manager';
import { SingingVoiceManager } from '../../engines/SingingVoiceManager';
import { VoiceManager } from '../../engines/VoiceManager';
import { MultisampleGenerator } from '../../engines/MultisampleGenerator';
import { PhonemeBufferPool } from '../../services/PhonemeBufferPool';
import { engineTelemetry } from '../../utils/engineTelemetry';
import { startGlitchMonitor } from '../../utils/workletPerfBridge';
import { buildClassicElectribeGraph } from '../../audio/graph';
import type { TrackAnalysers } from '../../types';
import {
    createNoiseBuffer,
    initializeHarmonizer,
    initializeSustainProcessor,
    loadWavBuffer,
} from './initialization';

type AudioWindow = Window & typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
    audioContext?: AudioContext;
};

export interface EngineLifecycleRefs {
    analyserNodeRef: MutableRefObject<AnalyserNode | null>;
    trackAnalysersRef: MutableRefObject<TrackAnalysers>;
    synthABusRef: MutableRefObject<GainNode | null>;
    synthBBusRef: MutableRefObject<GainNode | null>;
    samplerBusRef: MutableRefObject<GainNode | null>;
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
    startGlitchMonitor(context);

    // --- CRITICAL FIX: Ensure AudioContext is running ---
    if (context.state === 'suspended') {
        await context.resume();
        console.log("AudioContext resumed");
    }

    const { masterBusInput } = buildClassicElectribeGraph(context, refs);

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

    // Initialize Voice Managers (routed through per-track monitor buses for expression LEDs)
    const synthADest = refs.synthABusRef.current ?? refs.masterSaturationRef.current!;
    const synthBDest = refs.synthBBusRef.current ?? refs.masterSaturationRef.current!;
    refs.voiceManagerARef.current = new VoiceManager(context, synthADest, 8, false, sawBuf || undefined, sqrBuf || undefined, refs.delayNodeRef.current || undefined);
    refs.voiceManagerBRef.current = new VoiceManager(context, synthBDest, 1, true, sawBuf || undefined, sqrBuf || undefined, refs.delayNodeRef.current || undefined);

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

        const samplerDest = refs.samplerBusRef.current ?? refs.masterSaturationRef.current!;
        manager.getAllVoices().forEach(voice => {
            voice.connectOutput(samplerDest);
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
