import { useState, useCallback, useRef, useEffect } from 'react';
import type { AudioEngine, SynthParams, DrumSound, KickParams, SnareParams, HatParams, SamplerParams, PartSequence } from '../types';
import { noteToFrequency, NUM_STEPS } from '../constants';
import { WebGpuOscillator } from '../engines/WebGpuOscillator';
import { WasmOscillator } from '../engines/WasmOscillator';

export const useAudioEngine = (pyodide: any) => {
    const [isReady, setIsReady] = useState(false);
    const audioEngineRef = useRef<AudioEngine | null>(null);
    const noiseBufferRef = useRef<AudioBuffer | null>(null);
    const ambianceSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
    const ambianceGainNodeRef = useRef<GainNode | null>(null);
    const loadedAmbianceBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
    const rendererWorkerRef = useRef<Worker | null>(null);
    const gpuEngineRef = useRef<WebGpuOscillator | null>(null);
    const wasmEngineRef = useRef<WasmOscillator | null>(null);

    // Native WAV buffers
    const wavSawBufferRef = useRef<AudioBuffer | null>(null);
    const wavSqrBufferRef = useRef<AudioBuffer | null>(null);

    // Master Volume & Pan
    const masterGainRef = useRef<GainNode | null>(null);
    const masterPannerRef = useRef<StereoPannerNode | null>(null);

    const pyodideRef = useRef(pyodide);

    useEffect(() => {
        pyodideRef.current = pyodide;
    }, [pyodide]);

    const initializeAudio = useCallback(async () => {
        if (audioEngineRef.current) return;

        const context = new (window.AudioContext || (window as any).webkitAudioContext)();

        // --- MASTER CHAIN ---
        // Sources -> MasterGain -> MasterPanner -> Destination
        const masterGain = context.createGain();
        masterGain.gain.setValueAtTime(0.8, 0); // Default volume
        masterGainRef.current = masterGain;

        // Use StereoPanner if available (standard in modern browsers)
        let masterPanner: StereoPannerNode | null = null;
        if (context.createStereoPanner) {
            masterPanner = context.createStereoPanner();
            masterPanner.pan.setValueAtTime(0, 0);
            masterPannerRef.current = masterPanner;

            masterGain.connect(masterPanner);
            masterPanner.connect(context.destination);
        } else {
            // Fallback: Just connect gain to destination
            masterGain.connect(context.destination);
        }

        // Initialize GPU Engine
        const gpuEngine = new WebGpuOscillator();
        await gpuEngine.init();
        gpuEngineRef.current = gpuEngine;

        // Initialize Wasm Engine
        const wasmEngine = new WasmOscillator();
        await wasmEngine.init();
        wasmEngineRef.current = wasmEngine;

        // Load WAV Files (Native Engine)
        const loadWav = async (url: string) => {
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const arrayBuf = await res.arrayBuffer();
                return await context.decodeAudioData(arrayBuf);
            } catch (e) {
                console.error(`Failed to load ${url}`, e);
                return null;
            }
        };

        const [sawBuf, sqrBuf] = await Promise.all([
            loadWav('./assets/saw.wav'),
            loadWav('./assets/square.wav')
        ]);
        wavSawBufferRef.current = sawBuf;
        wavSqrBufferRef.current = sqrBuf;

        if (context.state === 'suspended') {
            await context.resume();
        }

        // Create a white noise buffer
        const bufferSize = context.sampleRate * 2;
        const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
        const output = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        noiseBufferRef.current = buffer;

        const playSynth = async (params: SynthParams, note: string, time: number) => {
            // NOTE: destination arg removed, we force routing to masterGain
            // If we ever need to support custom destinations (e.g. for offline rendering), we can re-add it,
            // but 'playSynth' is for live playback. 'renderSynthPartToBuffer' uses its own offline context/worker.
            const destination = masterGainRef.current!;

            const isPyodideWave = params.waveform.startsWith('pyodide-');
            const isWgslWave = params.waveform.startsWith('wgsl-');
            const isWasmWave = params.waveform.startsWith('wam-');
            const isWavWave = params.waveform.startsWith('wav-');

            // ADSR Logic
            const gateTime = params.length || 0.25;
            const totalDuration = gateTime + params.release;

            // --- Gain Envelope ---
            const gain = context.createGain();
            gain.gain.setValueAtTime(0, time);
            gain.gain.linearRampToValueAtTime(params.volume, time + params.attack);

            const sustainLevel = params.volume * params.sustain;
            gain.gain.linearRampToValueAtTime(sustainLevel, time + params.attack + params.decay);
            gain.gain.setValueAtTime(sustainLevel, time + gateTime);
            gain.gain.linearRampToValueAtTime(0, time + gateTime + params.release);

            // --- Delay ---
            let outputNode: AudioNode = destination;
            if (params.delayMix > 0 && params.delayTime > 0) {
                const dryGain = context.createGain();
                const wetGain = context.createGain();
                const delay = context.createDelay(1.0);
                const feedback = context.createGain();

                dryGain.gain.setValueAtTime(1.0 - params.delayMix, time);
                wetGain.gain.setValueAtTime(params.delayMix, time);
                delay.delayTime.setValueAtTime(params.delayTime, time);
                feedback.gain.setValueAtTime(params.delayFeedback, time);

                gain.connect(dryGain);
                dryGain.connect(destination);

                gain.connect(delay);
                delay.connect(feedback);
                feedback.connect(delay);
                delay.connect(wetGain);
                wetGain.connect(destination);

                outputNode = gain;
            } else {
                gain.connect(destination);
                outputNode = gain;
            }

            // --- Waveform Generation ---
            if (isWavWave) {
                const buffer = params.waveform === 'wav-saw' ? wavSawBufferRef.current : wavSqrBufferRef.current;

                if (buffer) {
                    const source = context.createBufferSource();
                    source.buffer = buffer;
                    source.loop = true;

                    const baseFreq = noteToFrequency(note);
                    const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);

                    // Determine sample root frequency based on user spec
                    // saw.wav: 32.86 Hz, square.wav: 65.72 Hz
                    const sampleRootFreq = params.waveform === 'wav-saw' ? 32.86 : 65.72;

                    source.playbackRate.setValueAtTime(freqWithPitch / sampleRootFreq, time);

                    const filter = context.createBiquadFilter();
                    filter.type = 'lowpass';
                    filter.frequency.setValueAtTime(params.filterCutoff, time);
                    filter.Q.setValueAtTime(params.filterResonance, time);

                    source.connect(filter);
                    filter.connect(outputNode);

                    source.start(time);
                    // Stop slightly after release to prevent clicking
                    source.stop(time + totalDuration + 0.1);
                }
            } else if (isWgslWave && gpuEngineRef.current?.isSupported) {
                try {
                    const baseFreq = noteToFrequency(note);
                    const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);
                    const type = params.waveform.split('-')[1] as 'saw' | 'sqr' | 'tri' | 'sin';

                    const rawData = await gpuEngineRef.current.generate(
                        freqWithPitch,
                        totalDuration + 0.1,
                        context.sampleRate,
                        type
                    );

                    if (rawData) {
                        const buffer = context.createBuffer(1, rawData.length, context.sampleRate);
                        buffer.getChannelData(0).set(rawData);

                        const source = context.createBufferSource();
                        source.buffer = buffer;

                        const filter = context.createBiquadFilter();
                        filter.type = 'lowpass';
                        filter.frequency.setValueAtTime(params.filterCutoff, time);
                        filter.Q.setValueAtTime(params.filterResonance, time);

                        source.connect(filter);
                        filter.connect(outputNode);
                        source.start(time);
                    }
                } catch (e) { console.error("WGSL Render Error:", e); }

            } else if (isWasmWave && wasmEngineRef.current?.isReady) {
                try {
                    const baseFreq = noteToFrequency(note);
                    const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);
                    const type = params.waveform.split('-')[1] as 'saw' | 'sqr' | 'tri' | 'sin';

                    // Log parameters for debugging
                    // console.log("Wasm Generate:", { freqWithPitch, totalDuration, type, cutoff: params.filterCutoff });

                    const rawData = wasmEngineRef.current.generate(
                        freqWithPitch,
                        totalDuration + 0.1,
                        context.sampleRate,
                        type,
                        params.filterCutoff,
                        params.filterResonance
                    );

                    if (rawData) {
                        const buffer = context.createBuffer(1, rawData.length, context.sampleRate);
                        buffer.getChannelData(0).set(rawData);

                        const source = context.createBufferSource();
                        source.buffer = buffer;

                        // Wasm engine handles filter internally
                        source.connect(outputNode);
                        source.start(time);
                    }
                } catch (e) { console.error("Wasm Render Error:", e); }

            } else if (isPyodideWave && pyodideRef.current) {
                try {
                    pyodideRef.current.globals.get('set_sample_rate')(context.sampleRate);
                    const baseFreq = noteToFrequency(note);
                    const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);
                    const pyOscType = params.waveform.split('-')[1];

                    let pyProxy = pyodideRef.current.globals.get('generate_wave')(
                        freqWithPitch,
                        totalDuration,
                        pyOscType,
                        params.filterCutoff,
                        params.filterResonance
                    );

                    const audioSamples = pyProxy.toJs({ array_buffer_type: "float32" });
                    pyProxy.destroy();

                    const buffer = context.createBuffer(1, audioSamples.length, context.sampleRate);
                    buffer.getChannelData(0).set(audioSamples);

                    const source = context.createBufferSource();
                    source.buffer = buffer;

                    source.connect(outputNode);
                    source.start(time);
                    source.stop(time + totalDuration + 0.05);

                } catch (e) { console.error("Pyodide synth error:", e); }

            } else if (isPyodideWave && !pyodideRef.current) {
                console.warn("Pyodide not ready, skipping synth trigger.");
            } else {
                // --- Web Audio Fallback ---
                const baseFreq = noteToFrequency(note);
                const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);

                const osc = context.createOscillator();

                let waveType = params.waveform;
                // Map any fancy names to standard if we fell back
                if (waveType.includes('saw')) waveType = 'sawtooth';
                else if (waveType.includes('sqr')) waveType = 'square';
                else if (waveType.includes('tri')) waveType = 'triangle';
                else if (waveType.includes('sin')) waveType = 'sine';

                // @ts-ignore
                osc.type = waveType as OscillatorType;
                osc.frequency.setValueAtTime(freqWithPitch, time);

                const filter = context.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(params.filterCutoff, time);
                filter.Q.setValueAtTime(params.filterResonance, time);

                osc.connect(filter);
                filter.connect(outputNode);

                osc.start(time);
                osc.stop(time + totalDuration + 0.05);
            }
        };

        const playDrum = (sound: DrumSound, params: KickParams | SnareParams | HatParams, time: number) => {
            if (!pyodideRef.current) {
                console.warn("Pyodide not ready, skipping drum trigger.");
                return;
            }

            try {
                let pyProxy;
                let p = params as any;
                let bufferLengthSeconds;
                let finalVolume;
                const pyodide = pyodideRef.current;

                switch (sound) {
                    case 'kick':
                        pyProxy = pyodide.globals.get('generate_kick')(p.pitch, p.decay, p.tone, p.volume);
                        bufferLengthSeconds = p.decay;
                        finalVolume = p.volume;
                        break;
                    case 'snare':
                        pyProxy = pyodide.globals.get('generate_snare')(p.decay, p.tone, p.noise, p.volume);
                        bufferLengthSeconds = p.decay * 1.5;
                        finalVolume = p.volume;
                        break;
                    case 'closedHat':
                    case 'openHat':
                        pyProxy = pyodide.globals.get('generate_hat')((p as HatParams).pitch, (p as HatParams).decay, (p as HatParams).volume);
                        bufferLengthSeconds = (p as HatParams).decay;
                        finalVolume = (p as HatParams).volume;
                        break;
                    default: return;
                }

                const audioSamples = pyProxy.toJs({ array_buffer_type: "float32" });
                pyProxy.destroy();

                const buffer = context.createBuffer(1, audioSamples.length, context.sampleRate);
                buffer.getChannelData(0).set(audioSamples);

                const gainNode = context.createGain();
                gainNode.gain.setValueAtTime(finalVolume, time);

                // Connect to Master
                gainNode.connect(masterGainRef.current!);

                const source = context.createBufferSource();
                source.buffer = buffer;
                source.connect(gainNode);
                source.start(time);
                source.stop(time + bufferLengthSeconds + 0.05);

            } catch (e) { console.error(`Pyodide drum error (${sound}):`, e); }
        };

        const loadSampleToEngine = (name: string, buffer: AudioBuffer) => {
            if (!pyodideRef.current) return;
            const channelData = buffer.getChannelData(0);
            try {
                pyodideRef.current.globals.get('load_sample')(name, Array.from(channelData));
            } catch (e) { console.error("Error sending sample to Python:", e); }
        };

        const playSampler = (params: SamplerParams, note: string, time: number) => {
            console.log("playSampler called:", { name: params.sampleName, note, pyodideReady: !!pyodideRef.current });
            if (!pyodideRef.current) return;
            try {
                // 1. Resample/Pitch in Python (Keep existing logic)
                const baseFreq = noteToFrequency('C4');
                const targetFreq = noteToFrequency(note);
                const ratio = targetFreq / baseFreq * params.playbackSpeed;

                const pyProxy = pyodideRef.current.globals.get('generate_sampler')(params.sampleName, ratio, params.volume);
                const audioSamples = pyProxy.toJs({ array_buffer_type: "float32" });
                pyProxy.destroy();

                if (audioSamples.length === 0) return;

                const buffer = context.createBuffer(1, audioSamples.length, context.sampleRate);
                buffer.getChannelData(0).set(audioSamples);

                const source = context.createBufferSource();
                source.buffer = buffer;

                // 2. DSP Chain Upgrade
                // Source -> Filter -> Drive -> Gain -> Master
                //                           -> DelaySend -> Delay -> Master

                // A. Filter (LowPass)
                const filter = context.createBiquadFilter();
                filter.type = 'lowpass';
                // Default cutoff is high (bypass) if not set, but we set default in constants
                const cutoff = params.filterCutoff || 20000;
                const res = params.filterResonance || 0;
                filter.frequency.setValueAtTime(cutoff, time);
                filter.Q.setValueAtTime(res, time);

                // B. Drive (Distortion)
                // Simple soft clipper or waveshaper
                const driveNode = context.createWaveShaper();
                // If drive is 0, curve is linear. If > 0, distorts.
                // We need a helper for curve.
                // For now, I'll define curve inline or use a simple transfer function if drive > 0
                if (params.drive > 0) {
                    driveNode.curve = makeDistortionCurve(params.drive * 50); // Scale 0-1 to 0-50 amount
                    driveNode.oversample = '4x';
                } else {
                    driveNode.curve = null; // Bypass
                }

                // C. Delay Send
                source.connect(filter);
                filter.connect(driveNode);

                if (params.delaySend > 0) {
                    // Reuse synth delay logic pattern
                    // Create dedicated delay graph for this voice (easiest refactor)
                    const delay = context.createDelay(1.0);
                    const feedback = context.createGain();
                    const wetGain = context.createGain();

                    // Fixed delay time/feedback for Sampler for now inside constants or params?
                    // We didn't add delayTime/Feedback to SamplerParams, only delaySend.
                    // So we use fixed defaults or reuse Synth defaults? 
                    // Let's use sensible defaults for now: 300ms, 0.4 feedback
                    const dTime = 0.3;
                    const dFb = 0.4;

                    delay.delayTime.setValueAtTime(dTime, time);
                    feedback.gain.setValueAtTime(dFb, time);
                    wetGain.gain.setValueAtTime(params.delaySend, time); // Amount of wet signal

                    // Routing: Drive -> Delay -> Feedback -> Delay -> WetGain -> Master
                    // Note: Usually Send is parallel. 
                    // Dry signal goes to Master. Wet goes to Master.

                    driveNode.connect(delay);
                    delay.connect(feedback);
                    feedback.connect(delay);
                    delay.connect(wetGain);
                    wetGain.connect(masterGainRef.current!);
                }

                // Connect Main (Dry) Output
                driveNode.connect(masterGainRef.current!);

                source.start(time);
            } catch (e) { console.error("Pyodide sampler error:", e); }
        };

        const renderSynthPartToBuffer = (params: SynthParams, sequence: PartSequence, tempo: number): Promise<AudioBuffer> => {
            return new Promise((resolve, reject) => {
                if (rendererWorkerRef.current) rendererWorkerRef.current.terminate();
                const worker = new Worker(new URL('../workers/renderer.worker.ts', import.meta.url), { type: 'module' });
                rendererWorkerRef.current = worker;
                worker.onmessage = (event: MessageEvent<AudioBuffer>) => {
                    resolve(event.data);
                    worker.terminate();
                    rendererWorkerRef.current = null;
                };
                worker.onerror = (error) => {
                    console.error("Renderer worker error:", error);
                    reject(error);
                    worker.terminate();
                    rendererWorkerRef.current = null;
                };
                worker.postMessage({ params, sequence, tempo, sampleRate: context.sampleRate, numSteps: NUM_STEPS });
            });
        };

        const playBufferedPart = (buffer: AudioBuffer, time: number) => {
            const source = context.createBufferSource();
            source.buffer = buffer;
            // Connect to Master
            source.connect(masterGainRef.current!);
            source.start(time);
        };

        const playAmbiance = async (url: string) => {
            if (ambianceSourceNodeRef.current) ambianceSourceNodeRef.current.stop();
            if (!url) return;

            let buffer = loadedAmbianceBuffersRef.current.get(url);
            if (!buffer) {
                try {
                    const response = await fetch(url);
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    const arrayBuffer = await response.arrayBuffer();
                    buffer = await context.decodeAudioData(arrayBuffer);
                    loadedAmbianceBuffersRef.current.set(url, buffer);
                } catch (e) { console.error("Failed to load ambiance track:", e); return; }
            }

            if (!ambianceGainNodeRef.current) {
                ambianceGainNodeRef.current = context.createGain();
                // Connect to Master
                ambianceGainNodeRef.current.connect(masterGainRef.current!);
            }

            const source = context.createBufferSource();
            source.buffer = buffer;
            source.loop = true;
            source.connect(ambianceGainNodeRef.current);
            source.start(0);
            ambianceSourceNodeRef.current = source;
        };

        const stopAmbiance = () => {
            if (ambianceSourceNodeRef.current) {
                ambianceSourceNodeRef.current.stop();
                ambianceSourceNodeRef.current = null;
            }
        };

        const setAmbianceVolume = (volume: number) => {
            if (ambianceGainNodeRef.current) {
                ambianceGainNodeRef.current.gain.setValueAtTime(volume, context.currentTime);
            }
        };

        const setMasterVolume = (volume: number) => {
            if (masterGainRef.current) {
                masterGainRef.current.gain.setValueAtTime(volume, context.currentTime);
            }
        };

        const setGlobalPan = (pan: number) => {
            if (masterPannerRef.current) {
                masterPannerRef.current.pan.setValueAtTime(pan, context.currentTime);
            }
        };

        audioEngineRef.current = {
            context,
            webGpuEngine: gpuEngineRef.current,
            wasmEngine: wasmEngineRef.current,
            playSynth,
            playDrum,
            playSampler,
            loadSampleToEngine,
            renderSynthPartToBuffer,
            playBufferedPart,
            playAmbiance,
            stopAmbiance,
            setAmbianceVolume,
            setMasterVolume,
            setGlobalPan
        };

        setIsReady(true);
    }, []);

    return { audioEngine: audioEngineRef.current, isReady, initializeAudio };
};

// Helper for distortion
function makeDistortionCurve(amount: number) {
    const k = typeof amount === 'number' ? amount : 50,
        n_samples = 44100,
        curve = new Float32Array(n_samples),
        deg = Math.PI / 180;
    let x;
    for (let i = 0; i < n_samples; ++i) {
        x = (i * 2) / n_samples - 1;
        curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
}
