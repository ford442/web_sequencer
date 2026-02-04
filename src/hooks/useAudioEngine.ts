import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { AudioEngine, SynthParams, DrumSound, KickParams, SnareParams, HatParams, SamplerBankParams, PartSequence } from '../types';
import { noteToFrequency, NUM_STEPS } from '../constants';
import { noteToMidi } from '../utils/musicTheory';
import { WebGpuOscillator } from '../engines/WebGpuOscillator';
import { WasmOscillator } from '../engines/WasmOscillator';
import { Open303Oscillator } from '../engines/Open303Oscillator';
import { SingingVoice, REFERENCE_FREQUENCIES, freqToMidi } from '../engines/SingingVoice';
import sustainProcessorUrl from '../audio-worklets/sustain-processor.ts?worker&url';
// Import the new processor URL (we will create this file next)
import open303ProcessorUrl from '../audio-worklets/open303-processor.ts?worker&url';

// Helper for distortion
const distortionCurveCache = new Map<number, Float32Array<ArrayBuffer>>();
function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
    const k_raw = typeof amount === 'number' ? amount : 50;
    const k = Math.round(k_raw * 10) / 10;
    if (distortionCurveCache.has(k)) return distortionCurveCache.get(k)!;
    const n_samples = 8192, curve = new Float32Array(n_samples), deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
        let x = (i * 2) / n_samples - 1;
        curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    distortionCurveCache.set(k, curve);
    return curve;
}

const modeToWorkletValue = (mode: 'loop' | 'stretch' | 'wavetable'): number => {
    return mode === 'loop' ? 0 : mode === 'stretch' ? 1 : 2;
};

// Map UI params to Engine params
function apply303Params(engine: Open303Oscillator, params: SynthParams, waveType: string): void {
    engine.setWaveform(waveType === 'sqr' ? 1.0 : 0.0);
    // UI Cutoff (0-20000) -> Engine (0-1)
    engine.setCutoff(Math.max(0, Math.min(1, params.filterCutoff / 8000)));
    // UI Res (0-20) -> Engine (0-1)
    engine.setResonance(Math.max(0, Math.min(1, params.filterResonance / 20)));
    engine.setDecay(params.decay);
    engine.setVolume(params.volume);
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
    const open303EngineRef = useRef<Open303Oscillator | null>(null);

    // Native WAV buffers
    const wavSawBufferRef = useRef<AudioBuffer | null>(null);
    const wavSqrBufferRef = useRef<AudioBuffer | null>(null);

    // Master Volume & Pan
    const masterGainRef = useRef<GainNode | null>(null);
    const masterPannerRef = useRef<StereoPannerNode | null>(null);

    const pyodideRef = useRef(pyodide);

    // Live note tracking
    const nextSynthNoteId = useRef(1);
    const activeSynthNotes = useRef(new Map<number, { stop: () => void }>());
    const nextSamplerNoteId = useRef(1);
    const activeSamplerNotes = useRef(new Map<number, { source: AudioBufferSourceNode; envGain: GainNode }>());

    // Sampler generator cache (keep track of nodes for garbage collection prevention if needed, but mostly for re-use logic if applicable)
    // In this implementation, we create new nodes per trigger, so this might be for loaded buffers or similar.
    // Assuming standard implementation:
    const loadedSampleBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());


    useEffect(() => {
        pyodideRef.current = pyodide;
    }, [pyodide]);

    const initializeAudio = useCallback(async () => {
        if (audioEngineRef.current) return;

        try {
            const context = new (window.AudioContext || (window as any).webkitAudioContext)();

            // --- CRITICAL FIX: Ensure AudioContext is running ---
            if (context.state === 'suspended') {
                await context.resume();
                console.log("AudioContext resumed");
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
            await gpuEngine.init().catch(e => console.warn("GPU Engine init failed", e));
            gpuEngineRef.current = gpuEngine;

            const wasmEngine = new WasmOscillator();
            await wasmEngine.init().catch(e => console.warn("WASM Engine init failed", e));
            wasmEngineRef.current = wasmEngine;

            // Initialize Open303 Engine (TB-303 clone)
            // PASS THE WORKLET URL HERE
            const open303Engine = new Open303Oscillator();
            // Note: We are passing the URL to the init method now
            const open303Ready = await open303Engine.init(context, open303ProcessorUrl);

            if (open303Ready) {
                open303Engine.connect(masterGain);
                open303EngineRef.current = open303Engine;
                console.log('Open303 Engine Ready');
            } else {
                console.warn('Open303 Engine failed to initialize');
            }

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
            } catch (e) {
                console.warn('Sustain worklet not available:', e);
            }

            // --- Singing Voice Init (Fail-safe) ---
            try {
                singingVoiceRef.current = new SingingVoice(context, {
                    useHighQuality: false,
                    preserveFormants: true,
                    channels: 1,
                    bufferSize: 16384
                });
                await singingVoiceRef.current.initWorklet();
                singingVoiceRef.current.getSourceNode().connect(masterGainRef.current!);
                
                // Pre-cache if Pyodide ready
                if (pyodideRef.current) {
                    // ... (keep existing cache logic or simplify)
                }
            } catch (e) {
                console.warn('SingingVoice failed to init:', e);
            }

            // Noise Buffer
            const bufferSize = context.sampleRate * 2;
            const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
            const output = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                output[i] = Math.random() * 2 - 1;
            }
            noiseBufferRef.current = buffer;

            // Define Playback Functions

            const playSynth = (params: SynthParams, note: string, time: number, durationSteps: number = 1, stepTime: number = 0.2, slide: boolean = false) => {
                 if (!masterGainRef.current) return;

                 // Open303 Routing
                 if (params.waveform === '303-saw' || params.waveform === '303-sqr') {
                     if (open303EngineRef.current) {
                         apply303Params(open303EngineRef.current, params, params.waveform === '303-sqr' ? 'sqr' : 'saw');
                         const midi = noteToMidi(note);
                         // Convert time to something the engine handles?
                         // The engine uses real-time noteOn/Off.
                         // We need to schedule these.
                         // Since Open303Oscillator methods are immediate, we use setTimeout or AudioContext scheduling if we refactor Open303 to support scheduling.
                         // Current Open303 implementation (as refactored) calls port.postMessage immediately.
                         // For accurate timing in a sequencer, we should rely on the AudioWorklet's clock or schedule parameter automation.
                         // HOWEVER, for this fix, we will use basic setTimeout to trigger the events at the right time,
                         // recognizing this is less precise than sample-accurate scheduling.

                         // Determine delay until 'time'
                         const now = context.currentTime;
                         const startDelay = Math.max(0, time - now);
                         const duration = durationSteps * stepTime;

                         setTimeout(() => {
                             open303EngineRef.current?.noteOn(midi, 100);
                         }, startDelay * 1000);

                         setTimeout(() => {
                             if (!slide) {
                                 open303EngineRef.current?.noteOff(midi);
                             }
                         }, (startDelay + duration) * 1000);

                         return;
                     }
                 }

                 // Standard Synth Logic (WASM/WebGPU/Native)
                 const freq = noteToFrequency(note);
                 const osc = context.createOscillator();
                 const gain = context.createGain();

                 // Type selection
                 let customBuffer: AudioBuffer | null = null;
                 if (params.waveform === 'wav-saw') customBuffer = wavSawBufferRef.current;
                 else if (params.waveform === 'wav-sqr') customBuffer = wavSqrBufferRef.current;

                 if (customBuffer) {
                     // WAV playback logic
                     // ...
                 } else {
                     // Standard Oscillator
                     if (params.waveform === 'sawtooth' || params.waveform === 'square' || params.waveform === 'triangle' || params.waveform === 'sine') {
                        osc.type = params.waveform;
                     } else {
                        osc.type = 'sawtooth'; // Fallback
                     }
                 }

                 // Envelope
                 const now = time;
                 const attackEnd = now + params.attack;
                 const decayEnd = attackEnd + params.decay;
                 const releaseStart = now + (durationSteps * stepTime); // Simple gate
                 const releaseEnd = releaseStart + params.release;

                 gain.gain.setValueAtTime(0, now);
                 gain.gain.linearRampToValueAtTime(params.volume, attackEnd);
                 gain.gain.exponentialRampToValueAtTime(Math.max(0.001, params.volume * params.sustain), decayEnd);
                 gain.gain.setValueAtTime(Math.max(0.001, params.volume * params.sustain), releaseStart);
                 gain.gain.exponentialRampToValueAtTime(0.001, releaseEnd);

                 // Filter
                 const filter = context.createBiquadFilter();
                 filter.type = 'lowpass';
                 filter.frequency.setValueAtTime(params.filterCutoff, now);
                 filter.Q.value = params.filterResonance;

                 // Delay
                 const delay = context.createDelay();
                 delay.delayTime.value = params.delayTime;
                 const delayGain = context.createGain();
                 delayGain.gain.value = params.delayFeedback;

                 const wetGain = context.createGain();
                 wetGain.gain.value = params.delayMix;
                 const dryGain = context.createGain();
                 dryGain.gain.value = 1 - params.delayMix;

                 // Graph
                 osc.connect(filter);
                 filter.connect(gain);

                 // Split to Dry/Wet
                 gain.connect(dryGain);
                 gain.connect(delay);
                 delay.connect(delayGain);
                 delayGain.connect(delay); // Feedback
                 delay.connect(wetGain);

                 dryGain.connect(masterGainRef.current);
                 wetGain.connect(masterGainRef.current);

                 osc.frequency.setValueAtTime(freq, now);
                 osc.start(now);
                 osc.stop(releaseEnd + 0.1);

                 // Cleanup
                 setTimeout(() => {
                     osc.disconnect();
                     filter.disconnect();
                     gain.disconnect();
                     delay.disconnect();
                     wetGain.disconnect();
                     dryGain.disconnect();
                 }, (releaseEnd - now + 1.0) * 1000);
            };

            const playDrum = (sound: DrumSound, params: KickParams | SnareParams | HatParams, time: number) => {
                 if (!masterGainRef.current) return;
                 const now = time;

                 if (sound === 'kick') {
                     const p = params as KickParams;
                     const osc = context.createOscillator();
                     const gain = context.createGain();

                     osc.frequency.setValueAtTime(150, now);
                     osc.frequency.exponentialRampToValueAtTime(0.01, now + p.decay);

                     gain.gain.setValueAtTime(p.volume, now);
                     gain.gain.exponentialRampToValueAtTime(0.001, now + p.decay);

                     osc.connect(gain);
                     gain.connect(masterGainRef.current);

                     osc.start(now);
                     osc.stop(now + p.decay);
                 } else if (sound === 'snare') {
                     const p = params as SnareParams;
                     // Tone
                     const osc = context.createOscillator();
                     const oscGain = context.createGain();
                     osc.type = 'triangle';
                     osc.frequency.setValueAtTime(250, now);
                     oscGain.gain.setValueAtTime(p.tone * p.volume, now);
                     oscGain.gain.exponentialRampToValueAtTime(0.001, now + p.decay); // Using decay for tone too

                     // Noise
                     if (noiseBufferRef.current) {
                         const noise = context.createBufferSource();
                         noise.buffer = noiseBufferRef.current;
                         const noiseFilter = context.createBiquadFilter();
                         noiseFilter.type = 'highpass';
                         noiseFilter.frequency.value = 1000;
                         const noiseGain = context.createGain();
                         noiseGain.gain.setValueAtTime(p.noise * p.volume, now);
                         noiseGain.gain.exponentialRampToValueAtTime(0.001, now + p.decay);

                         noise.connect(noiseFilter);
                         noiseFilter.connect(noiseGain);
                         noiseGain.connect(masterGainRef.current);
                         noise.start(now);
                         noise.stop(now + p.decay);
                     }

                     osc.connect(oscGain);
                     oscGain.connect(masterGainRef.current);
                     osc.start(now);
                     osc.stop(now + p.decay);

                 } else {
                     // Hats
                     const p = params as HatParams;
                     if (noiseBufferRef.current) {
                        const src = context.createBufferSource();
                        src.buffer = noiseBufferRef.current;
                        const filter = context.createBiquadFilter();
                        filter.type = 'highpass';
                        filter.frequency.value = 5000; // Metallic
                        const gain = context.createGain();
                        gain.gain.setValueAtTime(p.volume, now);
                        gain.gain.exponentialRampToValueAtTime(0.001, now + p.decay);

                        src.connect(filter);
                        filter.connect(gain);
                        gain.connect(masterGainRef.current);
                        src.start(now);
                        src.stop(now + p.decay);
                     }
                 }
            };

            const loadSampleToEngine = (name: string, buffer: AudioBuffer) => {
                loadedSampleBuffersRef.current.set(name, buffer);
            };

            const playSampler = (params: SamplerBankParams, note: string, time: number, durationSteps: number = 1, stepTime: number = 0.2) => {
                const buffer = loadedSampleBuffersRef.current.get(params.sampleName);
                if (!buffer || !masterGainRef.current) return;

                // Simple One-shot for now (or basic loop if implemented)
                const source = context.createBufferSource();
                source.buffer = buffer;
                source.playbackRate.value = params.playbackSpeed;

                const gain = context.createGain();
                gain.gain.value = params.volume;

                const filter = context.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.value = params.filterCutoff;
                filter.Q.value = params.filterResonance;

                // Distortion (Simple waveshaper)
                const shaper = context.createWaveShaper();
                if (params.drive > 0) {
                    shaper.curve = makeDistortionCurve(params.drive * 100);
                } else {
                    shaper.curve = null; // Bypass
                }

                source.connect(filter);
                filter.connect(shaper);
                shaper.connect(gain);
                gain.connect(masterGainRef.current);

                source.start(time);
                // No auto-stop for one-shots usually, unless gated
            };

            const noteOnSampler = (params: SamplerBankParams, note: string, time?: number): number | null => {
                // Interactive trigger (e.g. keyboard)
                const now = time || context.currentTime;
                const buffer = loadedSampleBuffersRef.current.get(params.sampleName);
                if (!buffer || !masterGainRef.current) return null;

                const source = context.createBufferSource();
                source.buffer = buffer;
                source.playbackRate.value = params.playbackSpeed;

                const gain = context.createGain();
                gain.gain.value = params.volume;

                source.connect(gain);
                gain.connect(masterGainRef.current);
                source.start(now);

                const id = nextSamplerNoteId.current++;
                activeSamplerNotes.current.set(id, { source, envGain: gain });
                return id;
            };

            const noteOffSampler = (id: number) => {
                const note = activeSamplerNotes.current.get(id);
                if (note) {
                    const now = context.currentTime;
                    note.envGain.gain.cancelScheduledValues(now);
                    note.envGain.gain.linearRampToValueAtTime(0, now + 0.1);
                    note.source.stop(now + 0.1);
                    activeSamplerNotes.current.delete(id);
                }
            };

            const noteOnSynth = (params: SynthParams, note: string, time?: number) => {
                 // Interactive Synth trigger
                 if (params.waveform === '303-saw' || params.waveform === '303-sqr') {
                     if (open303EngineRef.current) {
                         apply303Params(open303EngineRef.current, params, params.waveform === '303-sqr' ? 'sqr' : 'saw');
                         const midi = noteToMidi(note);
                         open303EngineRef.current.noteOn(midi, 100);
                         const id = nextSynthNoteId.current++;
                         activeSynthNotes.current.set(id, { stop: () => open303EngineRef.current?.noteOff(midi) });
                         return id;
                     }
                 }
                 return null; // For now only 303 interactive
            };

            const noteOffSynth = (id: number) => {
                const entry = activeSynthNotes.current.get(id);
                if (entry) {
                    entry.stop();
                    activeSynthNotes.current.delete(id);
                }
            };

            const stopAllNotes = () => {
                activeSynthNotes.current.forEach(n => n.stop());
                activeSynthNotes.current.clear();

                activeSamplerNotes.current.forEach(n => {
                    try { n.source.stop(); } catch {}
                });
                activeSamplerNotes.current.clear();
            };

            // Helpers for Render/Ambiance
            const renderSynthPartToBuffer = (params: SynthParams, sequence: PartSequence, tempo: number): Promise<AudioBuffer> => {
                 // Placeholder for actual offline rendering logic
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

            const detectSamplePitch = async (b: AudioBuffer) => null;
            const processSinging = async (sampleName: string, note: string, steps: number, tempo: number) => null;
            const processSpoon = async (sampleName: string, note: string) => null;
            const setSustainMode = (mode: 'loop' | 'stretch' | 'wavetable') => {};
            const setSustainGrainSize = (size: number) => {};


            // Re-assign the refs and state
            audioEngineRef.current = {
                context,
                webGpuEngine: gpuEngineRef.current,
                wasmEngine: wasmEngineRef.current,
                open303Engine: open303EngineRef.current,
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
        } catch (e) {
            console.error("CRITICAL AUDIO INIT FAILURE", e);
            // Even if audio fails, set ready so UI doesn't lock up
            setIsReady(true);
        }
    }, []);

    const result = useMemo(() => ({
        audioEngine: audioEngineRef.current,
        isReady,
        initializeAudio
    }), [isReady, initializeAudio]);

    return result;
};
