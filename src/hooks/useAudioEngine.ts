import { type AlignmentResult } from '../engines/rubberband/PhonemeAligner';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type {
    SamplerBankParams, SynthParams, AudioEngine, KickParams, SnareParams, HatParams,
    DrumSound, PartSequence, MultisampleBank
} from '../types';
import { WebGpuOscillator } from '../engines/WebGpuOscillator';
import { WasmOscillator } from '../engines/WasmOscillator';
import { Open303Oscillator } from '../engines/Open303Oscillator';
import { SingingVoice } from '../engines/SingingVoice';
import { SingingVoiceManager } from '../engines/SingingVoiceManager';
import { VoiceManager } from '../engines/VoiceManager';
import { noteToMidi } from '../utils/musicTheory';
import { MultisampleGenerator } from '../engines/MultisampleGenerator';


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

    // Polyphonic TTS Manager
    const singingVoiceManagerRef = useRef<SingingVoiceManager | null>(null);

    // Left/Right Choir Panning
    const choirLeftGainRef = useRef<GainNode | null>(null);
    const choirRightGainRef = useRef<GainNode | null>(null);
    const choirLeftPannerRef = useRef<StereoPannerNode | null>(null);
    const choirRightPannerRef = useRef<StereoPannerNode | null>(null);

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
    
    // Multisample Generator
    const multisampleGeneratorRef = useRef<MultisampleGenerator | null>(null);
    const multisampleBanksRef = useRef<Map<string, MultisampleBank>>(new Map());


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

            // --- Singing Voice Manager Init (Polyphonic) ---
            try {
                // Fetch WASM once
                let wasmBinary: ArrayBuffer | undefined = undefined;
                try {
                    const response = await fetch(import.meta.env.BASE_URL + 'rubberband.wasm');
                    if (response.ok) wasmBinary = await response.arrayBuffer();
                } catch (e) {
                    console.warn('Failed to pre-fetch rubberband.wasm', e);
                }

                // Initialize Manager with 12 voices
                const manager = new SingingVoiceManager(context, 12, {
                    useHighQuality: false,
                    preserveFormants: true,
                    channels: 1,
                    bufferSize: 16384,
                    enablePhonemeStretching: true
                });

                await manager.init(forceScriptProcessor, wasmBinary);
                singingVoiceManagerRef.current = manager;

                // Create Choir Busses
                const gainLeft = context.createGain();
                gainLeft.gain.value = 0;
                choirLeftGainRef.current = gainLeft;
                const pannerLeft = context.createStereoPanner();
                pannerLeft.pan.value = -0.6;
                choirLeftPannerRef.current = pannerLeft;
                gainLeft.connect(pannerLeft);
                pannerLeft.connect(masterGainRef.current!);

                const gainRight = context.createGain();
                gainRight.gain.value = 0;
                choirRightGainRef.current = gainRight;
                const pannerRight = context.createStereoPanner();
                pannerRight.pan.value = 0.6;
                choirRightPannerRef.current = pannerRight;
                gainRight.connect(pannerRight);
                pannerRight.connect(masterGainRef.current!);

                // Connect all voices to main output by default
                // When choir mode is used, we'll reconnect specific voices
                manager.getAllVoices().forEach(voice => {
                    voice.connectOutput(masterGainRef.current!);
                });

                // Pre-cache if Pyodide ready
                if (pyodideRef.current) {
                    // ... (keep existing cache logic or simplify)
                }
            } catch (e) {
                console.warn('SingingVoiceManager failed to init:', e);
            }

            // Noise Buffer
            const bufferSize = context.sampleRate * 2;
            const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
            const output = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                output[i] = Math.random() * 2 - 1;
            }
            noiseBufferRef.current = buffer;

            // Initialize Multisample Generator
            multisampleGeneratorRef.current = new MultisampleGenerator(context);

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

            const loadSampleToEngine = async (
                name: string, 
                buffer: AudioBuffer,
                onProgress?: (progress: number) => void
            ): Promise<void> => {
                // 1. Immediately create a bank with base buffer for instant playback
                const sampleBank: MultisampleBank = {
                    baseBuffer: buffer,
                    pitchBank: new Map([[60, buffer]]), // Default C4
                    isProcessing: true,
                    processingProgress: 0,
                    rootNote: 60
                };
                
                // Store in both refs for compatibility
                loadedSampleBuffersRef.current.set(name, buffer);
                multisampleBanksRef.current.set(name, sampleBank);
                
                // 2. Start background multisample generation if generator is ready
                if (multisampleGeneratorRef.current && onProgress) {
                    onProgress(0.05); // Show immediate progress
                    
                    try {
                        const pitchBank = await multisampleGeneratorRef.current.generateMultisamples(
                            buffer,
                            {
                                rootNote: 60,
                                range: [-12, 12], // 2 octaves (C3 to C5)
                                preserveFormants: true,
                                quality: 'Standard'
                            },
                            (progress) => {
                                sampleBank.processingProgress = progress;
                                onProgress(0.05 + progress * 0.95); // Scale to 5%-100%
                            }
                        );
                        
                        // Update with complete pitch bank
                        sampleBank.pitchBank = pitchBank;
                        sampleBank.isProcessing = false;
                        sampleBank.processingProgress = 1.0;
                        
                        onProgress(1.0);
                        console.log(`Multisample generation complete for ${name}: ${pitchBank.size} pitches`);
                    } catch (err) {
                        console.error('Multisample generation failed:', err);
                        sampleBank.isProcessing = false;
                        sampleBank.error = err instanceof Error ? err.message : 'Unknown error';
                        onProgress(-1); // Error state
                    }
                } else if (onProgress) {
                    // Generator not ready, mark as complete with base only
                    onProgress(1.0);
                }
            };
            
            const getMultisampleBank = (bankIndex: number): MultisampleBank | null => {
                const bankName = `bank_${bankIndex}`;
                return multisampleBanksRef.current.get(bankName) || null;
            };
            
            const isMultisampleReady = (bankIndex: number): boolean => {
                const bank = getMultisampleBank(bankIndex);
                return bank ? !bank.isProcessing : false;
            };


            const prepareVocal = async (bankIndex: number, text: string) => {
                if (!singingVoiceManagerRef.current) return;
                const bankName = `bank_${bankIndex}`;
                const buffer = loadedSampleBuffersRef.current.get(bankName);
                if (!buffer) return;

                // Get ANY voice to perform alignment (since it's stateless w.r.t voice instance if using same aligner)
                // Actually, the SingingVoice instance holds the aligner.
                // We should use the first voice for alignment services.
                const alignmentVoice = singingVoiceManagerRef.current.getVoice(0);
                if (!alignmentVoice) return;

                const audio = buffer.getChannelData(0);
                try {
                    const alignment = await alignmentVoice.alignPhonemes(audio, text);
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

            const playSampler = (params: SamplerBankParams, note: string | string[], time: number, durationSteps: number = 1, stepTime: number = 0.2, noteParams?: { timbre?: number, microtiming?: number, reverse?: boolean, sliceIndex?: number, retrigger?: number }) => {
                // Check for multisample bank first
                const multisampleBank = multisampleBanksRef.current.get(params.sampleName);
                const legacyBuffer = loadedSampleBuffersRef.current.get(params.sampleName);
                const buffer = multisampleBank?.baseBuffer || legacyBuffer;
                
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
                            if (destination) {
                                voice.connectOutput(destination);
                            } else {
                                voice.connectOutput(masterGainRef.current!);
                            }

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
                            if (params.attack !== undefined) voice.setAttack(params.attack, triggerTime);
                            if (params.release !== undefined) voice.setRelease(params.release, triggerTime);

                            // Load buffer
                            voice.loadBuffer(buffer.getChannelData(0));

                            // CHECK FOR SLICE TRIGGER MODE
                            if (params.sliceMode === 'phoneme' && alignment) {
                                let sliceIndex = -1;
                                let pitchRatio = 1.0;

                                if (noteParams?.sliceIndex !== undefined) {
                                    // MELODIC MODE: Slice is explicit, Pitch is melodic
                                    sliceIndex = noteParams.sliceIndex;
                                    const targetMidi = noteToMidi(noteStr);
                                    const baseMidi = 60; // C4 assumption
                                    // Calculate ratio based on note difference + offset
                                    pitchRatio = Math.pow(2, (targetMidi - baseMidi + pitchOffset) / 12);
                                } else {
                                    // CLASSIC MODE: Pitch selects slice
                                    const targetMidi = noteToMidi(noteStr);
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

                            // 1. Calculate Time Ratio
                            const timeRatio = targetDuration / originalDuration;
                            voice.setTimeRatio(timeRatio, triggerTime);

                            // 2. Pitch Shift
                            const targetMidi = noteToMidi(noteStr);
                            voice.setPitchFromMidi(targetMidi + pitchOffset, 60, triggerTime);

                            // 3. Phoneme Awareness
                            if (alignment) {
                                voice.setAlignment(alignment);
                                voice.sendPhonemeDataToWorklet(targetDuration);
                            }

                            // 4. Play
                            voice.play(undefined, undefined, 1.0, noteParams?.reverse);

                            // 5. Schedule Release
                            const releaseTime = triggerTime + targetDuration;

                            // Convert standard browser timer to context time if possible?
                            // Since setTimeout is less precise, we just schedule it here.
                            // Realtime audio apps often prefer AudioContext scheduling, but noteOff needs a JS call right now.
                            // To be accurate, we'll use a timeout but compensate.
                            const delayMs = (releaseTime - context.currentTime) * 1000;
                            if (delayMs > 0) {
                                setTimeout(() => {
                                    voice.noteOff();
                                }, delayMs);
                            } else {
                                voice.noteOff();
                            }
                        };

                        // Execution Wrapper
                        const runVoices = (timeOffset: number, duration: number) => {
                             const t = actualTime + timeOffset;

                             // 1. Acquire Main Voice
                             const mainVoiceData = manager.acquireVoice();
                             manager.registerActiveVoice(mainVoiceData.index, noteStr, t);
                             triggerVoice(mainVoiceData.voice, 0, t, duration);

                             // 2. Choir Voices (Left/Right)
                             if (params.choir && params.choir > 0) {
                                const detune = 0.15; // ~15 cents
                                const gain = params.choir * 0.7;

                                if (choirLeftGainRef.current) choirLeftGainRef.current.gain.setTargetAtTime(gain, t, 0.02);
                                if (choirRightGainRef.current) choirRightGainRef.current.gain.setTargetAtTime(gain, t, 0.02);

                                // Acquire voice for LEFT
                                const leftVoiceData = manager.acquireVoice();
                                // Skip if we ran out of voices (simple check, acquireVoice always returns something currently)
                                if (leftVoiceData.index !== mainVoiceData.index) {
                                    manager.registerActiveVoice(leftVoiceData.index, `${noteStr}_L`, t);
                                    triggerVoice(leftVoiceData.voice, detune, t, duration, choirLeftGainRef.current!);
                                }

                                // Acquire voice for RIGHT
                                const rightVoiceData = manager.acquireVoice();
                                if (rightVoiceData.index !== mainVoiceData.index && rightVoiceData.index !== leftVoiceData.index) {
                                    manager.registerActiveVoice(rightVoiceData.index, `${noteStr}_R`, t);
                                    triggerVoice(rightVoiceData.voice, -detune, t, duration, choirRightGainRef.current!);
                                }
                            } else {
                                // Ensure silenced
                                if (choirLeftGainRef.current) choirLeftGainRef.current.gain.setTargetAtTime(0, t, 0.02);
                                if (choirRightGainRef.current) choirRightGainRef.current.gain.setTargetAtTime(0, t, 0.02);
                            }
                        };

                        if (shouldGlitch) {
                            // Glitch Implementation
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
                            // Normal or Retrigger
                            for (let r = 0; r < retrigger; r++) {
                                const offset = r * (subDurationSteps * stepTime);
                                runVoices(offset, subDurationSteps * stepTime);
                            }
                        }

                    }); // End notes.forEach

                    return;
                }

                // Standard Loop / One-shot (Sampler Mode) with Multisample Support
                const playBufferSource = (startTime: number, duration: number, pitchSemitones: number) => {
                    const source = context.createBufferSource();
                    
                    // Check if we have a pre-rendered multisample for this pitch
                    const targetMidi = pitchSemitones;
                    let playbackBuffer: AudioBuffer;
                    let pitchRatio = 1.0;
                    
                    if (multisampleBank?.pitchBank.has(targetMidi)) {
                        // Use pre-rendered high-quality multisample
                        playbackBuffer = multisampleBank.pitchBank.get(targetMidi)!;
                        // playbackSpeed knob only affects speed now (can be used for effect)
                        pitchRatio = params.playbackSpeed;
                    } else {
                        // Fallback: use base buffer with calculated pitch ratio
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

                // Loop mode Polyphony
                notes.forEach(noteStr => {
                    const midi = noteToMidi(noteStr);

                    if (shouldGlitch) {
                         const numStutters = Math.floor(Math.random() * 3) + 2;
                         const stutterLen = 0.06;

                         for (let i = 0; i < numStutters; i++) {
                             playBufferSource(actualTime + i * stutterLen, stutterLen, midi);
                         }
                         // Trigger full note after stutters
                         playBufferSource(actualTime + numStutters * stutterLen, 0, midi);
                    } else {
                         // Normal or Retrigger Playback
                         for (let r = 0; r < retrigger; r++) {
                            const offset = r * (subDurationSteps * stepTime);
                            playBufferSource(actualTime + offset, subDurationSteps * stepTime, midi);
                         }
                    }
                });
            };

            const noteOnSampler = (params: SamplerBankParams, note: string, time?: number): number | null => {
                // Interactive trigger (e.g. keyboard) with multisample support
                const now = time || context.currentTime;
                
                // Check for multisample bank first
                const multisampleBank = multisampleBanksRef.current.get(params.sampleName);
                const legacyBuffer = loadedSampleBuffersRef.current.get(params.sampleName);
                const buffer = multisampleBank?.baseBuffer || legacyBuffer;
                
                if (!buffer || !masterGainRef.current) return null;

                const targetMidi = noteToMidi(note);
                const source = context.createBufferSource();
                
                // Check if we have a pre-rendered multisample for this pitch
                let playbackBuffer: AudioBuffer;
                let pitchRatio: number;
                
                if (multisampleBank?.pitchBank.has(targetMidi)) {
                    // Use pre-rendered high-quality multisample
                    playbackBuffer = multisampleBank.pitchBank.get(targetMidi)!;
                    // playbackSpeed knob only affects speed (can be used for effect)
                    pitchRatio = params.playbackSpeed;
                } else {
                    // Fallback: use base buffer with calculated pitch ratio
                    playbackBuffer = multisampleBank?.baseBuffer || buffer;
                    const rootMidi = multisampleBank?.rootNote ?? 60;
                    pitchRatio = params.playbackSpeed * Math.pow(2, (targetMidi - rootMidi) / 12);
                }
                
                source.buffer = playbackBuffer;
                source.playbackRate.value = pitchRatio;

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
                singingVoiceManagerRef.current?.stopAll();
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
                singingVoice: undefined, // Exposed via manager if needed, but playSampler handles it
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
                setSustainGrainSize,
                getMultisampleBank,
                isMultisampleReady
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
        // Broadcast to all voices in manager
        if (singingVoiceManagerRef.current) {
            singingVoiceManagerRef.current.getAllVoices().forEach(voice => {
                switch (key) {
                    case 'timeRatio': voice.setTimeRatio(value); break;
                    case 'pitchScale': voice.setPitch(value); break;
                    case 'formantShift': voice.setFormantShift(value); break;
                    case 'vibratoDepth': voice.setVibratoDepth(value); break;
                    case 'breathIntensity': voice.setBreathIntensity(value); break;
                    case 'attack': voice.setAttack(value); break;
                    case 'release': voice.setRelease(value); break;
                }
            });
        }

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
