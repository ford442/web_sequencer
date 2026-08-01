import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type {
    SamplerBankParams, AudioEngine, TrackAnalysers, Note, SynthParams, PartSequence
} from '../types';
import { WebGpuOscillator } from '../engines/WebGpuOscillator';
import { WasmOscillator } from '../engines/WasmOscillator';
import { Open303Manager } from '../engines/Open303Manager';
import { SingingVoice } from '../engines/SingingVoice';
import { SingingVoiceManager } from '../engines/SingingVoiceManager';
import { VoiceManager } from '../engines/VoiceManager';
import { noteToMidi, type ScaleDefinition } from '../utils/musicTheory';
import { MultisampleGenerator } from '../engines/MultisampleGenerator';
import { DrumKitEngine } from '../engines/DrumKitEngine';
import { ProphecyManager } from '../engines/ProphecyManager';
import { Harmonizer, type HarmonizerConfig } from '../engines/Harmonizer';
import { PhonemeBufferPool } from '../services/PhonemeBufferPool';
import type { AlignmentResult } from '../engines/rubberband/PhonemeAligner';
import type { MultisampleBank } from '../types';
import {
    createAmbianceControls,
    createNoteOnSynth,
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
import { initializeAudioContextAndEngines, type EngineLifecycleRefs } from './audioEngine/engineLifecycle';
import { buildAudioEngine } from './audioEngine/engineApiBuilder';

export { getSyncedSeconds, getSyncedLfoHz } from './audioEngine/syncUtils';
import { getSyncedSeconds, getSyncedLfoHz } from './audioEngine/syncUtils';

// URLs for worklets
import sustainProcessorUrl from '../audio-worklets/sustain-processor.ts?worker&url';
import open303ProcessorUrl from '../audio-worklets/open303-processor.ts?worker&url';

type ResolvedExpressiveness = {
    vibratoRate: number;
    vibratoDepth: number;
    tremoloDepth: number;
    breathAmount: number;
};

const resolveExpressiveness = (params: SamplerBankParams): ResolvedExpressiveness => {
    const cfg = params.expressiveness;
    const normalizeDepth = (value: number | undefined) => {
        if (value === undefined) return 0;
        return value > 1 ? value / 100 : value;
    };
    return {
        vibratoRate: cfg?.vibratoRate ?? 5.5,
        vibratoDepth: normalizeDepth(cfg?.vibratoDepth ?? params.vibratoDepth),
        tremoloDepth: normalizeDepth(cfg?.tremoloDepth ?? params.tremoloDepth),
        breathAmount: cfg?.breathAmount ?? params.breathIntensity ?? 0,
    };
};

export const useAudioEngine = (pyodide: unknown, tempo: number = 120) => {
    const [isReady, setIsReady] = useState(false);
    const [audioEngine, setAudioEngine] = useState<AudioEngine | null>(null);
    const isInitializing = useRef(false);

    // Polyphonic TTS Manager
    const singingVoiceManagerRef = useRef<SingingVoiceManager | null>(null);
    const drumKitEngineRef = useRef<DrumKitEngine | null>(null);
    const synthABusRef = useRef<GainNode | null>(null);
    const synthBBusRef = useRef<GainNode | null>(null);
    const samplerBusRef = useRef<GainNode | null>(null);
    const analyserNodeRef = useRef<AnalyserNode | null>(null);
    const trackAnalysersRef = useRef<TrackAnalysers>({});
    const prophecyManagerRef = useRef<ProphecyManager | null>(null);

    // Pre-stretched phoneme buffer pool (phoneme-aware time stretching)
    const phonemeBufferPoolRef = useRef<PhonemeBufferPool | null>(null);

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
    const sidechainGainRef = useRef<BiquadFilterNode | null>(null);
    const bassSidechainEQBusRef = useRef<BiquadFilterNode | null>(null);
    const sidechainBusRef = useRef<GainNode | null>(null);
    const masterCompressorRef = useRef<DynamicsCompressorNode | null>(null);
    const reverbNodesRef = useRef<Record<string, ConvolverNode>>({});
    const reverbNodeRef = useRef<ConvolverNode | null>(null);
    const reverbTypeRef = useRef<'room' | 'plate' | 'hall'>('plate');
    const delayNodeRef = useRef<DelayNode | null>(null);
    const delayFeedbackRef = useRef<GainNode | null>(null);
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
        masterCompressorRef,
        reverbNodesRef,
        reverbTypeRef,
        delayNodeRef,
        delayFeedbackRef,
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
        sidechainGainRef,
        bassSidechainEQBusRef,
        sidechainBusRef,
        drumKitEngineRef,
        synthABusRef,
        synthBBusRef,
        samplerBusRef,
        prophecyManagerRef,
    }), []);

    useEffect(() => {
        pyodideRef.current = pyodide;
    }, [pyodide]);

    const initializeAudio = useCallback(async () => {
        if (audioEngine || isInitializing.current) return;
        isInitializing.current = true;

        try {
            const lifecycleRefs: EngineLifecycleRefs = {
                analyserNodeRef,
                trackAnalysersRef,
                synthABusRef,
                synthBBusRef,
                samplerBusRef,
                masterGainRef,
                masterPannerRef,
                masterSaturationRef,
                masterCompressorRef,
                sidechainGainRef,
                bassSidechainEQBusRef,
                sidechainBusRef,
                reverbNodesRef,
                reverbNodeRef,
                reverbTypeRef,
                delayNodeRef,
                delayFeedbackRef,
                gpuEngineRef,
                wasmEngineRef,
                open303ManagerRef,
                voiceManagerARef,
                voiceManagerBRef,
                sustainNodeRef,
                singingVoiceManagerRef,
                choirLeftGainRef,
                choirRightGainRef,
                choirLeftPannerRef,
                choirRightPannerRef,
                phonemeBufferPoolRef,
                harmonizerRef,
                noiseBufferRef,
                multisampleGeneratorRef,
                wavSawBufferRef,
                wavSqrBufferRef,
                pyodideRef,
            };

            const { context } = await initializeAudioContextAndEngines(lifecycleRefs, {
                sustainProcessorUrl,
                open303ProcessorUrl,
            });

            // --- Helper: warm the phoneme pool for all phonemes in a bank ---
            const warmPoolForBank = (sampleName: string, alignment: AlignmentResult, audioBuffer: AudioBuffer): void => {
                const pool = phonemeBufferPoolRef.current;
                if (!pool) return;
                const monoAudio = audioBuffer.getChannelData(0);
                const sr = audioBuffer.sampleRate;
                for (let i = 0; i < alignment.phonemes.length; i++) {
                    const ph = alignment.phonemes[i];
                    const startSample = Math.floor(ph.start * sr);
                    const endSample = Math.floor(ph.end * sr);
                    if (endSample <= startSample) continue;
                    const slice = monoAudio.slice(startSample, endSample);
                    pool.warmPhoneme(`${sampleName}_${i}`, [slice], sr);
                }
            };

            const {
                loadSampleToEngine,
                getMultisampleBank,
                isMultisampleReady,
                prepareVocal: prepareVocalBase,
                getAlignment,
                setAlignment: setAlignmentBase
            } = createSampleLibraryControls({
                loadedSampleBuffersRef,
                multisampleBanksRef,
                multisampleGeneratorRef,
                vocalAlignmentsRef,
                singingVoiceManagerRef,
            });

            // Wrap prepareVocal to warm the pool once alignment is computed
            const prepareVocal = async (bankIndex: number, text: string): Promise<void> => {
                await prepareVocalBase(bankIndex, text);
                const sampleName = `bank_${bankIndex}`;
                const alignment = vocalAlignmentsRef.current.get(sampleName);
                const audioBuffer = (multisampleBanksRef.current.get(sampleName)?.baseBuffer)
                    ?? loadedSampleBuffersRef.current.get(sampleName);
                if (alignment && audioBuffer) {
                    warmPoolForBank(sampleName, alignment, audioBuffer);
                }
            };

            // Wrap setAlignment to warm the pool when alignment is set externally
            const setAlignment = (bankIndex: number, alignment: AlignmentResult | null): void => {
                setAlignmentBase(bankIndex, alignment);
                if (alignment) {
                    const sampleName = `bank_${bankIndex}`;
                    const audioBuffer = (multisampleBanksRef.current.get(sampleName)?.baseBuffer)
                        ?? loadedSampleBuffersRef.current.get(sampleName);
                    if (audioBuffer) {
                        warmPoolForBank(sampleName, alignment, audioBuffer);
                    }
                }
            };
            const playSamplerVoice = (
                params: SamplerBankParams,
                note: string | string[],
                time: number,
                durationSteps: number = 1,
                stepTime: number = 0.2,
                noteParams?: Partial<Note>,
                pitchOffsetSemitones: number = 0,
                tuning?: ScaleDefinition | null
            ) => {
                const multisampleBank = multisampleBanksRef.current.get(params.sampleName);
                const legacyBuffer = loadedSampleBuffersRef.current.get(params.sampleName);
                const buffer = multisampleBank?.baseBuffer || legacyBuffer;

                if (!buffer || !masterSaturationRef.current) return;

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

                // Performance: Hoist expressive config resolution to avoid recalculating per note/retrigger.
                const expressiveConfig = resolveExpressiveness(params);

                // --- HOISTED PARAMETERS START ---
                // Vocoder Mix
                const vocoderMix = noteParams?.vocoderMix ?? params.vocoderMix ?? 0;
                const pVocoderFormantShift = noteParams?.vocoderFormantShift ?? params.formantShift ?? 0;
                const pVocoderPreservation = noteParams?.vocoderPreservation ?? 1.0;
                const pVocoderAttack = noteParams?.vocoderAttack ?? 0.01;
                const pVocoderRelease = noteParams?.vocoderRelease ?? 0.05;

                // Spectral Panning
                const spectralPanRate = noteParams?.spectralPanRate !== undefined ? noteParams.spectralPanRate : params.spectralPanRate;
                const spectralPanDepth = noteParams?.spectralPanDepth !== undefined ? noteParams.spectralPanDepth : params.spectralPanDepth;
                const spectralPanLfoRate = (spectralPanRate || 1) * (tempo / 60);

                // Reverb
                const reverbSendAmount = noteParams?.reverbSend !== undefined ? noteParams.reverbSend : 0;
                const currentReverbType = noteParams?.reverbType || reverbTypeRef.current;
                const targetReverbNode = reverbNodesRef.current[currentReverbType] || reverbNodesRef.current['plate'];

                const baseShift = params.formantShift || 0;
                const currentShift = noteParams?.formantShift !== undefined ? (baseShift + noteParams.formantShift) : baseShift;
                const characterMorph = noteParams?.characterMorph !== undefined ? noteParams.characterMorph : (params.characterMorph ?? 0);
                const morphTarget = params.morphTarget || 'female';

                const normalizedShift = Math.max(-12, Math.min(12, currentShift)) / 12;
                let reverbEqCutoff = 6000 - (normalizedShift * 4000);
                reverbEqCutoff -= (characterMorph * 1000);
                reverbEqCutoff = Math.max(1000, Math.min(12000, reverbEqCutoff));

                const revLfoRate = noteParams?.reverbLfoRate !== undefined ? noteParams.reverbLfoRate : (params.reverbLfoRate || 0.1);
                const revLfoDepth = noteParams?.reverbLfoDepth !== undefined ? noteParams.reverbLfoDepth : (params.reverbLfoDepth || 0);

                // Delay
                const delaySendAmount = noteParams?.delaySend !== undefined ? noteParams.delaySend : (params.delaySend || 0);

                // Timbre Modulation
                let targetFormantShift = baseShift;
                if (noteParams?.formantShift !== undefined) {
                    targetFormantShift = baseShift + noteParams.formantShift;
                } else if (noteParams?.timbre !== undefined) {
                    targetFormantShift = baseShift + (noteParams.timbre * 12) - 6;
                }
                const startFormantShift = noteParams?.slideFromFormant !== undefined ? (baseShift + noteParams.slideFromFormant) : undefined;

                // General Params
                const pVibratoDepth = noteParams?.vibratoDepth;
                const pTremoloDepth = noteParams?.tremoloDepth !== undefined ? noteParams.tremoloDepth : params.tremoloDepth;
                const pTremoloRate = noteParams?.tremoloRate !== undefined ? noteParams.tremoloRate : params.tremoloRate;
                const pGateDepth = noteParams?.gateDepth !== undefined ? noteParams.gateDepth : params.gateDepth;
                const pGateRateHz = noteParams?.gateRate !== undefined
                    ? (tempo / 60) * (noteParams.gateRate / 4)
                    : (params.gateRate !== undefined ? (tempo / 60) * (params.gateRate / 4) : undefined);
                const pAttack = params.attack;
                const pDecay = params.decay;
                const pSustain = params.sustain;
                const pRelease = params.release;

                // Freeze
                const pFreeze = noteParams?.freeze !== undefined ? noteParams.freeze : params.freeze;
                const freezeRateSync = noteParams?.freezeLfoSync !== undefined ? noteParams.freezeLfoSync : params.freezeLfoSync;
                let pFreezeLfoRate: number | undefined;
                if (noteParams?.freezeLfoRate !== undefined) {
                    pFreezeLfoRate = freezeRateSync ? getSyncedLfoHz(noteParams.freezeLfoRate, tempo) : noteParams.freezeLfoRate;
                } else if (params.freezeLfoRate !== undefined) {
                    pFreezeLfoRate = freezeRateSync ? getSyncedLfoHz(params.freezeLfoRate, tempo) : params.freezeLfoRate;
                }
                const pFreezeLfoDepth = noteParams?.freezeLfoDepth !== undefined ? noteParams.freezeLfoDepth : params.freezeLfoDepth;

                // Envelopes
                const pFreezeEnvDepth = noteParams?.freezeEnvDepth !== undefined ? noteParams.freezeEnvDepth : params.freezeEnvDepth;
                const pTimeStretchEnvDepth = noteParams?.timeStretchEnvDepth !== undefined ? noteParams.timeStretchEnvDepth : params.timeStretchEnvDepth;
                const pGrainEnvDepth = noteParams?.grainEnvDepth !== undefined ? noteParams.grainEnvDepth : params.grainEnvDepth;
                const pGrainPitchEnvDepth = noteParams?.grainPitchEnvDepth !== undefined ? noteParams.grainPitchEnvDepth : params.grainPitchEnvDepth;
                const pGrainJitter = noteParams?.grainJitter !== undefined ? noteParams.grainJitter : params.grainJitter;
                const pGrainPitchQuantize = noteParams?.grainPitchQuantize !== undefined ? noteParams.grainPitchQuantize : params.grainPitchQuantize;

                // Effects
                const pGranularPitchShift = noteParams?.granularPitchShift !== undefined ? noteParams.granularPitchShift : params.granularPitchShift;
                const pBitcrush = noteParams?.bitcrush !== undefined ? noteParams.bitcrush : params.bitcrush;
                const pDownsample = noteParams?.downsample !== undefined ? noteParams.downsample : params.downsample;
                const pTranceGate = noteParams?.tranceGate;

                // Formant LFO
                const useFmtLfoSync = noteParams?.formantLfoSync ?? params.formantLfoSync ?? false;
                const rawFmtLfoRate = noteParams?.formantLfoRate !== undefined ? noteParams.formantLfoRate : params.formantLfoRate;
                const pFormantLfoRateHz = rawFmtLfoRate !== undefined ? (useFmtLfoSync ? ((tempo / 60) / (rawFmtLfoRate * 4)) : rawFmtLfoRate) : undefined;
                const pFormantLfoDepth = noteParams?.formantLfoDepth !== undefined ? noteParams.formantLfoDepth : params.formantLfoDepth;
                let pFormantLfoShape = noteParams?.customLfoShape !== undefined ? noteParams.customLfoShape : params.customLfoShape;
                if (pFormantLfoShape === undefined) {
                    pFormantLfoShape = noteParams?.formantLfoShape !== undefined ? noteParams.formantLfoShape : params.formantLfoShape;
                }

                // Formant Envelope
                const envSync = noteParams?.formantEnvSync ?? params.formantEnvSync ?? false;
                let pEnvAttack = noteParams?.formantEnvAttack ?? params.formantEnvAttack ?? 0;
                let pEnvDecay = noteParams?.formantEnvDecay ?? params.formantEnvDecay ?? 0;
                const pEnvAmount = noteParams?.formantEnvAmount ?? params.formantEnvAmount ?? 0;
                const pFormantEnvFollower = noteParams?.formantEnvFollower ?? params.formantEnvFollower ?? 0;
                if (envSync) {
                    pEnvAttack = getSyncedSeconds(pEnvAttack as number, tempo);
                    pEnvDecay = getSyncedSeconds(pEnvDecay as number, tempo);
                }

                const pPitchAttack = noteParams?.pitchAttack ?? params.pitchAttack ?? 0;
                const pPitchDecay = noteParams?.pitchDecay ?? params.pitchDecay ?? 0;
                const pPitchAmount = noteParams?.pitchAmount ?? params.pitchAmount ?? 0;

                const pFilterCutoff = noteParams?.filterCutoff !== undefined
                    ? Math.max(20, noteParams.filterCutoff * 20000)
                    : params.filterCutoff;
                const pFilterResonance = noteParams?.filterResonance !== undefined
                    ? noteParams.filterResonance * 20
                    : params.filterResonance;
                const pDriveAmount = noteParams?.drive !== undefined
                    ? noteParams.drive
                    : params.drive;
                // --- HOISTED PARAMETERS END ---


                // If Singing/Stretch Mode
                if (params.mode === 'stretch' && singingVoiceManagerRef.current) {
                    const manager = singingVoiceManagerRef.current;
                    const alignment = vocalAlignmentsRef.current.get(params.sampleName);

                    const triggerVoice = (noteStr: string, voice: SingingVoice, pitchOffset: number, overrideTime?: number, overrideDuration?: number, destination?: AudioNode, isNewBank: boolean = true) => {
                            const targetDuration = overrideDuration !== undefined ? overrideDuration : (durationSteps * stepTime);
                            const originalDuration = buffer.duration;
                            const triggerTime = overrideTime !== undefined ? overrideTime : actualTime;

                            // Ensure voice connected to correct output
                            voice.disconnectOutput();
                            let finalDest = destination || masterSaturationRef.current!;

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
                            const currentReverbType = noteParams?.reverbType || reverbTypeRef.current;
                            const targetReverbNode = reverbNodesRef.current[currentReverbType] || reverbNodesRef.current['plate'];
                            if (reverbSendAmount > 0 && targetReverbNode) {
                                const reverbGain = context.createGain();
                                reverbGain.gain.value = reverbSendAmount;
                                reverbGain.connect(targetReverbNode);
                                voice.connectOutput(reverbGain); // connectOutput appends to existing connections
                            }

                            // Setup Delay Send
                            const delaySendAmount = noteParams?.delaySend !== undefined ? noteParams.delaySend : (params.delaySend || 0);
                            if (delaySendAmount > 0 && delayNodeRef.current) {
                                const delayGain = context.createGain();
                                delayGain.gain.value = delaySendAmount;
                                delayGain.connect(delayNodeRef.current);
                                voice.connectOutput(delayGain);
                            }

                            // Apply Timbre Modulation (Formant Shift)
                            const baseShift = params.formantShift || 0;
                            if (noteParams?.formantShift !== undefined) {
                                voice.setFormantShift(baseShift + noteParams.formantShift, triggerTime);
                            } else if (noteParams?.timbre !== undefined) {
                                const mod = (noteParams.timbre * 12) - 6; // +/- 6 semitones
                                voice.setFormantShift(baseShift + mod, triggerTime);
                            } else if (params.formantShift !== undefined) {
                                voice.setFormantShift(params.formantShift, triggerTime);
                            }

                            // Apply Character Morphing
                            const morphAmount = noteParams?.characterMorph !== undefined ? noteParams.characterMorph : (params.characterMorph ?? 0);
                            const morphTarget = params.morphTarget || 'female';
                            voice.setCharacterMorph(morphAmount, morphTarget, 0.05); // Use short ramp time

                            // Sync other params
                            if (noteParams?.vibratoDepth !== undefined) {
                                voice.setVibratoDepth(noteParams.vibratoDepth, triggerTime);
                            } else if (params.vibratoDepth !== undefined) {
                                voice.setVibratoDepth(params.vibratoDepth, triggerTime);
                            }

                            if (noteParams?.gateDepth !== undefined) {
                                voice.setGateDepth(noteParams.gateDepth, triggerTime);
                            } else if (params.gateDepth !== undefined) {
                                voice.setGateDepth(params.gateDepth, triggerTime);
                            }

                            if (noteParams?.gateRate !== undefined) {
                                const rateHz = (tempo / 60) * (noteParams.gateRate / 4);
                                voice.setGateRate(rateHz, triggerTime);
                            } else if (params.gateRate !== undefined) {
                                const rateHz = (tempo / 60) * (params.gateRate / 4);
                                voice.setGateRate(rateHz, triggerTime);
                            }
                            if (params.tremoloDepth !== undefined) voice.setTremoloDepth(params.tremoloDepth, triggerTime);
                            if (params.tremoloRate !== undefined) voice.setTremoloRate(params.tremoloRate, triggerTime);

                            if (noteParams?.gateDepth !== undefined) {
                                voice.setGateDepth(noteParams.gateDepth, triggerTime);
                            } else if (params.gateDepth !== undefined) {
                                voice.setGateDepth(params.gateDepth, triggerTime);
                            }

                            if (noteParams?.gateRate !== undefined) {
                                voice.setGateRate(noteParams.gateRate, triggerTime);
                            } else if (params.gateRate !== undefined) {
                                voice.setGateRate(params.gateRate, triggerTime);
                            }

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

                            // Apply Envelope Follower depths (global only)
                            if (params.freezeEnvDepth !== undefined) voice.setFreezeEnvDepth(params.freezeEnvDepth, triggerTime);
                            if (params.grainEnvDepth !== undefined) voice.setGrainEnvDepth(params.grainEnvDepth, triggerTime);
                            if (noteParams?.grainPitchQuantize !== undefined) {
                                voice.setGrainPitchQuantize(noteParams.grainPitchQuantize, triggerTime);
                            } else if (params.grainPitchQuantize !== undefined) {
                                voice.setGrainPitchQuantize(params.grainPitchQuantize, triggerTime);
                            }

                            if (noteParams?.tranceGate !== undefined) {
                                voice.setTranceGate(noteParams.tranceGate, triggerTime);
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
                            if (noteParams?.formantLfoShape !== undefined) {
                                voice.setFormantLfoShape(noteParams.formantLfoShape);
                            } else if (params.formantLfoShape !== undefined) {
                                voice.setFormantLfoShape(params.formantLfoShape);
                            } else {
                                voice.setFormantLfoShape(undefined);
                            }

                            // Apply Character Morphing
                            voice.setCharacterMorph(characterMorph, morphTarget, 0.05); // Use short ramp time

                            // Sync other params
                            if (pVibratoDepth !== undefined) voice.setVibratoDepth(pVibratoDepth, triggerTime);
                            if (pTremoloDepth !== undefined) voice.setTremoloDepth(pTremoloDepth * 100, triggerTime); // setTremoloDepth expects percentage 0-100
                            if (pTremoloRate !== undefined) voice.setTremoloRate(pTremoloRate, triggerTime);
                            if (pGateDepth !== undefined) voice.setGateDepth(pGateDepth, triggerTime);
                            if (pGateRateHz !== undefined) voice.setGateRate(pGateRateHz, triggerTime);

                            if (pAttack !== undefined) voice.setAttack(pAttack, triggerTime);
                            if (pDecay !== undefined) voice.setDecay(pDecay, triggerTime);
                            if (pSustain !== undefined) voice.setSustain(pSustain, triggerTime);
                            if (pRelease !== undefined) voice.setRelease(pRelease, triggerTime);

                            if (pFreeze !== undefined) voice.setFreeze(pFreeze, triggerTime);
                            if (pFreezeLfoRate !== undefined) voice.setFreezeLfoRate(pFreezeLfoRate, triggerTime);
                            if (pFreezeLfoDepth !== undefined) voice.setFreezeLfoDepth(pFreezeLfoDepth, triggerTime);

                            if (pFreezeEnvDepth !== undefined) voice.setFreezeEnvDepth(pFreezeEnvDepth, triggerTime);
                            if (pTimeStretchEnvDepth !== undefined) voice.setTimeStretchEnvDepth(pTimeStretchEnvDepth, triggerTime);
                            if (pGrainEnvDepth !== undefined) voice.setGrainEnvDepth(pGrainEnvDepth, triggerTime);
                            if (pGrainPitchEnvDepth !== undefined) voice.setGrainPitchEnvDepth(pGrainPitchEnvDepth, triggerTime);
                            if (pGrainJitter !== undefined) voice.setGrainJitter(pGrainJitter, triggerTime);
                            if (pGrainPitchQuantize !== undefined) voice.setGrainPitchQuantize(pGrainPitchQuantize, triggerTime);

                            if (pGranularPitchShift !== undefined) voice.setGranularPitchShift(pGranularPitchShift, triggerTime);
                            if (pBitcrush !== undefined) voice.setBitcrush(pBitcrush, triggerTime);
                            if (pDownsample !== undefined) voice.setDownsample(pDownsample, triggerTime);
                            if (pTranceGate !== undefined) voice.setTranceGate(pTranceGate, triggerTime);

                            if (pFormantLfoRateHz !== undefined) voice.setFormantLfoRate(pFormantLfoRateHz, triggerTime);
                            if (pFormantLfoDepth !== undefined) voice.setFormantLfoDepth(pFormantLfoDepth, triggerTime);
                            voice.setFormantLfoShape(pFormantLfoShape);

                            if (pEnvAmount !== 0) voice.setFormantEnvelope(pEnvAmount, pEnvAttack as number, pEnvDecay as number, triggerTime);
                            voice.setFormantEnvFollower(pFormantEnvFollower as number, triggerTime);

                            // Load buffer only if the voice doesn't already have it
                            if (isNewBank) {
                                voice.loadBuffer(buffer.getChannelData(0));
                            }

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
                                    const phonemeId = `${params.sampleName}_${sliceIndex}`;
                                    voice.triggerSlice(
                                        buffer.getChannelData(0),
                                        sliceIndex,
                                        alignment,
                                        pitchRatio,
                                        noteParams?.reverse,
                                        targetDuration,
                                        triggerTime,
                                        phonemeId,
                                    );
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
                                voice.setPitchFromMidi(startMidi + pitchOffset, 60, triggerTime, undefined, undefined, tuning);
                                // Glide over half the target duration or a minimum of 0.15s, bounded by actual duration
                                const glideDuration = Math.min(Math.max(targetDuration * 0.5, 0.15), targetDuration);

                                if (noteParams?.slideType === 'exponential' || params.portamentoType === 'exponential') {
                                    voice.exponentialRampPitchFromMidi(targetMidi + pitchOffset, 60, triggerTime + glideDuration, undefined, undefined, tuning);
                                } else {
                                    voice.linearRampPitchFromMidi(targetMidi + pitchOffset, 60, triggerTime + glideDuration, undefined, undefined, tuning);
                                }
                            } else {
                                voice.setPitchFromMidi(targetMidi + pitchOffset, 60, triggerTime, undefined, undefined, tuning);
                            }

                            // 3. Phoneme Awareness (from Jules branch)
                            if (alignment) {
                                voice.setAlignment(alignment);
                                voice.sendPhonemeDataToWorklet(targetDuration);
                            }

                            // 4. Play

                            // Pitch Envelope
                            if (voice.setPitchAttack) {
                                voice.setPitchAttack(pPitchAttack, triggerTime);
                            }
                            if (voice.setPitchDecay) {
                                voice.setPitchDecay(pPitchDecay, triggerTime);
                            }
                            if (voice.setPitchAmount) {
                                voice.setPitchAmount(pPitchAmount, triggerTime);
                            }

                            voice.play(undefined, undefined, 1.0, noteParams?.reverse);

                            const releaseTime = triggerTime + targetDuration;
                            // ⚡ Bolt Optimization: Replace main-thread setTimeout with worklet-scheduled noteOff
                            voice.noteOff(releaseTime);
                        };

                        const runVoices = (noteStr: string, timeOffset: number, duration: number) => {
                            const t = actualTime + timeOffset;

                            const mainVoiceData = manager.acquireVoice();
                            manager.registerActiveVoice(mainVoiceData.index, noteStr, t);
                            triggerVoice(noteStr, mainVoiceData.voice, 0, t, duration, undefined, mainVoiceData.isNewBank);

                            const effectiveChoir = noteParams?.choir !== undefined ? noteParams.choir : (params.choir || 0);

                            if (effectiveChoir > 0 && pitchOffsetSemitones === 0) {
                                const detune = 0.15;
                                const gain = effectiveChoir * 0.7;

                                if (choirLeftGainRef.current) choirLeftGainRef.current.gain.setTargetAtTime(gain, t, 0.02);
                                if (choirRightGainRef.current) choirRightGainRef.current.gain.setTargetAtTime(gain, t, 0.02);

                                const leftVoiceData = manager.acquireVoice();
                                if (leftVoiceData.index !== mainVoiceData.index) {
                                    manager.registerActiveVoice(leftVoiceData.index, `${noteStr}_L`, t);
                                    triggerVoice(noteStr, leftVoiceData.voice, detune, t, duration, choirLeftGainRef.current!, leftVoiceData.isNewBank);
                                }

                                const rightVoiceData = manager.acquireVoice();
                                if (rightVoiceData.index !== mainVoiceData.index && rightVoiceData.index !== leftVoiceData.index) {
                                    manager.registerActiveVoice(rightVoiceData.index, `${noteStr}_R`, t);
                                    triggerVoice(noteStr, rightVoiceData.voice, -detune, t, duration, choirRightGainRef.current!, rightVoiceData.isNewBank);
                                }
                            } else if (pitchOffsetSemitones === 0) {
                                if (choirLeftGainRef.current) choirLeftGainRef.current.gain.setTargetAtTime(0, t, 0.02);
                                if (choirRightGainRef.current) choirRightGainRef.current.gain.setTargetAtTime(0, t, 0.02);
                            }
                        };

                    // For each note in the chord
                    // ⚡ Bolt Optimization: Replacing forEach with for...of to prevent closure allocations on hot path
                    for (const noteStr of notes) {
                        if (shouldGlitch) {
                            const numStutters = Math.floor(Math.random() * 3) + 2;
                            const totalDur = durationSteps * stepTime;
                            const stutterLen = Math.min(0.06, totalDur / numStutters);

                            for (let i = 0; i < numStutters; i++) {
                                runVoices(noteStr, i * stutterLen, stutterLen);
                            }
                            const played = numStutters * stutterLen;
                            if (totalDur > played) {
                                runVoices(noteStr, played, totalDur - played);
                            }
                        } else {
                            for (let r = 0; r < retrigger; r++) {
                                const offset = r * (subDurationSteps * stepTime);
                                runVoices(noteStr, offset, subDurationSteps * stepTime);
                            }
                        }
                    }
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

                    let finalDestination: AudioNode = masterSaturationRef.current!;
                    if (params.pan !== undefined && params.pan !== 0) {
                        const panner = context.createStereoPanner();
                        panner.pan.value = params.pan;
                        panner.connect(masterSaturationRef.current!);
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

                // ⚡ Bolt Optimization: Replacing forEach with for...of to prevent closure allocations on hot path
                for (const noteStr of notes) {
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
                }
            };

            // Main playSampler function with harmonizer support
            const playSampler = (
                params: SamplerBankParams,
                note: string | string[],
                time: number,
                durationSteps: number = 1,
                stepTime: number = 0.2,
                tuning?: ScaleDefinition | null
            ) => {
                // Harmonize support - if harmonizer is active, generate multiple harmony voices
                const harmonizer = harmonizerRef.current;
                if (harmonizer?.getIsActive()) {
                    const voices = harmonizer.generateVoices();

                    // Play base voice (index 0) - the original note
                    playSamplerVoice(params, note, time, durationSteps, stepTime, undefined, 0, tuning);

                    // Play each harmony voice (skip index 0 which is base)
                    // ⚡ Bolt Optimization: Replacing forEach with for...of to prevent closure allocations on hot path
                    for (const voice of voices) {
                        if (voice.index === 0) continue; // Skip base voice, already played above

                        // Create modified params for this harmony voice
                        const config = harmonizer.getConfig();
                        const voiceParams: SamplerBankParams = {
                            ...params,
                            pan: Math.max(-1, Math.min(1, (params.pan || 0) + (voice.pan || 0))),
                            volume: params.volume * voice.gain * 0.85,
                            formantShift: (params.formantShift || 0) + voice.formantShift,
                            fineTune: (params.fineTune || 0) + voice.detuneCents
                        };
                        if (config.harmonyAttack !== undefined) {
                            voiceParams.attack = config.harmonyAttack;
                        }
                        if (config.harmonyRelease !== undefined) {
                            voiceParams.release = config.harmonyRelease;
                        }

                        // Play this voice with pitch offset and slight delay for natural ensemble effect
                        const delayMs = voice.index * 5;
                        setTimeout(() => {
                            playSamplerVoice(voiceParams, note, time + (delayMs / 1000), durationSteps, stepTime, undefined, voice.pitchOffset, tuning);
                        }, delayMs);
                    }
                    return;
                }

                playSamplerVoice(params, note, time, durationSteps, stepTime, undefined, 0, tuning);
            };

            const noteOnSampler = (params: SamplerBankParams, note: string, time?: number, tuning?: any): number | null => {
                const now = time || context.currentTime;

                const multisampleBank = multisampleBanksRef.current.get(params.sampleName);
                const legacyBuffer = loadedSampleBuffersRef.current.get(params.sampleName);
                const buffer = multisampleBank?.baseBuffer || legacyBuffer;

                if (!buffer || !masterSaturationRef.current) return null;

                const rootNote = params.rootNote ?? 60;
                const coarseTune = params.coarseTune ?? 0;
                const fineTune = params.fineTune ?? 0;

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
                gain.connect(masterSaturationRef.current);
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
                src.connect(masterSaturationRef.current!);
                src.start(time);
            };
            const { playAmbiance, stopAmbiance, setAmbianceVolume } = createAmbianceControls(context, playbackRefs);
            const setMasterVolume = (value: number) => setMasterGainVolume(masterGainRef, value);
            const setMasterSaturation = (amount: number) => setMasterGainSaturation(masterSaturationRef, amount);
            const setGlobalPan = (value: number) => setMasterPan(masterPannerRef, value);

            const setReverbType = (type: 'room' | 'plate' | 'hall') => {
                reverbTypeRef.current = type;
            };

            const triggerTapeStop = (duration: number = 2.0) => {
                if (!masterGainRef.current) return;
                const now = context.currentTime;
                const gain = masterGainRef.current.gain;
                const currentVol = gain.value;
                gain.cancelScheduledValues(now);
                gain.setValueAtTime(currentVol, now);
                gain.exponentialRampToValueAtTime(0.0001, now + duration);
            };

            const resetTapeStop = () => {
                if (!masterGainRef.current) return;
                const now = context.currentTime;
                const gain = masterGainRef.current.gain;
                gain.cancelScheduledValues(now);
                gain.setValueAtTime(1.0, now);
            };

            const detectSamplePitch = async (_b: AudioBuffer) => null;
            const processSinging = async (_sampleName: string, _note: string, _steps: number, _tempo: number) => null;
            const processSpoon = async (_sampleName: string, _note: string) => null;
            const setSustainMode = (_mode: 'loop' | 'stretch' | 'wavetable') => {};
            const setSustainGrainSize = (_size: number) => {};
            const setHarmonizerConfig = (config: HarmonizerConfig, isActive: boolean) => applyHarmonizerConfig(harmonizerRef, config, isActive);
            const updateSamplerVoiceParams = (_bankIdx: number, _key: string, _value: number | string | boolean) => {};

            setAudioEngine(buildAudioEngine(context, {
                ...playbackRefs,
                gpuEngineRef,
                wasmEngineRef,
                open303ManagerRef,
                harmonizerRef,
                masterGainRef,
                masterSaturationRef,
                masterPannerRef,
                reverbTypeRef,
                analyserNodeRef,
                trackAnalysersRef,
            }, {
                playSampler,
                noteOnSampler,
                noteOffSampler,
                loadSampleToEngine,
                prepareVocal,
                getAlignment,
                setAlignment,
                getMultisampleBank,
                isMultisampleReady,
            }));

            setIsReady(true);
        } catch (e) {
            console.error("CRITICAL AUDIO INIT FAILURE", e);
            setIsReady(true);
            isInitializing.current = false;
        }
    }, [audioEngine, playbackRefs, tempo]);

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
        updateSamplerVoiceParams,
        drumKitEngineRef
    }), [audioEngine, isReady, initializeAudio, updateVoiceParams, updateSamplerVoiceParams]);
};
