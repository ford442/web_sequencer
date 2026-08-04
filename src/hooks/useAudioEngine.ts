import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type {
    SamplerBankParams, AudioEngine, TrackAnalysers, SynthParams, PartSequence
} from '../types';
import { WebGpuOscillator } from '../engines/WebGpuOscillator';
import { WasmOscillator } from '../engines/WasmOscillator';
import { Open303Manager } from '../engines/Open303Manager';
import { SingingVoiceManager } from '../engines/SingingVoiceManager';
import { VoiceManager } from '../engines/VoiceManager';
import { MultisampleGenerator } from '../engines/MultisampleGenerator';
import { DrumKitEngine } from '../engines/DrumKitEngine';
import { ProphecyManager } from '../engines/ProphecyManager';
import { Harmonizer, type HarmonizerConfig } from '../engines/Harmonizer';
import { PhonemeBufferPool } from '../services/PhonemeBufferPool';
import { loadingProgressStore } from '../stores/loadingProgressStore';
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
import {
    applySamplerVoiceParamUpdate,
    applyVoiceParamUpdate,
    createSampleLibraryControls,
} from './audioEngine/sampleManagement';
import { initializeAudioContextAndEngines, type EngineLifecycleRefs } from './audioEngine/engineLifecycle';
import { buildAudioEngine } from './audioEngine/engineApiBuilder';
import { createPlaySamplerVoice } from './audioEngine/samplerPlayback/playSamplerVoice';
import {
    createNoteOffSampler,
    createNoteOnSampler,
    createPlaySampler,
} from './audioEngine/samplerPlayback/samplerControls';

export { getSyncedSeconds, getSyncedLfoHz } from './audioEngine/syncUtils';

// URLs for worklets
import sustainProcessorUrl from '../audio-worklets/sustain-processor.ts?worker&url';
import open303ProcessorUrl from '../audio-worklets/open303-processor.ts?worker&url';
import prophecyProcessorUrl from '../audio-worklets/prophecy-processor.ts?worker&url';

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
        loadingProgressStore.startLoading();

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
                prophecyManagerRef,
                drumKitEngineRef,
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
                prophecyProcessorUrl,
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

            const samplerPlaybackRefs = {
                multisampleBanksRef,
                loadedSampleBuffersRef,
                masterSaturationRef,
                singingVoiceManagerRef,
                vocalAlignmentsRef,
                choirLeftGainRef,
                choirRightGainRef,
                reverbNodesRef,
                reverbTypeRef,
                delayNodeRef,
                harmonizerRef,
                nextSamplerNoteId,
                activeSamplerNotes,
            };
            const playSamplerVoice = createPlaySamplerVoice(context, tempo, samplerPlaybackRefs);
            const playSampler = createPlaySampler(playSamplerVoice, samplerPlaybackRefs);
            const noteOnSampler = createNoteOnSampler(context, samplerPlaybackRefs);
            const noteOffSampler = createNoteOffSampler(context, samplerPlaybackRefs);

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

            loadingProgressStore.completeStep('complete');
            loadingProgressStore.finishLoading();
            setIsReady(true);
            isInitializing.current = false;
        } catch (e) {
            console.error("CRITICAL AUDIO INIT FAILURE", e);
            loadingProgressStore.addError(
                e instanceof Error ? e.message : String(e),
            );
            loadingProgressStore.finishLoading();
            setIsReady(false);
            isInitializing.current = false;
            throw e;
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
        drumKitEngineRef,
        prophecyManagerRef,
    }), [audioEngine, isReady, initializeAudio, updateVoiceParams, updateSamplerVoiceParams]);
};
