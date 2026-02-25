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
import { VoiceManager } from '../engines/VoiceManager';
import { noteToMidi } from '../utils/musicTheory';


// URLs for worklets
import sustainProcessorUrl from '../audio-worklets/sustain-processor.ts?worker&url';
import open303ProcessorUrl from '../audio-worklets/open303-processor.ts?worker&url';

// Helper for distortion
const distortionCurveCache = new Map<number, Float32Array<ArrayBuffer>>();
function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
    const k_raw = typeof amount === 'number' ? amount : 50;
    const k = Math.round(k_raw * 10) / 10;
    if (distortionCurveCache.has(k)) return distortionCurveCache.get(k)!;
    const n_samples = 8192, curve = new Float32Array(n_samples), deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
        const x = (i * 2) / n_samples - 1;
        curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    distortionCurveCache.set(k, curve);
    return curve;
}


// Map UI params to Engine params
function apply303Params(engine: Open303Oscillator, params: SynthParams, waveType: string): void {
    engine.setWaveform(waveType === 'sqr' ? 1.0 : 0.0);
    // UI Cutoff (0-20000) -> Engine (0-1)
    engine.setCutoff(Math.max(0, Math.min(1, params.filterCutoff / 8000)));
    // UI Res (0-20) -> Engine (0-1)
    engine.setResonance(Math.max(0, Math.min(1, params.filterResonance / 20)));
    engine.setFilterMode(Math.max(0, Math.min(1, params.filterMode ?? 0)));
    engine.setDecay(params.decay);
    engine.setVolume(params.volume);
}

export const useAudioEngine = (pyodide: any, forceScriptProcessor: boolean = false) => {
    const [isReady, setIsReady] = useState(false);
    const [audioEngine, setAudioEngine] = useState<AudioEngine | null>(null);
    const isInitializing = useRef(false);
    const singingVoiceRef = useRef<SingingVoice | null>(null);
    const singingVoiceLeftRef = useRef<SingingVoice | null>(null);
    const singingVoiceRightRef = useRef<SingingVoice | null>(null);
    const choirLeftGainRef = useRef<GainNode | null>(null);
    const choirRightGainRef = useRef<GainNode | null>(null);
    const sustainNodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
    const noiseBufferRef = useRef<AudioBuffer | null>(null);
    const ambianceSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
    const ambianceGainNodeRef = useRef<GainNode | null>(null);
    const loadedAmbianceBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
    const gpuEngineRef = useRef<WebGpuOscillator | null>(null);
    const wasmEngineRef = useRef<WasmOscillator | null>(null);
    const open303EngineRef = useRef<Open303Oscillator | null>(null);

    // Voice Managers
    const voiceManagerARef = useRef<VoiceManager | null>(null);
    const voiceManagerBRef = useRef<VoiceManager | null>(null);

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

    const loadedSampleBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
    const vocalAlignmentsRef = useRef<Map<string, AlignmentResult>>(new Map());


    useEffect(() => {
        pyodideRef.current = pyodide;
    }, [pyodide]);

    const initializeAudio = useCallback(async () => {
        if (audioEngine || isInitializing.current) return;
        isInitializing.current = true;

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
            // TEMP FIX: Disable Open303 to prevent stack overflow from killing AudioContext
            // TODO: Re-enable after fixing stack overflow in jc303 WASM build
            const open303Engine = new Open303Oscillator();
            let open303Ready = false;
            
            // Wrap in try/catch to prevent AudioContext death on failure
            try {
                // Use single-threaded WASM for best compatibility
                // Threaded variant requires COOP/COEP headers which may not be available
                open303Ready = await open303Engine.init(context, open303ProcessorUrl, {
                    preferWorklet: true,
                    preferThreaded: false,
                    forceSingleThreaded: true
                });
                
                if (open303Ready) {
                    // Connect to master gain (local variable)
                    open303Engine.connect(masterGain);
                    open303EngineRef.current = open303Engine;
                    console.log('Open303 Engine Ready');
                } else {
                    console.warn('Open303 Engine failed to initialize - bass will use fallback');
                }
            } catch (e) {
                console.error('Open303 Engine crashed during init:', e);
                console.warn('Bass will use fallback synthesis (no TB-303)');
                open303Ready = false;
            }
            
            // If Open303 failed, ensure we have a flag for fallback
            if (!open303Ready) {
                // Bass will fall back to standard synth in playSynth
                console.log('Open303 bypassed - using fallback bass synthesis');
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

            // Initialize Voice Managers
            // Synth A: Polyphonic (8 voices)
            voiceManagerARef.current = new VoiceManager(context, masterGainRef.current!, 8, false, sawBuf || undefined, sqrBuf || undefined);

            // Synth B: Monophonic (1 voice, legato)
            voiceManagerBRef.current = new VoiceManager(context, masterGainRef.current!, 1, true, sawBuf || undefined, sqrBuf || undefined);


            // Initialize AudioWorklets
            if (!forceScriptProcessor) {
                try {
                    await context.audioWorklet.addModule(sustainProcessorUrl);
                    const sustainNode = new AudioWorkletNode(context, 'sustain-processor', {
                        numberOfInputs: 0,
                        numberOfOutputs: 1,
                        outputChannelCount: [2]
                    });
                    sustainNode.connect(masterGainRef.current!);
                    sustainNodeRef.current = sustainNode;
                    console.log('SustainProcessor AudioWorklet initialized');
                } catch (e) {
                    console.warn('Sustain worklet not available:', e);
                }
            } else {
                // Fallback to ScriptProcessorNode for sustain processor
                console.log('SustainProcessor: Using ScriptProcessorNode fallback');
                const sustainNode = context.createScriptProcessor(4096, 0, 2);
                sustainNode.onaudioprocess = (e) => {
                    // Basic pass-through - limited functionality
                    const left = e.outputBuffer.getChannelData(0);
                    const right = e.outputBuffer.getChannelData(1);
                    left.fill(0);
                    right.fill(0);
                };
                sustainNode.connect(masterGainRef.current!);
                sustainNodeRef.current = sustainNode;
            }

            // --- Singing Voice Init (Fail-safe with Choir Support) ---
            try {
                // Fetch WASM once
                let wasmBinary: ArrayBuffer | undefined = undefined;
                try {
                    const response = await fetch(import.meta.env.BASE_URL + 'rubberband.wasm');
                    if (response.ok) wasmBinary = await response.arrayBuffer();
                } catch (e) {
                    console.warn('Failed to pre-fetch rubberband.wasm', e);
                }

                // 1. Center Voice (Main)
                singingVoiceRef.current = new SingingVoice(context, {
                    useHighQuality: false, preserveFormants: true, channels: 1, bufferSize: 16384, enablePhonemeStretching: true
                });
                await singingVoiceRef.current.initWorklet(forceScriptProcessor, wasmBinary);
                singingVoiceRef.current.getSourceNode().connect(masterGainRef.current!);

                // 2. Left Voice (Choir)
                singingVoiceLeftRef.current = new SingingVoice(context, {
                    useHighQuality: false, preserveFormants: true, channels: 1, bufferSize: 16384, enablePhonemeStretching: true
                });
                await singingVoiceLeftRef.current.initWorklet(forceScriptProcessor, wasmBinary);
                const gainLeft = context.createGain();
                gainLeft.gain.value = 0; // Start silent
                choirLeftGainRef.current = gainLeft;
                const pannerLeft = context.createStereoPanner();
                pannerLeft.pan.value = -0.6;
                singingVoiceLeftRef.current.getSourceNode().connect(gainLeft);
                gainLeft.connect(pannerLeft);
                pannerLeft.connect(masterGainRef.current!);

                // 3. Right Voice (Choir)
                singingVoiceRightRef.current = new SingingVoice(context, {
                    useHighQuality: false, preserveFormants: true, channels: 1, bufferSize: 16384, enablePhonemeStretching: true
                });
                await singingVoiceRightRef.current.initWorklet(forceScriptProcessor, wasmBinary);
                const gainRight = context.createGain();
                gainRight.gain.value = 0; // Start silent
                choirRightGainRef.current = gainRight;
                const pannerRight = context.createStereoPanner();
                pannerRight.pan.value = 0.6;
                singingVoiceRightRef.current.getSourceNode().connect(gainRight);
                gainRight.connect(pannerRight);
                pannerRight.connect(masterGainRef.current!);

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

            const playSynth = (params: SynthParams, note: string | string[], time: number, durationSteps: number = 1, stepTime: number = 0.2, slideFromFreq?: number, track?: 'partA' | 'partB', noteParams?: { timbre?: number, microtiming?: number, retrigger?: number }) => {
                 if (!masterGainRef.current) return;

                 // Apply Microtiming
                 const actualTime = time + (noteParams?.microtiming ? noteParams.microtiming * stepTime : 0);

                 // Apply Timbre Modulation (Filter Cutoff)
                 let effectiveParams = params;
                 if (noteParams?.timbre !== undefined) {
                     effectiveParams = { ...params };
                     // Modulate cutoff: 0.5 is neutral. 0 = -50%, 1 = +50%
                     // Or just scale: cutoff * (0.5 + timbre)
                     const mod = 0.5 + noteParams.timbre; // 0.5 to 1.5
                     effectiveParams.filterCutoff = Math.min(20000, params.filterCutoff * mod);
                 }

                 // Retrigger Logic
                 const retrigger = Math.max(1, Math.floor(noteParams?.retrigger || 1));
                 const subDurationSteps = durationSteps / retrigger;
                 const subDuration = subDurationSteps * stepTime;

                 // Execution Loop
                 for (let i = 0; i < retrigger; i++) {
                     const noteTime = actualTime + (i * subDuration);

                     // Open303 Routing (Specific check for 303 waveforms)
                     if (params.waveform === '303-saw' || params.waveform === '303-sqr') {
                         if (open303EngineRef.current) {
                             apply303Params(open303EngineRef.current, effectiveParams, params.waveform === '303-sqr' ? 'sqr' : 'saw');

                             // Note: 303 Engine is monophonic by nature in this implementation or handles its own logic.
                             // But noteToMidi expects string. If chord (array), pick first note?
                             const noteStr = Array.isArray(note) ? note[0] : note;
                             if (!noteStr) continue;

                             const midi = noteToMidi(noteStr);

                             const now = context.currentTime;
                             const startDelay = Math.max(0, noteTime - now);
                             const noteDuration = subDuration;

                             setTimeout(() => {
                                 open303EngineRef.current?.noteOn(midi, 100);
                             }, startDelay * 1000);

                             setTimeout(() => {
                                 if (slideFromFreq === undefined) { // Check if slide is active (heuristic)
                                     open303EngineRef.current?.noteOff(midi);
                                 }
                             }, (startDelay + noteDuration) * 1000);

                             continue;
                         }
                     }

                     // Standard Synth Logic via VoiceManager
                     const noteDuration = subDuration;
                     const effectiveSlide = (i === 0) ? slideFromFreq : undefined;

                     if (track === 'partB' && voiceManagerBRef.current) {
                         voiceManagerBRef.current.playNote(effectiveParams, note, noteTime, noteDuration, effectiveSlide);
                     } else if (voiceManagerARef.current) {
                         // Default to Synth A (Poly)
                         voiceManagerARef.current.playNote(effectiveParams, note, noteTime, noteDuration, effectiveSlide);
                     }
                 }
            };

            const playDrum = (sound: DrumSound, params: KickParams | SnareParams | HatParams, time: number, noteParams?: { retrigger?: number }, stepTime: number = 0.125) => {
                 if (!masterGainRef.current) return;

                 const retrigger = Math.max(1, Math.floor(noteParams?.retrigger || 1));
                 const subStep = stepTime / retrigger;

                 for (let i = 0; i < retrigger; i++) {
                     const now = time + (i * subStep);

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
                 }
            };

            const loadSampleToEngine = (name: string, buffer: AudioBuffer) => {
                loadedSampleBuffersRef.current.set(name, buffer);
            };


            const prepareVocal = async (bankIndex: number, text: string) => {
                if (!singingVoiceRef.current) return;
                const bankName = `bank_${bankIndex}`;
                const buffer = loadedSampleBuffersRef.current.get(bankName);
                if (!buffer) return;

                const audio = buffer.getChannelData(0);
                try {
                    const alignment = await singingVoiceRef.current.alignPhonemes(audio, text);
                    if (alignment) {
                        vocalAlignmentsRef.current.set(bankName, alignment);
                        console.log(`Aligned phonemes for ${bankName}: ${alignment.phonemes.length}`);
                    }
                } catch (e) {
                    console.warn('Phoneme alignment failed:', e);
                }
            };

            const getAlignment = (bankIndex: number) => {
                const bankName = `bank_${bankIndex}`;
                return vocalAlignmentsRef.current.get(bankName) || null;
            };

            const playSampler = (params: SamplerBankParams, note: string, time: number, durationSteps: number = 1, stepTime: number = 0.2, noteParams?: { timbre?: number, microtiming?: number, reverse?: boolean, sliceIndex?: number, retrigger?: number }) => {
                const buffer = loadedSampleBuffersRef.current.get(params.sampleName);
                if (!buffer || !masterGainRef.current) return;

                // Apply Microtiming
                const actualTime = time + (noteParams?.microtiming ? noteParams.microtiming * stepTime : 0);

                // Retrigger Logic
                const retrigger = Math.max(1, Math.floor(noteParams?.retrigger || 1));
                const subDurationSteps = durationSteps / retrigger;

                // --- GLITCH LOGIC START ---
                // Only glitch if NOT retriggering (priority to explicit retrigger)
                const shouldGlitch = retrigger === 1 && (params.glitchChance || 0) > 0 && Math.random() < (params.glitchChance || 0);
                // --- GLITCH LOGIC END ---

                if (params.mode === 'stretch' && singingVoiceRef.current) {
                    // PHONEME ELASTICITY & SINGING VOICE MODE WITH CHOIR SUPPORT
                    const mainVoice = singingVoiceRef.current;

                    const triggerVoice = (voice: SingingVoice, pitchOffset: number, overrideTime?: number, overrideDuration?: number) => {
                        const targetDuration = overrideDuration !== undefined ? overrideDuration : (durationSteps * stepTime);
                        const originalDuration = buffer.duration;
                        const triggerTime = overrideTime !== undefined ? overrideTime : actualTime;

                        // Apply Timbre Modulation (Formant Shift)
                        if (noteParams?.timbre !== undefined) {
                            const baseShift = params.formantShift || 0;
                            const mod = (noteParams.timbre * 12) - 6; // +/- 6 semitones
                            voice.setFormantShift(baseShift + mod, triggerTime);
                        } else if (params.formantShift !== undefined) {
                            voice.setFormantShift(params.formantShift, triggerTime);
                        }

                        // Sync other params
                        if (params.vibratoDepth !== undefined) voice.setVibratoDepth(params.vibratoDepth, triggerTime);
                        if (params.breathIntensity !== undefined) voice.setBreathIntensity(params.breathIntensity, triggerTime);

                        // CHECK FOR SLICE TRIGGER MODE
                        if (params.sliceMode === 'phoneme') {
                            const alignment = vocalAlignmentsRef.current.get(params.sampleName);
                            if (alignment) {
                                let sliceIndex = -1;
                                let pitchRatio = 1.0;

                                if (noteParams?.sliceIndex !== undefined) {
                                    // MELODIC MODE: Slice is explicit, Pitch is melodic
                                    sliceIndex = noteParams.sliceIndex;
                                    const targetMidi = noteToMidi(note);
                                    const baseMidi = 60; // C4 assumption
                                    // Calculate ratio based on note difference + offset
                                    pitchRatio = Math.pow(2, (targetMidi - baseMidi + pitchOffset) / 12);
                                } else {
                                    // CLASSIC MODE: Pitch selects slice
                                    const targetMidi = noteToMidi(note);
                                    // Map MIDI C3 (60) to slice 0
                                    sliceIndex = targetMidi - 60;
                                    // Pitch is just detune
                                    pitchRatio = Math.pow(2, pitchOffset / 12);
                                }

                                if (sliceIndex >= 0) {
                                    voice.triggerSlice(buffer.getChannelData(0), sliceIndex, alignment, pitchRatio);
                                    return;
                                }
                            }
                        }

                        // 1. Calculate Time Ratio
                        const timeRatio = targetDuration / originalDuration;
                        voice.setTimeRatio(timeRatio, triggerTime);

                        // 2. Pitch Shift
                        // Assuming base note C4 (60) for the sample
                        const targetMidi = noteToMidi(note);
                        // Apply pitch offset (detune)
                        voice.setPitchFromMidi(targetMidi + pitchOffset, 60, triggerTime);

                        // 3. Phoneme Awareness
                        const alignment = vocalAlignmentsRef.current.get(params.sampleName);

                        if (alignment) {
                            // Explicitly set the alignment for this voice operation
                            voice.setAlignment(alignment);
                            voice.sendPhonemeDataToWorklet(targetDuration);
                        }

                        // 4. Play (Buffer assumed loaded)
                        voice.play(undefined, undefined, 1.0, noteParams?.reverse);
                    };

                    // Load buffer ONCE for the voice(s)
                    const audioData = buffer.getChannelData(0);
                    mainVoice.loadBuffer(audioData);
                    if (params.choir && params.choir > 0) {
                        singingVoiceLeftRef.current?.loadBuffer(audioData);
                        singingVoiceRightRef.current?.loadBuffer(audioData);
                    }

                    // Execution Wrapper
                    const runVoices = (timeOffset: number, duration: number) => {
                         const t = actualTime + timeOffset;
                         triggerVoice(mainVoice, 0, t, duration);

                         if (params.choir && params.choir > 0 && singingVoiceLeftRef.current && singingVoiceRightRef.current) {
                            const detune = 0.15; // ~15 cents
                            const gain = params.choir * 0.7;

                            if (choirLeftGainRef.current) choirLeftGainRef.current.gain.setTargetAtTime(gain, t, 0.02);
                            if (choirRightGainRef.current) choirRightGainRef.current.gain.setTargetAtTime(gain, t, 0.02);

                            triggerVoice(singingVoiceLeftRef.current, detune, t, duration);
                            triggerVoice(singingVoiceRightRef.current, -detune, t, duration);
                        } else {
                            // Ensure silenced
                            if (choirLeftGainRef.current) choirLeftGainRef.current.gain.setTargetAtTime(0, t, 0.02);
                            if (choirRightGainRef.current) choirRightGainRef.current.gain.setTargetAtTime(0, t, 0.02);
                        }
                    };

                    if (shouldGlitch) {
                        // Glitch Implementation: Rapid Retrigger
                        const numStutters = Math.floor(Math.random() * 3) + 2; // 2 to 4
                        const totalDur = durationSteps * stepTime;
                        const stutterLen = Math.min(0.06, totalDur / numStutters); // Max 60ms

                        for (let i = 0; i < numStutters; i++) {
                            runVoices(i * stutterLen, stutterLen);
                        }
                        // Resume rest of note
                        const played = numStutters * stutterLen;
                        if (totalDur > played) {
                             runVoices(played, totalDur - played);
                        }
                    } else {
                        // Normal or Retrigger Playback
                        for (let r = 0; r < retrigger; r++) {
                            const offset = r * (subDurationSteps * stepTime);
                            runVoices(offset, subDurationSteps * stepTime);
                        }
                    }
                    return;
                }

                // Standard Loop / One-shot
                const playBufferSource = (startTime: number, duration: number) => {
                    const source = context.createBufferSource();
                    source.buffer = buffer;
                    source.playbackRate.value = params.playbackSpeed;

                    const gain = context.createGain();
                    gain.gain.value = params.volume;

                    const filter = context.createBiquadFilter();
                    filter.type = 'lowpass';
                    filter.frequency.value = params.filterCutoff;
                    filter.Q.value = params.filterResonance;

                    // Distortion
                    const shaper = context.createWaveShaper();
                    if (params.drive > 0) {
                        shaper.curve = makeDistortionCurve(params.drive * 100);
                    } else {
                        shaper.curve = null; // Bypass
                    }

                    source.connect(filter);
                    filter.connect(shaper);
                    shaper.connect(gain);
                    gain.connect(masterGainRef.current!);

                    source.start(startTime);
                    // Gate if stuttering (duration provided)
                    if (duration > 0) {
                         source.stop(startTime + duration);
                    }
                };

                if (shouldGlitch) {
                     const numStutters = Math.floor(Math.random() * 3) + 2;
                     const stutterLen = 0.06;

                     for (let i = 0; i < numStutters; i++) {
                         playBufferSource(actualTime + i * stutterLen, stutterLen);
                     }
                     // Trigger full note after stutters
                     playBufferSource(actualTime + numStutters * stutterLen, 0);
                } else {
                     // Normal or Retrigger Playback
                     for (let r = 0; r < retrigger; r++) {
                        const offset = r * (subDurationSteps * stepTime);
                        // For buffer source, we might want to shorten playback if it overlaps?
                        // playBufferSource takes (startTime, duration). 0 means play full.
                        // If retriggering, we probably want to gate it?
                        // Let's pass subDuration in seconds.
                        playBufferSource(actualTime + offset, subDurationSteps * stepTime);
                     }
                }
            };

            const noteOnSampler = (params: SamplerBankParams, _note: string, time?: number): number | null => {
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

            const noteOnSynth = (params: SynthParams, note: string, time?: number, track?: 'partA' | 'partB') => {
                 const now = time || context.currentTime;

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

                 // Standard Synth Logic via VoiceManager
                 let manager = voiceManagerARef.current;
                 if (track === 'partB') manager = voiceManagerBRef.current;

                 if (manager) {
                     manager.noteOn(params, note, now);
                     const id = nextSynthNoteId.current++;
                     // Capture params for release (not perfect if params change, but acceptable)
                     activeSynthNotes.current.set(id, {
                         stop: () => manager?.noteOff(note, context.currentTime, params)
                     });
                     return id;
                 }

                 return null;
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

                voiceManagerARef.current?.stopAll();
                voiceManagerBRef.current?.stopAll();
            };

            // Helpers for Render/Ambiance
            const renderSynthPartToBuffer = (_params: SynthParams, _sequence: PartSequence, _tempo: number): Promise<AudioBuffer> => {
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
                prepareVocal,
                getAlignment,
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
    }, [audioEngine, forceScriptProcessor]);



    // Function to update voice parameters in real-time
    const updateVoiceParams = useCallback((_bankIdx: number, key: keyof SamplerBankParams, value: number) => {
        const updateVoice = (voice: SingingVoice) => {
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
        };

        if (singingVoiceRef.current) updateVoice(singingVoiceRef.current);
        if (singingVoiceLeftRef.current) updateVoice(singingVoiceLeftRef.current);
        if (singingVoiceRightRef.current) updateVoice(singingVoiceRightRef.current);

        if (key === 'choir') {
             const gain = value * 0.7;
             const context = audioEngine?.context;
             const now = context ? context.currentTime : 0;
             if (choirLeftGainRef.current) choirLeftGainRef.current.gain.setTargetAtTime(gain, now, 0.05);
             if (choirRightGainRef.current) choirRightGainRef.current.gain.setTargetAtTime(gain, now, 0.05);
        }
    }, [audioEngine]);

    return useMemo(() => ({
        audioEngine,
        isReady,
        initializeAudio,
        onParamChange: updateVoiceParams
    }), [audioEngine, isReady, initializeAudio, updateVoiceParams]);
};
