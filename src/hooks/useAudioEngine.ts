import { useState, useCallback, useRef, useEffect } from 'react';
import type { AudioEngine, SynthParams, DrumSound, KickParams, SnareParams, HatParams, SamplerBankParams, PartSequence } from '../types';
import { noteToFrequency, NUM_STEPS } from '../constants';
import { WebGpuOscillator } from '../engines/WebGpuOscillator';
import { WasmOscillator } from '../engines/WasmOscillator';

export const useAudioEngine = (pyodide: any) => {
    const [isReady, setIsReady] = useState(false);
    const audioEngineRef = useRef<AudioEngine | null>(null);
    const sustainNodeRef = useRef<AudioWorkletNode | null>(null);
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

    // Live note tracking refs (must be at top level for hooks rules)
    const nextSynthNoteId = useRef(1);
    const activeSynthNotes = useRef(new Map<number, { stop: () => void }>());
    const nextSamplerNoteId = useRef(1);
    const activeSamplerNotes = useRef(new Map<number, { source: AudioBufferSourceNode; envGain: GainNode }>());

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

        // Try to initialize SustainProcessor worklet (best-effort)
        try {
            await context.audioWorklet.addModule('/sustain-processor.js');
            const sustainNode = new AudioWorkletNode(context, 'sustain-processor', {
                numberOfInputs: 0,
                numberOfOutputs: 1,
                outputChannelCount: [2]
            });
            sustainNode.connect(masterGainRef.current!);
            sustainNodeRef.current = sustainNode;
            console.log('SustainProcessor initialized in AudioEngine');
        } catch (e) {
            console.warn('Sustain worklet not available:', e);
            sustainNodeRef.current = null;
        }

        // Create a white noise buffer
        const bufferSize = context.sampleRate * 2;
        const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
        const output = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        noiseBufferRef.current = buffer;

        // UPDATED: Now accepts durationSteps and stepTime to calculate dynamic gate length
        const playSynth = async (params: SynthParams, note: string, time: number, durationSteps: number = 1, stepTime: number = 0.125) => {
            const destination = masterGainRef.current!;

            const isPyodideWave = params.waveform.startsWith('pyodide-');
            const isWgslWave = params.waveform.startsWith('wgsl-');
            const isWasmWave = params.waveform.startsWith('wam-');
            const isWavWave = params.waveform.startsWith('wav-');

            // --- ADSR / GATE LOGIC UPDATED ---
            // We prioritize the sequencer's calculated duration (durationSteps * stepTime).
            // If that's 0 or null, we fallback to params.length (the Gate knob).
            const seqDuration = durationSteps * stepTime;
            const gateTime = seqDuration > 0 ? seqDuration : (params.length || 0.25);
            
            // The total sound duration must include the release tail
            const totalDuration = gateTime + params.release;

            // --- Gain Envelope ---
            const gain = context.createGain();
            gain.gain.setValueAtTime(0, time);
            gain.gain.linearRampToValueAtTime(params.volume, time + params.attack);

            const sustainLevel = params.volume * params.sustain;
            gain.gain.linearRampToValueAtTime(sustainLevel, time + params.attack + params.decay);
            
            // Hold Sustain until Gate Time
            gain.gain.setValueAtTime(sustainLevel, time + gateTime);
            // Release after Gate Time
            gain.gain.linearRampToValueAtTime(0, time + gateTime + params.release);

            // --- Delay Chain ---
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
                    const sampleRootFreq = params.waveform === 'wav-saw' ? 32.86 : 65.72;

                    source.playbackRate.setValueAtTime(freqWithPitch / sampleRootFreq, time);

                    const filter = context.createBiquadFilter();
                    filter.type = 'lowpass';
                    filter.frequency.setValueAtTime(params.filterCutoff, time);
                    filter.Q.setValueAtTime(params.filterResonance, time);

                    source.connect(filter);
                    filter.connect(outputNode);

                    source.start(time);
                    // UPDATED: Stop after total duration (gate + release)
                    source.stop(time + totalDuration + 0.1);
                }
            } else if (isWgslWave && gpuEngineRef.current?.isSupported) {
                try {
                    const baseFreq = noteToFrequency(note);
                    const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);
                    const type = params.waveform.split('-')[1] as 'saw' | 'sqr' | 'tri' | 'sin';

                    // UPDATED: Pass calculated totalDuration to GPU
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

                    // UPDATED: Pass calculated totalDuration to WASM
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

                    // UPDATED: Pass totalDuration
                    const pyProxy = pyodideRef.current.globals.get('generate_wave')(
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
                // UPDATED: Stop after totalDuration
                osc.stop(time + totalDuration + 0.05);
            }
        };


        // Live note on/off for synths
        const MAX_SYNTH_VOICES = 8;
        const generatorCache = new Map<string, AudioBuffer>();
        const BASE_GENERATION_FREQ = 220; // Hz - single-cycle buffer frequency used for caching

        const getOrGenerateSingleCycleBuffer = async (engine: 'wgsl' | 'wam' | 'pyodide', type: 'saw' | 'sqr' | 'tri' | 'sin', filterCutoff: number = 20000, filterResonance: number = 0): Promise<AudioBuffer | null> => {
            const sampleRate = context.sampleRate;
            const key = `${engine}:${type}:${BASE_GENERATION_FREQ}:${sampleRate}:${filterCutoff}:${filterResonance}`;
            if (generatorCache.has(key)) return generatorCache.get(key)!;

            const duration = 1 / BASE_GENERATION_FREQ; // one cycle
            let samples: Float32Array | null = null;
            try {
                if (engine === 'wgsl' && gpuEngineRef.current?.isSupported) {
                    samples = await gpuEngineRef.current.generate(BASE_GENERATION_FREQ, duration, sampleRate, type);
                } else if (engine === 'wam' && wasmEngineRef.current?.isReady) {
                    samples = wasmEngineRef.current.generate(BASE_GENERATION_FREQ, duration, sampleRate, type, filterCutoff, filterResonance) as Float32Array;
                } else if (engine === 'pyodide' && pyodideRef.current) {
                    try {
                        pyodideRef.current.globals.get('set_sample_rate')(sampleRate);
                        const proxy = pyodideRef.current.globals.get('generate_wave')(BASE_GENERATION_FREQ, duration, type, filterCutoff, filterResonance);
                        samples = proxy.toJs({ array_buffer_type: 'float32' });
                        proxy.destroy();
                    } catch (e) {
                        console.error('Pyodide generator single-cycle error', e);
                        samples = null;
                    }
                }
            } catch (err) {
                console.error('generate single-cycle error', err);
                samples = null;
            }

            if (!samples || samples.length === 0) return null;

            const audioBuf = context.createBuffer(1, samples.length, sampleRate);
            audioBuf.getChannelData(0).set(samples);
            generatorCache.set(key, audioBuf);
            return audioBuf;
        };

        const noteOnSynth = async (params: SynthParams, note: string, time?: number) => {
            const now = time || context.currentTime;
            try {
                const isWavWave = params.waveform.startsWith('wav-');
                const isWgslWave = params.waveform.startsWith('wgsl-');
                const isWasmWave = params.waveform.startsWith('wam-');
                const isPyodideWave = params.waveform.startsWith('pyodide-');
                if (isWavWave) {
                    const buffer = params.waveform === 'wav-saw' ? wavSawBufferRef.current : wavSqrBufferRef.current;
                    if (!buffer) return null;
                    const source = context.createBufferSource();
                    source.buffer = buffer;
                    source.loop = true;

                    const baseFreq = noteToFrequency(note);
                    const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);
                    const sampleRootFreq = params.waveform === 'wav-saw' ? 32.86 : 65.72;
                    source.playbackRate.setValueAtTime(freqWithPitch / sampleRootFreq, now);

                    const envGain = context.createGain();
                    envGain.gain.setValueAtTime(0, now);
                    envGain.gain.linearRampToValueAtTime(params.volume, now + params.attack);
                    const sustainLevel = params.volume * params.sustain;
                    envGain.gain.linearRampToValueAtTime(sustainLevel, now + params.attack + params.decay);

                    const filter = context.createBiquadFilter();
                    filter.type = 'lowpass';
                    filter.frequency.setValueAtTime(params.filterCutoff || 20000, now);
                    filter.Q.setValueAtTime(params.filterResonance || 0, now);

                    source.connect(filter);
                    filter.connect(envGain);
                    envGain.connect(masterGainRef.current!);

                    source.start(now);

                    if (activeSynthNotes.current.size >= MAX_SYNTH_VOICES) {
                        const oldestId = activeSynthNotes.current.keys().next().value;
                        if (oldestId !== undefined) {
                            const oldest = activeSynthNotes.current.get(oldestId as number);
                            if (oldest && oldest.stop) oldest.stop();
                        }
                    }
                    const id = nextSynthNoteId.current++;
                    const stop = () => {
                        const t = context.currentTime;
                        envGain.gain.cancelScheduledValues(t);
                        envGain.gain.setValueAtTime(envGain.gain.value || sustainLevel, t);
                        envGain.gain.linearRampToValueAtTime(0, t + params.release);
                        try { source.stop(t + params.release + 0.05); } catch (e) { }
                        activeSynthNotes.current.delete(id);
                    };
                    activeSynthNotes.current.set(id, { stop });
                    return id;
                }
                // WGSL / Wasm / Pyodide synthesized waves (generate buffer and loop)
                if (isWgslWave || isWasmWave || isPyodideWave) {
                    const type = params.waveform.split('-')[1] as 'saw' | 'sqr' | 'tri' | 'sin';
                    const freqWithPitch = noteToFrequency(note) * Math.pow(2, params.pitch / 12);
                    // Use cached single-cycle generator to reduce CPU (lower duration)
                    const engine = isWgslWave ? 'wgsl' : isWasmWave ? 'wam' : 'pyodide';
                    const audioBuf = await getOrGenerateSingleCycleBuffer(engine as any, type, params.filterCutoff || 20000, params.filterResonance || 0);
                    if (audioBuf) {
                        const source = context.createBufferSource();
                        source.buffer = audioBuf;
                        source.loop = true;
                        // playbackRate to transpose from base generation freq to desired freq
                        const playbackRate = freqWithPitch / BASE_GENERATION_FREQ;
                        source.playbackRate.setValueAtTime(playbackRate, now);

                        const envGain = context.createGain();
                        envGain.gain.setValueAtTime(0, now);
                        envGain.gain.linearRampToValueAtTime(params.volume, now + params.attack);
                        const sustainLevel = params.volume * params.sustain;
                        envGain.gain.linearRampToValueAtTime(sustainLevel, now + params.attack + params.decay);

                        const filter = context.createBiquadFilter();
                        filter.type = 'lowpass';
                        filter.frequency.setValueAtTime(params.filterCutoff || 20000, now);
                        filter.Q.setValueAtTime(params.filterResonance || 0, now);

                        source.connect(filter);
                        filter.connect(envGain);
                        envGain.connect(masterGainRef.current!);

                        source.start(now);
                        // Voice allocator: enforce max voices
                        if (activeSynthNotes.current.size >= MAX_SYNTH_VOICES) {
                            const oldestId = activeSynthNotes.current.keys().next().value;
                            if (oldestId !== undefined) {
                                const oldest = activeSynthNotes.current.get(oldestId as number);
                                if (oldest && oldest.stop) oldest.stop();
                            }
                        }
                        const id2 = nextSynthNoteId.current++;
                        const stop2 = () => {
                            const t = context.currentTime;
                            envGain.gain.cancelScheduledValues(t);
                            envGain.gain.setValueAtTime(envGain.gain.value || sustainLevel, t);
                            envGain.gain.linearRampToValueAtTime(0, t + params.release);
                            try { source.stop(t + params.release + 0.05); } catch (e) { }
                            activeSynthNotes.current.delete(id2);
                        };
                        activeSynthNotes.current.set(id2, { stop: stop2 });
                        return id2;
                    }
                }

                // Fallback oscillator sustain
                const baseFreq = noteToFrequency(note);
                const freqWithPitch = baseFreq * Math.pow(2, params.pitch / 12);
                const osc = context.createOscillator();
                osc.frequency.setValueAtTime(freqWithPitch, now);
                let waveType = params.waveform;
                if (waveType.includes('saw')) waveType = 'sawtooth';
                else if (waveType.includes('sqr')) waveType = 'square';
                else if (waveType.includes('tri')) waveType = 'triangle';
                else if (waveType.includes('sin')) waveType = 'sine';
                // @ts-ignore
                osc.type = waveType as OscillatorType;

                const envGain = context.createGain();
                envGain.gain.setValueAtTime(0, now);
                envGain.gain.linearRampToValueAtTime(params.volume, now + params.attack);
                const sustainLevel = params.volume * params.sustain;
                envGain.gain.linearRampToValueAtTime(sustainLevel, now + params.attack + params.decay);

                const filter = context.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(params.filterCutoff || 20000, now);
                filter.Q.setValueAtTime(params.filterResonance || 0, now);

                osc.connect(filter);
                filter.connect(envGain);
                envGain.connect(masterGainRef.current!);

                osc.start(now);
                if (activeSynthNotes.current.size >= MAX_SYNTH_VOICES) {
                    const oldestId = activeSynthNotes.current.keys().next().value;
                    if (oldestId !== undefined) {
                        const oldest = activeSynthNotes.current.get(oldestId as number);
                        if (oldest && oldest.stop) oldest.stop();
                    }
                }
                const id = nextSynthNoteId.current++;
                const stop = () => {
                    const t = context.currentTime;
                    envGain.gain.cancelScheduledValues(t);
                    envGain.gain.setValueAtTime(envGain.gain.value || sustainLevel, t);
                    envGain.gain.linearRampToValueAtTime(0, t + params.release);
                    try { osc.stop(t + params.release + 0.05); } catch (e) { }
                    activeSynthNotes.current.delete(id);
                };
                activeSynthNotes.current.set(id, { stop });
                return id;
            } catch (e) { console.error('noteOnSynth:', e); return null; }
        };

        const noteOffSynth = (id: number) => {
            const entry = activeSynthNotes.current.get(id);
            if (!entry) return;
            entry.stop();
        };

        const playDrum = (sound: DrumSound, params: KickParams | SnareParams | HatParams, time: number) => {
            if (!pyodideRef.current) {
                console.warn("Pyodide not ready, skipping drum trigger.");
                return;
            }

            try {
                let pyProxy;
                const p = params as any;
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

            // Also load into SustainProcessor (AudioWorklet) if present
            try {
                if (sustainNodeRef.current) {
                    // Copy into a transferable Float32Array
                    const floatArr = new Float32Array(channelData.length);
                    floatArr.set(channelData);
                    sustainNodeRef.current.port.postMessage({ type: 'loadBuffer', data: { buffer: floatArr } }, [floatArr.buffer]);
                }
            } catch (e) { console.error("Error sending sample to Worklet:", e); }
        };

        const playSampler = (params: SamplerBankParams, note: string, time: number, durationSteps: number = 1, stepTime: number = 0.125) => {
            console.log("playSampler called:", { name: params.sampleName, note, durationSteps, stepTime, pyodideReady: !!pyodideRef.current });
            if (!pyodideRef.current) return;

            try {
                // 1. Calculate Pitch Ratio
                const baseFreq = noteToFrequency('C4');
                const targetFreq = noteToFrequency(note);
                const ratio = targetFreq / baseFreq * params.playbackSpeed;

                // 2. Generate Audio via Pyodide
                const pyProxy = pyodideRef.current.globals.get('generate_sampler')(params.sampleName, ratio, params.volume);
                const audioSamples = pyProxy.toJs({ array_buffer_type: "float32" });
                pyProxy.destroy();

                if (audioSamples.length === 0) return;

                // 3. Create Audio Source
                const buffer = context.createBuffer(1, audioSamples.length, context.sampleRate);
                buffer.getChannelData(0).set(audioSamples);

                const source = context.createBufferSource();
                source.buffer = buffer;

                // --- SUSTAIN ENVELOPE (Gate) ---
                // Calculate duration in seconds based on steps
                const noteDuration = durationSteps * stepTime;
                const attack = 0.01; // Fast attack
                const release = 0.1; // Short fade out to avoid clicks

                const envGain = context.createGain();
                envGain.gain.setValueAtTime(0, time);
                envGain.gain.linearRampToValueAtTime(1.0, time + attack);

                // Sustain phase (Hold at 1.0)
                envGain.gain.setValueAtTime(1.0, time + noteDuration);

                // Release phase
                envGain.gain.linearRampToValueAtTime(0, time + noteDuration + release);

                // --- DSP CHAIN ---
                // Source -> Filter -> Drive -> Envelope -> Master

                const filter = context.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(params.filterCutoff || 20000, time);
                filter.Q.setValueAtTime(params.filterResonance || 0, time);

                const driveNode = context.createWaveShaper();
                if (params.drive > 0) {
                    driveNode.curve = makeDistortionCurve(params.drive * 50);
                    driveNode.oversample = '4x';
                } else {
                    driveNode.curve = null; // Bypass
                }

                // Connections
                source.connect(filter);
                filter.connect(driveNode);
                driveNode.connect(envGain); // Connect to Envelope instead of Master directly

                // Delay Send (Optional)
                if (params.delaySend > 0) {
                    const delay = context.createDelay(1.0);
                    const feedback = context.createGain();
                    const wetGain = context.createGain();

                    delay.delayTime.setValueAtTime(0.3, time);
                    feedback.gain.setValueAtTime(0.4, time);
                    wetGain.gain.setValueAtTime(params.delaySend, time);

                    // Send from Post-Envelope so delay tails fade out naturally if we cut the note
                    envGain.connect(delay);
                    delay.connect(feedback);
                    feedback.connect(delay);
                    delay.connect(wetGain);
                    wetGain.connect(masterGainRef.current!);
                }

                // Main Output
                envGain.connect(masterGainRef.current!);

                source.start(time);
                // Stop source after envelope release to save CPU
                source.stop(time + noteDuration + release + 0.1);

            } catch (e) { console.error("Sampler Error", e); }
        };

        // Live note-on/note-off for Sampler

        const noteOnSampler = (params: SamplerBankParams, note: string, time?: number) => {
            if (!pyodideRef.current) return null;
            const now = time || context.currentTime;
            // Prefer Worklet if available
            if (sustainNodeRef.current) {
                try {
                    const baseFreq = noteToFrequency('C4');
                    const targetFreq = noteToFrequency(note);
                    const ratio = targetFreq / baseFreq * params.playbackSpeed;
                    sustainNodeRef.current.port.postMessage({ type: 'noteOn', data: { pitch: ratio } });
                    const id = nextSamplerNoteId.current++;
                    activeSamplerNotes.current.set(id, { source: null as any, envGain: null as any });
                    return id;
                } catch (e) {
                    console.error('Worklet noteOnSampler error', e);
                    // fallback to existing path
                }
            }
            try {
                const baseFreq = noteToFrequency('C4');
                const targetFreq = noteToFrequency(note);
                const ratio = targetFreq / baseFreq * params.playbackSpeed;

                const pyProxy = pyodideRef.current.globals.get('generate_sampler')(params.sampleName, ratio, params.volume);
                const audioSamples = pyProxy.toJs({ array_buffer_type: 'float32' });
                pyProxy.destroy();
                if (!audioSamples || audioSamples.length === 0) return null;

                const buffer = context.createBuffer(1, audioSamples.length, context.sampleRate);
                buffer.getChannelData(0).set(audioSamples);

                const source = context.createBufferSource();
                source.buffer = buffer;
                source.loop = true;

                const envGain = context.createGain();
                envGain.gain.setValueAtTime(0, now);
                envGain.gain.linearRampToValueAtTime(1.0, now + 0.01);

                const filter = context.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(params.filterCutoff || 20000, now);
                filter.Q.setValueAtTime(params.filterResonance || 0, now);

                const driveNode = context.createWaveShaper();
                if (params.drive && params.drive > 0) {
                    driveNode.curve = makeDistortionCurve(params.drive * 50);
                    driveNode.oversample = '4x';
                } else {
                    driveNode.curve = null;
                }

                source.connect(filter);
                filter.connect(driveNode);
                driveNode.connect(envGain);
                envGain.connect(masterGainRef.current!);

                source.start(now);
                const id = nextSamplerNoteId.current++;
                activeSamplerNotes.current.set(id, { source, envGain });
                return id;
            } catch (e) { console.error('noteOnSampler:', e); return null; }
        };

        const noteOffSampler = (id: number) => {
            const entry = activeSamplerNotes.current.get(id);
            if (!entry) return;
            const { source, envGain } = entry;
            if (!source && sustainNodeRef.current) {
                try {
                    sustainNodeRef.current.port.postMessage({ type: 'noteOff', data: {} });
                } catch (e) { console.error('sustain worklet noteOff error', e); }
                activeSamplerNotes.current.delete(id);
                return;
            }
            const now = context.currentTime;
            envGain.gain.cancelScheduledValues(now);
            // ramp to zero in 0.1s
            envGain.gain.setValueAtTime(envGain.gain.value || 1.0, now);
            envGain.gain.linearRampToValueAtTime(0, now + 0.12);
            try { source.stop(now + 0.12 + 0.05); } catch (e) { }
            activeSamplerNotes.current.delete(id);
        };

        const stopAllNotes = () => {
            // Stop all synth notes
            activeSynthNotes.current.forEach((entry) => {
                entry.stop();
            });
            activeSynthNotes.current.clear();

            // Stop all sampler notes
            activeSamplerNotes.current.forEach((_entry, id) => {
                 noteOffSampler(id);
            });
            // noteOffSampler removes them from map, but let's be safe
            activeSamplerNotes.current.clear();
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

        const detectSamplePitch = async (buffer: AudioBuffer) => {
            if (!pyodideRef.current) return null;
            try {
                const data = Array.from(buffer.getChannelData(0));
                // Call Python to get JSON string
                const jsonStr = await pyodideRef.current.globals.get('analyze_sample')(data);
                return JSON.parse(jsonStr);
            } catch (e) {
                console.error("detectSamplePitch Error:", e);
                return null;
            }
        };

        const processSinging = async (sampleName: string, note: string, steps: number, tempo: number) => {
            if (!pyodideRef.current) return null;

            try {
                // Call Python
                const pyProxy = await pyodideRef.current.globals.get('process_singing_sample')(
                    sampleName,
                    note,
                    steps,
                    tempo
                );

                const audioSamples = pyProxy.toJs({ array_buffer_type: "float32" });
                pyProxy.destroy();

                if (audioSamples.length === 0) return null;

                // Create buffer
                const buffer = context.createBuffer(1, audioSamples.length, context.sampleRate);
                buffer.getChannelData(0).set(audioSamples);

                return buffer;
            } catch (e) {
                console.error("Process Singing Error:", e);
                return null;
            }
        };

        const processSpoon = async (sampleName: string, note: string) => {
            if (!pyodideRef.current) return null;
            try {
                const pyProxy = await pyodideRef.current.globals.get('process_spoon_sample')(
                    sampleName,
                    note
                );
                const audioSamples = pyProxy.toJs({ array_buffer_type: "float32" });
                pyProxy.destroy();

                if (audioSamples.length === 0) return null;

                const buffer = context.createBuffer(1, audioSamples.length, context.sampleRate);
                buffer.getChannelData(0).set(audioSamples);
                return buffer;
            } catch (e) {
                console.error("Process Spoon Error:", e);
                return null;
            }
        };

        // Sustain Processor Controls
        const setSustainMode = (mode: 'loop' | 'stretch' | 'wavetable') => {
            if (!sustainNodeRef.current) return;
            const modeParam = sustainNodeRef.current.parameters.get('mode');
            if (modeParam) {
                const modeValue = mode === 'loop' ? 0 : mode === 'stretch' ? 1 : 2;
                const now = context.currentTime;
                modeParam.setValueAtTime(modeValue, now);
            }
        };

        const setSustainGrainSize = (size: number) => {
            if (!sustainNodeRef.current) return;
            sustainNodeRef.current.port.postMessage({
                type: 'setGrainSize',
                data: { size }
            });
        };


        audioEngineRef.current = {
            context,
            webGpuEngine: gpuEngineRef.current,
            wasmEngine: wasmEngineRef.current,
            playSynth,
            playDrum,
            playSampler,
            noteOnSampler,
            noteOffSampler,
            noteOnSynth,
            noteOffSynth,
            stopAllNotes,
            loadSampleToEngine,
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
            setSustainMode,
            setSustainGrainSize
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
