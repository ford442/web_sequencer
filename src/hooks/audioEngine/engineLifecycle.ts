import type { MutableRefObject } from 'react';
import { WebGpuOscillator } from '../../engines/WebGpuOscillator';
import { WasmOscillator } from '../../engines/WasmOscillator';
import { RustOscillator } from '../../engines/RustOscillator';
import { BackendRegistry, setOscillatorRegistry } from '../../engines/backends/BackendRegistry';
import {
    JsOscillatorBackend,
    RustWasmBackend,
    WamWasmBackend,
    WavPcmBackend,
    WebGpuBackend,
} from '../../engines/backends/adapters';
import { Open303Manager } from '../../engines/Open303Manager';
import { ProphecyManager } from '../../engines/ProphecyManager';
import { DrumKitEngine } from '../../engines/DrumKitEngine';
import { SingingVoiceManager } from '../../engines/SingingVoiceManager';
import { VoiceManager } from '../../engines/VoiceManager';
import { MultisampleGenerator } from '../../engines/MultisampleGenerator';
import { DEFAULT_DRUM_KIT } from '../../constants';
import { PhonemeBufferPool } from '../../services/PhonemeBufferPool';
import { engineTelemetry } from '../../utils/engineTelemetry';
import { loadingProgressStore } from '../../stores/loadingProgressStore';
import { startGlitchMonitor } from '../../utils/workletPerfBridge';
import { buildClassicElectribeGraph } from '../../audio/graph';
import { WamHost, setWamHost } from '../../audio/wam';
import {
    createMasterLoudnessStage,
    setMasterLoudnessStage,
} from '../../audio/loudness';
import type { TrackAnalysers } from '../../types';
import { getStoredLatencyMode, type LatencyMode } from '../../utils/audioLatencyMode';
import { createAudioContext } from './audioContextFactory';
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
    prophecyManagerRef: MutableRefObject<ProphecyManager | null>;
    drumKitEngineRef: MutableRefObject<DrumKitEngine | null>;
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
    prophecyProcessorUrl: string;
}

export interface EngineLifecycleResult {
    context: AudioContext;
    masterBusInput: WaveShaperNode;
}

export async function initializeAudioContextAndEngines(
    refs: EngineLifecycleRefs,
    urls: EngineLifecycleUrls,
    latencyHint: LatencyMode = getStoredLatencyMode(),
): Promise<EngineLifecycleResult> {
    const audioWindow = window as AudioWindow;
    loadingProgressStore.startStep('audioContext');
    const context = createAudioContext(latencyHint);
    loadingProgressStore.completeStep('audioContext');
    audioWindow.audioContext = context;
    startGlitchMonitor(context, latencyHint);

    // --- CRITICAL FIX: Ensure AudioContext is running ---
    if (context.state === 'suspended') {
        await context.resume();
        console.log("AudioContext resumed");
    }

    loadingProgressStore.startStep('masterChain');
    // The master true-peak limiter / loudness meter is an AudioWorklet, so its
    // module has to be registered before the graph is compiled. If it fails to
    // load the graph is compiled without it and playback continues unmetered.
    const loudnessStage = await createMasterLoudnessStage(context);
    setMasterLoudnessStage(loudnessStage);
    const { masterBusInput, graph } = buildClassicElectribeGraph(context, refs, {
        masterLimiterNode: loudnessStage?.node ?? null,
    });
    const wamHost = new WamHost(context);
    wamHost.attachCompiledGraph(graph);
    setWamHost(wamHost);
    wamHost.publishTelemetry();
    loadingProgressStore.completeStep('masterChain');

    // Initialize oscillator backends through the shared registry. Every engine
    // is wrapped in an OscillatorBackend adapter so readiness is typed and the
    // fallback chain (WebGPU → AS WASM → Rust → WAV PCM → JS) lives in one place.
    const registry = new BackendRegistry();
    const webGpuBackend = new WebGpuBackend(new WebGpuOscillator());
    const wamBackend = new WamWasmBackend(new WasmOscillator());
    const rustBackend = new RustWasmBackend(new RustOscillator());
    const wavBackend = new WavPcmBackend();
    registry.register(webGpuBackend);
    registry.register(wamBackend);
    registry.register(rustBackend);
    registry.register(wavBackend);
    registry.register(new JsOscillatorBackend());
    setOscillatorRegistry(registry);

    // The WAV backend only becomes supported once its tables are decoded, so it
    // is initialized further down; the GPU/WASM/Rust backends init here.
    loadingProgressStore.startStep('webGpuEngine');
    await webGpuBackend.init(context);
    loadingProgressStore.completeStep('webGpuEngine');

    loadingProgressStore.startStep('wasmEngine');
    await wamBackend.init(context);
    await rustBackend.init(context);
    loadingProgressStore.completeStep('wasmEngine');

    refs.gpuEngineRef.current = webGpuBackend.raw;
    refs.wasmEngineRef.current = wamBackend.raw;

    // Initialize Open303 Manager
    loadingProgressStore.startStep('open303Engine');
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
        loadingProgressStore.failStep('open303Engine', new Error('Open303 not ready'), true);
    } else {
        loadingProgressStore.completeStep('open303Engine');
    }

    // Initialize Prophecy formant engine (SYNTH A / SYNTH B prophecy-* waveforms)
    loadingProgressStore.startStep('prophecyEngine');
    const prophecyManager = new ProphecyManager();
    try {
        const prophecyReady = await prophecyManager.init(context, urls.prophecyProcessorUrl);
        if (prophecyReady) {
            const partADest = refs.synthABusRef.current ?? refs.masterSaturationRef.current!;
            const partBDest = refs.synthBBusRef.current ?? refs.masterSaturationRef.current!;
            prophecyManager.connectBuses(partADest, partBDest);
            refs.prophecyManagerRef.current = prophecyManager;
            console.log('[useAudioEngine] ProphecyManager Ready');
            try { engineTelemetry.registerResolution('prophecy', 'wasm-worklet', 'ready'); } catch (e) { /* noop */ }
        } else {
            console.warn('[useAudioEngine] ProphecyManager failed to initialize');
            try { engineTelemetry.registerResolution('prophecy', 'fallback', 'notReady'); } catch (e) { /* noop */ }
        }
    } catch (e) {
        console.error('[useAudioEngine] ProphecyManager crashed during init:', e);
        loadingProgressStore.failStep(
            'prophecyEngine',
            e instanceof Error ? e : new Error(String(e)),
            true,
        );
        try { engineTelemetry.registerResolution('prophecy', 'fallback', String(e)); } catch (err) { /* noop */ }
    }
    if (refs.prophecyManagerRef.current) {
        loadingProgressStore.completeStep('prophecyEngine');
    } else if (loadingProgressStore.getState().steps.prophecyEngine.status === 'active') {
        loadingProgressStore.failStep('prophecyEngine', new Error('Prophecy not ready'), true);
    }

    loadingProgressStore.startStep('wavFiles');
    const [sawBuf, sqrBuf] = await Promise.all([
        loadWavBuffer(context, './assets/saw.wav'),
        loadWavBuffer(context, './assets/square.wav')
    ]);
    refs.wavSawBufferRef.current = sawBuf;
    refs.wavSqrBufferRef.current = sqrBuf;
    loadingProgressStore.completeStep('wavFiles');

    // Resolve the active oscillator backend from the ordered chain. The result
    // is published to telemetry + the degradation store, so any fallback is
    // logged and shows up in EngineHUD rather than degrading silently.
    wavBackend.setBuffers({ saw: sawBuf, sqr: sqrBuf });
    await wavBackend.init(context);
    registry.resolveAndPublish();

    // Initialize Voice Managers (routed through per-track monitor buses for expression LEDs)
    const synthADest = refs.synthABusRef.current ?? refs.masterSaturationRef.current!;
    const synthBDest = refs.synthBBusRef.current ?? refs.masterSaturationRef.current!;
    refs.voiceManagerARef.current = new VoiceManager(context, synthADest, 8, false, sawBuf || undefined, sqrBuf || undefined, refs.delayNodeRef.current || undefined);
    refs.voiceManagerBRef.current = new VoiceManager(context, synthBDest, 1, true, sawBuf || undefined, sqrBuf || undefined, refs.delayNodeRef.current || undefined);

    // Hand the initialized backends to the voices so rust-*/wam-* waveforms
    // reach a real engine instead of dropping straight to the JS oscillator.
    const voiceEngineDeps = {
        wasmEngine: wamBackend.raw,
        rustEngine: rustBackend.raw,
    };
    refs.voiceManagerARef.current.updateEngineDeps(voiceEngineDeps);
    refs.voiceManagerBRef.current.updateEngineDeps(voiceEngineDeps);

    await initializeSustainProcessor(context, urls.sustainProcessorUrl, refs.sustainNodeRef, refs.masterGainRef);

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

        await manager.init(wasmBinary);
        refs.singingVoiceManagerRef.current = manager;
        try { engineTelemetry.registerResolution('singingVoice','wasm','loaded'); } catch (e) { /* noop */ }

        const samplerDest = refs.samplerBusRef.current ?? refs.masterSaturationRef.current!;
        const voices = manager.getAllVoices();
        // ⚡ Bolt Optimization: Replacing forEach with for loop to prevent closure allocations on hot path
        for (let i = 0; i < voices.length; i++) {
            voices[i].connectOutput(samplerDest);
        }

        // Initialise the phoneme buffer pool and wire it to every voice
        const pool = new PhonemeBufferPool();
        pool.init(context);
        refs.phonemeBufferPoolRef.current = pool;
        // ⚡ Bolt Optimization: Replacing forEach with for loop to prevent closure allocations on hot path
        for (let i = 0; i < voices.length; i++) {
            voices[i].setPool(pool);
        }

        if (refs.pyodideRef.current) {
            // Pre-cache logic
        }
        loadingProgressStore.completeStep('singingVoice');
    } catch (e) {
        try { engineTelemetry.registerResolution('singingVoice','js','failed to init: ' + String(e)); } catch (err) { /* noop */ }
        console.warn('SingingVoiceManager failed to init:', e);
        loadingProgressStore.failStep(
            'singingVoice',
            e instanceof Error ? e : new Error(String(e)),
            true,
        );
    }

    initializeHarmonizer(refs.harmonizerRef);
    refs.noiseBufferRef.current = createNoiseBuffer(context);
    refs.multisampleGeneratorRef.current = new MultisampleGenerator(context);
    refs.drumKitEngineRef.current = new DrumKitEngine(DEFAULT_DRUM_KIT);

    return { context, masterBusInput };
}
