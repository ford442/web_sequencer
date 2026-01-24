import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { AudioEngine, SynthParams, DrumSound, KickParams, SnareParams, HatParams, SamplerBankParams, PartSequence } from '../types';
import { noteToFrequency, NUM_STEPS } from '../constants';
import { noteToMidi } from '../utils/musicTheory';
import { WebGpuOscillator } from '../engines/WebGpuOscillator';
import { WasmOscillator } from '../engines/WasmOscillator';
// Updated Import
import { SingingVoice, REFERENCE_FREQUENCIES, freqToMidi } from '../engines/SingingVoice'; 

// Helper to convert mode string to worklet numeric value
const modeToWorkletValue = (mode: 'loop' | 'stretch' | 'wavetable'): number => {
    return mode === 'loop' ? 0 : mode === 'stretch' ? 1 : 2;
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

export const useAudioEngine = (pyodide: any) => {
    const [isReady, setIsReady] = useState(false);
    const audioEngineRef = useRef<AudioEngine | null>(null);
    const singingVoiceRef = useRef<SingingVoice | null>(null);
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

    // Live note tracking refs
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

        // Initialize GPU Engine
        const gpuEngine = new WebGpuOscillator();
        await gpuEngine.init();
        gpuEngineRef.current = gpuEngine;

        // Initialize Wasm Engine
        const wasmEngine = new WasmOscillator();
        await wasmEngine.init();
        wasmEngineRef.current = wasmEngine;

        // Load WAV Files
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

        // Initialize SustainProcessor worklet
        try {
            await context.audioWorklet.addModule('./sustain-processor.js');
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

        // --- NEW SINGING VOICE INITIALIZATION ---
        try {
            // 1. Initialize Instance
            singingVoiceRef.current = new SingingVoice(context, {
                useHighQuality: false,
                preserveFormants: true,
                channels: 1,
                bufferSize: 16384
            });

            // 2. Init Worklet
            await singingVoiceRef.current.initWorklet();
            
            // Connect SingingVoice output to Master
            singingVoiceRef.current.getSourceNode().connect(masterGainRef.current!);

            // 3. Pre-cache TTS at reference pitches if Pyodide is ready
            if (pyodideRef.current) {
                const cachePromises: Promise<void>[] = [];
                for (const [level, freq] of Object.entries(REFERENCE_FREQUENCIES)) {
                    // Safety check for frequency
                    if (typeof freq !== 'number') continue;

                    const midiNote = Math.round(freqToMidi(freq));
                    cachePromises.push(
                        (async () => {
                            try {
                                const pyProxy = pyodideRef.current.globals.get('generate_tts_sample')(
                                    'default_lyrics', // Placeholder lyrics
                                    midiNote,
                                    1, // Short duration for caching
                                    120 // Default tempo
                                );
                                const audioSamples = pyProxy.toJs({ array_buffer_type: 'float32' });
                                pyProxy.destroy();
                                if (audioSamples && audioSamples.length > 0) {
                                    singingVoiceRef.current!.setCachedAudio(level as keyof typeof REFERENCE_FREQUENCIES, new Float32Array(audioSamples));
                                }
                            } catch (e) {
                                console.warn(`Failed to cache TTS for ${level}:`, e);
                            }
                        })()
                    );
                }
                await Promise.all(cachePromises);
                console.log('SingingVoice initialized and cached');
            } else {
                console.warn('Pyodide not ready during audio init, skipping SingingVoice cache.');
            }
        } catch (e) {
            console.error('Failed to initialize SingingVoice:', e);
        }

        // Create a white noise buffer
        const bufferSize = context.sampleRate * 2;
        const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
        const output = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
        noiseBufferRef.current = buffer;

        // Single Cycle Generator Cache
        const generatorCache = new Map<string, AudioBuffer>();
        const BASE_GENERATION_FREQ = 220; 

        const getOrGenerateSingleCycleBuffer = async (engine: 'wgsl' | 'wam' | 'pyodide', type: 'saw' | 'sqr' | 'tri' | 'sin', filterCutoff: number = 20000, filterResonance: number = 0): Promise<AudioBuffer | null> => {
            const sampleRate = context.sampleRate;
            const key = `${engine}:${type}:${BASE_GENERATION_FREQ}:${sampleRate}:${filterCutoff}:${filterResonance}`;
            if (generatorCache.has(key)) return generatorCache.get(key)!;

            const duration = 1 / BASE_GENERATION_FREQ; 
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

        const playSynth = async (
            params: SynthParams,
            noteOrChord: string | string[],
            time: number,
            durationSteps: number = 1,
            stepTime: number = 0.125,
            slideFromFreq: number | null = null
        ) => {
            const destination = masterGainRef.current!;
            const seqDuration = durationSteps * stepTime;
            const gateTime = seqDuration > 0 ? seqDuration : (params.length || 0.25);
            const totalDuration = gateTime + params.release;

            const notesToPlay = Array.isArray(noteOrChord) ? noteOrChord : [noteOrChord];

            let engine: 'wav' | 'wgsl' | 'wam' | 'pyodide' | 'native' = 'native';
            let waveType = params.waveform;

            if (params.waveform.startsWith('wav-')) { engine = 'wav'; }
            // @ts-ignore
            else if (params.waveform.startsWith('wgsl-')) { engine = 'wgsl'; waveType = params.waveform.split('-')[1] as any; }
            // @ts-ignore
            else if (params.waveform.startsWith('wam-')) { engine = 'wam'; waveType = params.waveform.split('-')[1] as any; }
            // @ts-ignore
            else if (params.waveform.startsWith('rust-')) { engine = 'rust' as any; waveType = params.waveform.split('-')[1] as any; }
            // @ts-ignore
            else if (params.waveform.startsWith('pyodide-')) { engine = 'pyodide'; waveType = params.waveform.split('-')[1] as any; }

            let buffer: AudioBuffer | null = null;
            let sampleRootFreq = 440; 

            if (engine === 'wav') {
                buffer = params.waveform === 'wav-saw' ? wavSawBufferRef.current : wavSqrBufferRef.current;
                sampleRootFreq = params.waveform === 'wav-saw' ? 32.86 : 65.72;
            }
            else if (engine !== 'native') {
                buffer = await getOrGenerateSingleCycleBuffer(
                    engine,
                    waveType as any,
                    20000,
                    0
                );
                sampleRootFreq = 220; 
            }

            notesToPlay.forEach((note) => {
                const baseFreq = noteToFrequency(note);
                const targetFreq = baseFreq * Math.pow(2, params.pitch / 12);

                if (buffer) {
                    const source = context.createBufferSource();
                    source.buffer = buffer;
                    source.loop = true;

                    const targetRate = targetFreq / sampleRootFreq;

                    if (slideFromFreq) {
                        const startRate = slideFromFreq / sampleRootFreq;
                        source.playbackRate.setValueAtTime(startRate, time);
                        const slideDur = Math.max(0.05, params.attack);
                        source.playbackRate.exponentialRampToValueAtTime(targetRate, time + slideDur);
                    } else {
                        source.playbackRate.setValueAtTime(targetRate, time);
                    }

                    const envGain = context.createGain();
                    envGain.gain.setValueAtTime(0, time);
                    envGain.gain.linearRampToValueAtTime(params.volume, time + params.attack);
                    const sustainLevel = params.volume * params.sustain;
                    envGain.gain.linearRampToValueAtTime(sustainLevel, time + params.attack + params.decay);
                    envGain.gain.setValueAtTime(sustainLevel, time + gateTime);
                    envGain.gain.linearRampToValueAtTime(0, time + gateTime + params.release);

                    const filter = context.createBiquadFilter();
                    filter.type = 'lowpass';
                    filter.frequency.setValueAtTime(params.filterCutoff, time);
                    filter.Q.setValueAtTime(params.filterResonance, time);

                    if (params.delayMix > 0 && params.delayTime > 0) {
                        const dryGain = context.createGain();
                        const wetGain = context.createGain();
                        const delay = context.createDelay(1.0);
                        const feedback = context.createGain();

                        dryGain.gain.setValueAtTime(1.0 - params.delayMix, time);
                        wetGain.gain.setValueAtTime(params.delayMix, time);
                        delay.delayTime.setValueAtTime(params.delayTime, time);
                        feedback.gain.setValueAtTime(params.delayFeedback, time);

                        envGain.connect(dryGain);
                        dryGain.connect(destination);

                        envGain.connect(delay);
                        delay.connect(feedback);
                        feedback.connect(delay);
                        delay.connect(wetGain);
                        wetGain.connect(destination);
                    } else {
                          envGain.connect(destination);
                    }

                    source.connect(filter);
                    filter.connect(envGain);

                    source.start(time);
                    source.stop(time + totalDuration + 0.1);
                }
                else {
                    const osc = context.createOscillator();
                    let typeStr = waveType;
                    if (typeStr.includes('saw')) typeStr = 'sawtooth';
                    else if (typeStr.includes('sqr')) typeStr = 'square';
                    else if (typeStr.includes('tri')) typeStr = 'triangle';
                    else if (typeStr.includes('sin')) typeStr = 'sine';

                    // @ts-ignore
                    osc.type = typeStr as OscillatorType;

                    if (slideFromFreq) {
                        osc.frequency.setValueAtTime(slideFromFreq, time);
                        const slideDur = Math.max(0.05, params.attack);
                        osc.frequency.exponentialRampToValueAtTime(targetFreq, time + slideDur);
                    } else {
                        osc.frequency.setValueAtTime(targetFreq, time);
                    }

                    const envGain = context.createGain();
                    envGain.gain.setValueAtTime(0, time);
                    envGain.gain.linearRampToValueAtTime(params.volume, time + params.attack);
                    const sustainLevel = params.volume * params.sustain;
                    envGain.gain.linearRampToValueAtTime(sustainLevel, time + params.attack + params.decay);
                    envGain.gain.setValueAtTime(sustainLevel, time + gateTime);
                    envGain.gain.linearRampToValueAtTime(0, time + gateTime + params.release);

                    const filter = context.createBiquadFilter();
                    filter.type = 'lowpass';
                    filter.frequency.setValueAtTime(params.filterCutoff, time);
                    filter.Q.setValueAtTime(params.filterResonance, time);

                    if (params.delayMix > 0 && params.delayTime > 0) {
                        const dryGain = context.createGain();
                        const wetGain = context.createGain();
                        const delay = context.createDelay(1.0);
                        const feedback = context.createGain();

                        dryGain.gain.setValueAtTime(1.0 - params.delayMix, time);
                        wetGain.gain.setValueAtTime(params.delayMix, time);
                        delay.delayTime.setValueAtTime(params.delayTime, time);
                        feedback.gain.setValueAtTime(params.delayFeedback, time);

                        envGain.connect(dryGain);
                        dryGain.connect(destination);
                        envGain.connect(delay);
                        delay.connect(feedback);
                        feedback.connect(delay);
                        delay.connect(wetGain);
                        wetGain.connect(destination);
                    } else {
                        envGain.connect(destination);
                    }

                    osc.connect(filter);
                    filter.connect(envGain);

                    osc.start(time);
                    osc.stop(time + totalDuration + 0.1);
                }
            });
        };


        // Live note on/off for synths
        const MAX_SYNTH_VOICES = 8;

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
                            try { source.stop(t + params.release + 0.05); } catch { /* ignore */ }
                        activeSynthNotes.current.delete(id);
                    };
                    activeSynthNotes.current.set(id, { stop });
                    return id;
                }
                
                if (isWgslWave || isWasmWave || isPyodideWave) {
                    const type = params.waveform.split('-')[1] as 'saw' | 'sqr' | 'tri' | 'sin';
                    const freqWithPitch = noteToFrequency(note) * Math.pow(2, params.pitch / 12);
                    const engine = isWgslWave ? 'wgsl' : isWasmWave ? 'wam' : 'pyodide';
                    const audioBuf = await getOrGenerateSingleCycleBuffer(engine as any, type, params.filterCutoff || 20000, params.filterResonance || 0);
                    if (audioBuf) {
                        const source = context.createBufferSource();
                        source.buffer = audioBuf;
                        source.loop = true;
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
                            try { source.stop(t + params.release + 0.05); } catch { /* ignore */ }
                            activeSynthNotes.current.delete(id2);
                        };
                        activeSynthNotes.current.set(id2, { stop: stop2 });
                        return id2;
                    }
                }

                // Fallback oscillator
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
                        try { osc.stop(t + params.release + 0.05); } catch { /* ignore */ }
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
                    const floatArr = new Float32Array(channelData.length);
                    floatArr.set(channelData);
                    sustainNodeRef.current.port.postMessage({ type: 'loadBuffer', data: { buffer: floatArr } }, [floatArr.buffer]);
                }
            } catch (e) { console.error("Error sending sample to Worklet:", e); }
        };

        const playSampler = (params: SamplerBankParams, note: string, time: number, durationSteps: number = 1, stepTime: number = 0.125) => {
            if (!pyodideRef.current) return;

            try {
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

                const noteDuration = durationSteps * stepTime;
                const attack = 0.01; 
                const release = 0.1; 

                const envGain = context.createGain();
                envGain.gain.setValueAtTime(0, time);
                envGain.gain.linearRampToValueAtTime(1.0, time + attack);
                envGain.gain.setValueAtTime(1.0, time + noteDuration);
                envGain.gain.linearRampToValueAtTime(0, time + noteDuration + release);

                const filter = context.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.setValueAtTime(params.filterCutoff || 20000, time);
                filter.Q.setValueAtTime(params.filterResonance || 0, time);

                const driveNode = context.createWaveShaper();
                if (params.drive > 0) {
                    driveNode.curve = makeDistortionCurve(params.drive * 50);
                    driveNode.oversample = '4x';
                } else {
                    driveNode.curve = null; 
                }

                source.connect(filter);
                filter.connect(driveNode);
                driveNode.connect(envGain);

                if (params.delaySend > 0) {
                    const delay = context.createDelay(1.0);
                    const feedback = context.createGain();
                    const wetGain = context.createGain();

                    delay.delayTime.setValueAtTime(0.3, time);
                    feedback.gain.setValueAtTime(0.4, time);
                    wetGain.gain.setValueAtTime(params.delaySend, time);

                    envGain.connect(delay);
                    delay.connect(feedback);
                    feedback.connect(delay);
                    delay.connect(wetGain);
                    wetGain.connect(masterGainRef.current!);
                }

                envGain.connect(masterGainRef.current!);

                source.start(time);
                source.stop(time + noteDuration + release + 0.1);

            } catch (e) { console.error("Sampler Error", e); }
        };

        const noteOnSampler = (params: SamplerBankParams, note: string, time?: number) => {
            if (!pyodideRef.current) return null;
            const now = time || context.currentTime;
            
            // Prefer Worklet if available
            if (sustainNodeRef.current) {
                try {
                    const baseFreq = noteToFrequency('C4');
                    const targetFreq = noteToFrequency(note);
                    const ratio = targetFreq / baseFreq * params.playbackSpeed;
                    sustainNodeRef.current.port.postMessage({ 
                        type: 'noteOn', 
                        data: { pitch: ratio, mode: modeToWorkletValue(params.mode || 'loop') }
                    });
                    const id = nextSamplerNoteId.current++;
                    activeSamplerNotes.current.set(id, { source: null as any, envGain: null as any });
                    return id;
                } catch (e) {
                    console.error('Worklet noteOnSampler error', e);
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
            envGain.gain.setValueAtTime(envGain.gain.value || 1.0, now);
            envGain.gain.linearRampToValueAtTime(0, now + 0.12);
            try { source.stop(now + 0.12 + 0.05); } catch { /* ignore */ }
            activeSamplerNotes.current.delete(id);
        };

        const stopAllNotes = () => {
            activeSynthNotes.current.forEach((entry) => {
                entry.stop();
            });
            activeSynthNotes.current.clear();

            activeSamplerNotes.current.forEach((_entry, id) => {
                  noteOffSampler(id);
            });
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
                const jsonStr = await pyodideRef.current.globals.get('analyze_sample')(data);
                return JSON.parse(jsonStr);
            } catch (e) {
                console.error("detectSamplePitch Error:", e);
                return null;
            }
        };

        // --- UPDATED PROCESS SINGING ---
        const processSinging = async (sampleName: string, note: string, steps: number, tempo: number) => {
            if (!singingVoiceRef.current || !pyodideRef.current) return null;

            try {
                // Generate base TTS at default pitch (C4)
                const pyProxy = pyodideRef.current.globals.get('process_singing_sample')(
                    sampleName,
                    'C4', // Base pitch for generation
                    steps,
                    tempo
                );

                const audioSamples = pyProxy.toJs({ array_buffer_type: 'float32' });
                pyProxy.destroy();

                if (audioSamples.length === 0) return null;

                // Create buffer from TTS output
                const baseBuffer = context.createBuffer(1, audioSamples.length, context.sampleRate);
                baseBuffer.getChannelData(0).set(audioSamples);

                // Convert target note to MIDI
                const targetMidiNote = noteToMidi(note);

                // Use SingingVoice to pitch shift to target note
                singingVoiceRef.current.setPitchFromMidi(targetMidiNote, 60); // C4 = 60
                await singingVoiceRef.current.process(baseBuffer.getChannelData(0));

                // Return the buffer (which now contains the pitch-shifted data)
                return baseBuffer;
            } catch (e) {
                console.error('Process Singing with Pitch Shift Error:', e);
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
            // Exposed SingingVoice instance
            singingVoice: singingVoiceRef.current || undefined,
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

    const result = useMemo(() => ({
        audioEngine: audioEngineRef.current,
        isReady,
        initializeAudio
    }), [isReady, initializeAudio]);

    return result;
};
