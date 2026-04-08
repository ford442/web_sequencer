import { type AlignmentResult } from '../engines/rubberband/PhonemeAligner';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type {
    SamplerBankParams, SynthParams, AudioEngine, PartSequence, MultisampleBank, PhonemeData
} from '../types';
import { WebGpuOscillator } from '../engines/WebGpuOscillator';
import { WasmOscillator } from '../engines/WasmOscillator';
import { Open303Manager } from '../engines/Open303Manager';
import { SingingVoice } from '../engines/SingingVoice';
import { SingingVoiceManager } from '../engines/SingingVoiceManager';
import { VoiceManager } from '../engines/VoiceManager';
import { noteToMidi } from '../utils/musicTheory';
import { MultisampleGenerator } from '../engines/MultisampleGenerator';
import { Harmonizer, type HarmonizerConfig } from '../engines/Harmonizer';
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
    initializeSustainProcessor,
    loadWavBuffer,
} from './audioEngine/initialization';

// URLs for worklets
import sustainProcessorUrl from '../audio-worklets/sustain-processor.ts?worker&url';
import open303ProcessorUrl from '../audio-worklets/open303-processor.ts?worker&url';

type AudioWindow = Window & typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
    audioContext?: AudioContext;
};

export const useAudioEngine = (pyodide: unknown) => {
    const [isReady, setIsReady] = useState(false);
    const [audioEngine, setAudioEngine] = useState<AudioEngine | null>(null);
    const isInitializing = useRef(false);

    // Polyphonic TTS Manager
    const singingVoiceManagerRef = useRef<SingingVoiceManager | null>(null);
    
    // Harmonizer for layered vocals
    const harmonizerRef = useRef<Harmonizer | null>(null);

    // Left/Right Choir Panning
    const choirLeftGainRef = useRef<GainNode | null>(null);
    const choirRightGainRef = useRef<GainNode | null>(null);
    const choirLeftPannerRef = useRef<StereoPannerNode | null>(null);
    const choirRightPannerRef = useRef<StereoPannerNode | null>(null);

    const sustainNodeRef = useRef<AudioWorkletNode | null>(null);
    const noiseBufferRef = useRef<AudioBuffer | null>(null);
    const ambianceSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
    const ambianceGainNodeRef = useRef<GainNode | null>(null);
    const loadedAmbianceBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
    const gpuEngineRef = useRef<WebGpuOscillator | null>(null);
    const wasmEngineRef = useRef<WasmOscillator | null>(null);
    const open303ManagerRef = useRef<Open303Manager | null>(null);

    // Voice Managers
    const voiceManagerARef = useRef<VoiceManager | null>(null);
    const voiceManagerBRef = useRef<VoiceManager | null>(null);

    // Native WAV buffers
    const wavSawBufferRef = useRef<AudioBuffer | null>(null);
    const wavSqrBufferRef = useRef<AudioBuffer | null>(null);

    // Master Volume & Pan
    const masterGainRef = useRef<GainNode | null>(null);
    const masterSaturationRef = useRef<WaveShaperNode | null>(null);
    const reverbNodeRef = useRef<ConvolverNode | null>(null);
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

    const playbackRefs = useMemo<PlaybackRefs>(() => ({
        masterGainRef,
        masterSaturationRef,
        reverbNodeRef,
        masterPannerRef,
        noiseBufferRef,
        open303ManagerRef,
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
    }), []);

    useEffect(() => {
        pyodideRef.current = pyodide;
    }, [pyodide]);

    const initializeAudio = useCallback(async () => {
        if (audioEngine || isInitializing.current) return;
        isInitializing.current = true;

        try {
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

            const masterGain = initializeMasterOutput(context, masterGainRef, masterPannerRef, masterSaturationRef);

            // Initialize Engines
            const gpuEngine = new WebGpuOscillator();
            await gpuEngine.init().catch(e => console.warn("GPU Engine init failed", e));
            gpuEngineRef.current = gpuEngine;

            const wasmEngine = new WasmOscillator();
            await wasmEngine.init().catch(e => console.warn("WASM Engine init failed", e));
            wasmEngineRef.current = wasmEngine;

            // Initialize Open303 Manager
            const open303Manager = new Open303Manager();
            let open303Ready = false;
            
            try {
                open303Ready = await open303Manager.init(context, open303ProcessorUrl, {
                    preferWorklet: true,
                    preferThreaded: false,
                    forceSingleThreaded: true
                });
                
                if (open303Ready) {
                    open303Manager.connect(masterGain);
                    open303ManagerRef.current = open303Manager;
                    console.log('[useAudioEngine] Open303Manager Ready');
                } else {
                    console.warn('[useAudioEngine] Open303Manager failed to initialize');
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
            wavSawBufferRef.current = sawBuf;
            wavSqrBufferRef.current = sqrBuf;

            // Initialize Voice Managers
            voiceManagerARef.current = new VoiceManager(context, masterGainRef.current!, 8, false, sawBuf || undefined, sqrBuf || undefined);
            voiceManagerBRef.current = new VoiceManager(context, masterGainRef.current!, 1, true, sawBuf || undefined, sqrBuf || undefined);

            await initializeSustainProcessor(context, sustainProcessorUrl, sustainNodeRef, masterGainRef);

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
                singingVoiceManagerRef.current = manager;

                initializeChoirBuses(
                    context,
                    masterGainRef,
                    choirLeftGainRef,
                    choirRightGainRef,
                    choirLeftPannerRef,
                    choirRightPannerRef,
                );

                manager.getAllVoices().forEach(voice => {
                    voice.connectOutput(masterGainRef.current!);
                });

                if (pyodideRef.current) {
                    // Pre-cache logic
                }
            } catch (e) {
                console.warn('SingingVoiceManager failed to init:', e);
            }

            initializeHarmonizer(harmonizerRef);
            noiseBufferRef.current = createNoiseBuffer(context);
            multisampleGeneratorRef.current = new MultisampleGenerator(context);

            // --- Playback Functions Extraction ---
            const playSynth = createPlaySynth(context, playbackRefs);
            const playDrum = createPlayDrum(context, playbackRefs);
            const {
                loadSampleToEngine,
                getMultisampleBank,
                isMultisampleReady,
                prepareVocal,
                getAlignment,
            } = createSampleLibraryControls({
                loadedSampleBuffersRef,
                multisampleBanksRef,
                multisampleGeneratorRef,
                vocalAlignmentsRef,
                singingVoiceManagerRef,
            });            // Internal function to play a single sampler voice (supports pitch offset for harmonizer)
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
                    slideType?: 'linear' | 'exponential',
                    phonemes?: PhonemeData[],
                    freeze?: number,
                    filterCutoff?: number,
                    filterResonance?: number,
                    formantLfoRate?: number,
                    formantLfoDepth?: number,
                    vibratoDepth?: number,
                    reverbSend?: number,
                    drive?: number,
                    characterMorph?: number,
                    breathIntensity?: number
                },
                pitchOffsetSemitones: number = 0
            ) => {
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
                            let finalDest = destination || masterGainRef.current!;

                            // Apply Drive/Distortion if present
                            const driveAmount = noteParams?.drive !== undefined ? noteParams.drive : params.drive;
                            if (driveAmount !== undefined && driveAmount > 0) {
                                const shaper = context.createWaveShaper();
                                shaper.curve = makeDistortionCurve(driveAmount * 100);
                                shaper.connect(finalDest);
                                finalDest = shaper;
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

                            voice.connectOutput(finalDest);

                            // Setup Reverb Send
                            const reverbSendAmount = noteParams?.reverbSend !== undefined ? noteParams.reverbSend : 0;
                            if (reverbSendAmount > 0 && reverbNodeRef.current) {
                                const reverbGain = context.createGain();
                                reverbGain.gain.value = reverbSendAmount;
                                reverbGain.connect(reverbNodeRef.current);
                                voice.connectOutput(reverbGain); // connectOutput appends to existing connections
                            }

                            // Apply Timbre Modulation (Formant Shift)
                            if (noteParams?.timbre !== undefined) {
                                const baseShift = params.formantShift || 0;
                                const mod = (noteParams.timbre * 12) - 6; // +/- 6 semitones
                                voice.setFormantShift(baseShift + mod, triggerTime);
                            } else if (params.formantShift !== undefined) {
                                voice.setFormantShift(params.formantShift, triggerTime);
                            }

                            // Apply Character Morphing
                            const morphAmount = noteParams?.characterMorph !== undefined ? noteParams.characterMorph : (params.characterMorph ?? 0);
                            const morphTarget = params.morphTarget || 'female';
                            voice.setCharacterMorph(morphAmount, morphTarget as any, 0.05); // Use short ramp time

                            // Sync other params
                            if (noteParams?.vibratoDepth !== undefined) {
                                voice.setVibratoDepth(noteParams.vibratoDepth, triggerTime);
                            } else if (params.vibratoDepth !== undefined) {
                                voice.setVibratoDepth(params.vibratoDepth, triggerTime);
                            }
                            if (params.tremoloDepth !== undefined) voice.setTremoloDepth(params.tremoloDepth, triggerTime);
                            if (params.tremoloRate !== undefined) voice.setTremoloRate(params.tremoloRate, triggerTime);
                            if (noteParams?.breathIntensity !== undefined) {
                                voice.setBreathIntensity(noteParams.breathIntensity, triggerTime);
                            } else if (params.breathIntensity !== undefined) {
                                voice.setBreathIntensity(params.breathIntensity, triggerTime);
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
                                    voice.triggerSlice(buffer.getChannelData(0), sliceIndex, alignment, pitchRatio, noteParams?.reverse);
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
                                voice.setPitchFromMidi(startMidi + pitchOffset, 60, triggerTime);
                                // Glide over half the target duration or a minimum of 0.15s, bounded by actual duration
                                const glideDuration = Math.min(Math.max(targetDuration * 0.5, 0.15), targetDuration);

                                if (noteParams?.slideType === 'exponential' || params.portamentoType === 'exponential') {
                                    voice.exponentialRampPitchFromMidi(targetMidi + pitchOffset, 60, triggerTime + glideDuration);
                                } else {
                                    voice.linearRampPitchFromMidi(targetMidi + pitchOffset, 60, triggerTime + glideDuration);
                                }
                            } else {
                                voice.setPitchFromMidi(targetMidi + pitchOffset, 60, triggerTime);
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
                                }, delayMs);
                            } else {
                                voice.noteOff();
                            }
                        };

                        const runVoices = (timeOffset: number, duration: number) => {
                            const t = actualTime + timeOffset;

                            const mainVoiceData = manager.acquireVoice();
                            manager.registerActiveVoice(mainVoiceData.index, noteStr, t);
                            triggerVoice(mainVoiceData.voice, 0, t, duration);

                            if (params.choir && params.choir > 0 && pitchOffsetSemitones === 0) {
                                const detune = 0.15;
                                const gain = params.choir * 0.7;

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

                    const shaper = context.createWaveShaper();
                    const driveAmount = noteParams?.drive !== undefined ? noteParams.drive : params.drive;
                    if (driveAmount > 0) {
                        shaper.curve = makeDistortionCurve(driveAmount * 100);
                    } else {
                        shaper.curve = null;
                    }

                    let finalDestination: AudioNode = masterGainRef.current!;
                    if (params.pan !== undefined && params.pan !== 0) {
                        const panner = context.createStereoPanner();
                        panner.pan.value = params.pan;
                        panner.connect(masterGainRef.current!);
                        finalDestination = panner;
                    }

                    source.connect(filter);
                    filter.connect(shaper);
                    shaper.connect(gain);
                    gain.connect(finalDestination);

                    source.start(startTime);
                    if (duration > 0) {
                        source.stop(startTime + duration);
                    }
                };

                notes.forEach(noteStr => {
                    const midi = noteToMidi(noteStr);

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
                noteParams?: { 
                    timbre?: number, 
                    microtiming?: number, 
                    reverse?: boolean, 
                    sliceIndex?: number, 
                    retrigger?: number, 
                    slideFromMidi?: number,
                    slideType?: 'linear' | 'exponential',
                    phonemes?: PhonemeData[],
                    freeze?: number,
                    filterCutoff?: number,
                    filterResonance?: number,
                    vibratoDepth?: number,
                    reverbSend?: number,
                    drive?: number,
                    characterMorph?: number,
                    breathIntensity?: number
                }
            ) => {
                // Harmonize support - if harmonizer is active, generate multiple harmony voices
                const harmonizer = harmonizerRef.current;
                if (harmonizer?.getIsActive()) {
                    const voices = harmonizer.generateVoices();
                    
                    // Play base voice (index 0) - the original note
                    playSamplerVoice(params, note, time, durationSteps, stepTime, noteParams, 0);
                    
                    // Play each harmony voice (skip index 0 which is base)
                    voices.forEach((voice) => {
                        if (voice.index === 0) return; // Skip base voice, already played above
                        
                        // Create modified params for this harmony voice
                        const voiceParams: SamplerBankParams = {
                            ...params,
                            pan: voice.pan,
                            volume: params.volume * voice.gain * 0.85, // Slightly reduce harmony volume for blend
                            formantShift: (params.formantShift || 0) + voice.formantShift,
                            fineTune: (params.fineTune || 0) + voice.detuneCents
                        };
                        
                        // Play this voice with pitch offset and slight delay for natural ensemble effect
                        const delayMs = voice.index * 5; // 5ms stagger per voice
                        setTimeout(() => {
                            playSamplerVoice(voiceParams, note, time + (delayMs / 1000), durationSteps, stepTime, noteParams, voice.pitchOffset);
                        }, delayMs);
                    });
                    return;
                }

                playSamplerVoice(params, note, time, durationSteps, stepTime, noteParams, 0);
            };

            const noteOnSampler = (params: SamplerBankParams, note: string, time?: number): number | null => {
                const now = time || context.currentTime;
                
                const multisampleBank = multisampleBanksRef.current.get(params.sampleName);
                const legacyBuffer = loadedSampleBuffersRef.current.get(params.sampleName);
                const buffer = multisampleBank?.baseBuffer || legacyBuffer;
                
                if (!buffer || !masterGainRef.current) return null;

                const rootNote = params.rootNote ?? 60;
                const coarseTune = params.coarseTune ?? params.coarse ?? 0;
                const fineTune = params.fineTune ?? params.fine ?? 0;

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

            const noteOnSynth = createNoteOnSynth(context, playbackRefs);
            const noteOffSynthById = (id: number) => noteOffSynth(activeSynthNotes.current, id);
            const stopAllNotes = createStopAllNotes(playbackRefs);

            const renderSynthPartToBuffer = (_params: SynthParams, _sequence: PartSequence, _tempo: number): Promise<AudioBuffer> => {
                 return Promise.resolve(context.createBuffer(2, context.sampleRate * 2, context.sampleRate));
            };

            const playBufferedPart = (buffer: AudioBuffer, time: number) => {
                const src = context.createBufferSource();
                src.buffer = buffer;
                src.connect(masterGainRef.current!);
                src.start(time);
            };
            const { playAmbiance, stopAmbiance, setAmbianceVolume } = createAmbianceControls(context, playbackRefs);
            const setMasterVolume = (value: number) => setMasterGainVolume(masterGainRef, value);
            const setMasterSaturation = (amount: number) => setMasterGainSaturation(masterSaturationRef, amount);
            const setGlobalPan = (value: number) => setMasterPan(masterPannerRef, value);

            const detectSamplePitch = async (_b: AudioBuffer) => null;
            const processSinging = async (_sampleName: string, _note: string, _steps: number, _tempo: number) => null;
            const processSpoon = async (_sampleName: string, _note: string) => null;
            const setSustainMode = (_mode: 'loop' | 'stretch' | 'wavetable') => {};
            const setSustainGrainSize = (_size: number) => {};
            const setHarmonizerConfig = (config: HarmonizerConfig, isActive: boolean) => applyHarmonizerConfig(harmonizerRef, config, isActive);
            const updateSamplerVoiceParams = (_bankIdx: number, _key: string, _value: number | string | boolean) => {};

            // Re-assign to state
            setAudioEngine({
                context,
                webGpuEngine: gpuEngineRef.current,
                wasmEngine: wasmEngineRef.current,
                open303Engine: open303ManagerRef.current as any,
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
                detectSamplePitch,
                processSinging,
                processSpoon,
                prepareVocal,
                getAlignment,
                setSustainMode,
                setSustainGrainSize,
                getMultisampleBank,
                isMultisampleReady,
                setHarmonizerConfig,
                updateSamplerVoiceParams
            });

            setIsReady(true);
            isInitializing.current = false;
        } catch (e) {
            console.error("CRITICAL AUDIO INIT FAILURE", e);
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
        updateSamplerVoiceParams
    }), [audioEngine, isReady, initializeAudio, updateVoiceParams, updateSamplerVoiceParams]);
};