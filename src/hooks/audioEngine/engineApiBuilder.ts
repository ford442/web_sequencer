import type { MutableRefObject } from 'react';
import type { HarmonizerConfig } from '../../engines/Harmonizer';
import type { AudioEngine, PartSequence, SynthParams, TrackAnalysers } from '../../types';
import { WebGpuOscillator } from '../../engines/WebGpuOscillator';
import { WasmOscillator } from '../../engines/WasmOscillator';
import { Open303Manager } from '../../engines/Open303Manager';
import { Harmonizer } from '../../engines/Harmonizer';
import { renderSynthPattern } from '../../utils/patternRenderer';
import {
    createAmbianceControls,
    createNoteOnSynth,
    createPlayDrum,
    createPlaySynth,
    createStopAllNotes,
    createStopTrackNotes,
    noteOffSynth,
    setGlobalPan as setMasterPan,
    setHarmonizerConfig as applyHarmonizerConfig,
    setMasterVolume as setMasterGainVolume,
    setMasterSaturation as setMasterGainSaturation,
    type PlaybackRefs,
} from './audioPlayback';

export interface EngineApiBuilderRefs extends PlaybackRefs {
    gpuEngineRef: MutableRefObject<WebGpuOscillator | null>;
    wasmEngineRef: MutableRefObject<WasmOscillator | null>;
    open303ManagerRef: MutableRefObject<Open303Manager | null>;
    harmonizerRef: MutableRefObject<Harmonizer | null>;
    masterGainRef: MutableRefObject<GainNode | null>;
    masterSaturationRef: MutableRefObject<WaveShaperNode | null>;
    masterPannerRef: MutableRefObject<StereoPannerNode | null>;
    reverbTypeRef: MutableRefObject<'room' | 'plate' | 'hall'>;
    analyserNodeRef: MutableRefObject<AnalyserNode | null>;
    trackAnalysersRef: MutableRefObject<TrackAnalysers>;
}

export interface EngineApiPlaybackFns {
    playSampler: AudioEngine['playSampler'];
    noteOnSampler: AudioEngine['noteOnSampler'];
    noteOffSampler: AudioEngine['noteOffSampler'];
    loadSampleToEngine: AudioEngine['loadSampleToEngine'];
    prepareVocal: AudioEngine['prepareVocal'];
    getAlignment: AudioEngine['getAlignment'];
    setAlignment: AudioEngine['setAlignment'];
    getMultisampleBank: AudioEngine['getMultisampleBank'];
    isMultisampleReady: AudioEngine['isMultisampleReady'];
}

export function buildAudioEngine(
    context: AudioContext,
    refs: EngineApiBuilderRefs,
    playbackFns: EngineApiPlaybackFns,
): AudioEngine {
    const playSynth = (params: any, note: string | string[], time: number, durationSteps?: number, stepTime?: number, slideFromFreq?: number, track?: 'partA' | 'partB' | 'bass2', noteParams?: any) => {
        createPlaySynth(context, refs)(params, note, time, durationSteps, stepTime, slideFromFreq, track as any, noteParams);
    };
    const playDrum = createPlayDrum(context, refs);
    const noteOnSynth = createNoteOnSynth(context, refs);
    const noteOffSynthById = (id: number) => noteOffSynth(refs.activeSynthNotes.current, id);
    const stopAllNotes = createStopAllNotes(refs);
    const stopTrackNotes = createStopTrackNotes(refs);

    const renderSynthPartToBuffer = (params: SynthParams, sequence: PartSequence, tempo: number): Promise<AudioBuffer> => {
        return renderSynthPattern(params, {
            sequence,
            tempo,
            sampleRate: context.sampleRate,
            engines: {
                webGpuEngine: refs.gpuEngineRef.current ?? undefined,
                wasmEngine: refs.wasmEngineRef.current ?? undefined,
            },
        });
    };

    const playBufferedPart = (buffer: AudioBuffer, time: number) => {
        const src = context.createBufferSource();
        src.buffer = buffer;
        src.connect(refs.masterSaturationRef.current!);
        src.start(time);
    };

    const { playAmbiance, stopAmbiance, setAmbianceVolume } = createAmbianceControls(context, refs);
    const setMasterVolume = (value: number) => setMasterGainVolume(refs.masterGainRef, value);
    const setMasterSaturation = (amount: number) => setMasterGainSaturation(refs.masterSaturationRef, amount);
    const setGlobalPan = (value: number) => setMasterPan(refs.masterPannerRef, value);

    const setReverbType = (type: 'room' | 'plate' | 'hall') => {
        refs.reverbTypeRef.current = type;
    };

    const triggerTapeStop = (duration: number = 2.0) => {
        if (!refs.masterGainRef.current) return;
        const now = context.currentTime;
        const gain = refs.masterGainRef.current.gain;
        const currentVol = gain.value;
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(currentVol, now);
        gain.exponentialRampToValueAtTime(0.0001, now + duration);
    };

    const resetTapeStop = () => {
        if (!refs.masterGainRef.current) return;
        const now = context.currentTime;
        const gain = refs.masterGainRef.current.gain;
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(1.0, now);
    };

    const detectSamplePitch = async (_b: AudioBuffer) => null;
    const processSinging = async (_sampleName: string, _note: string, _steps: number, _tempo: number) => null;
    const processSpoon = async (_sampleName: string, _note: string) => null;
    const setSustainMode = (_mode: 'loop' | 'stretch' | 'wavetable') => {};
    const setSustainGrainSize = (_size: number) => {};
    const setHarmonizerConfig = (config: HarmonizerConfig, isActive: boolean) => applyHarmonizerConfig(refs.harmonizerRef, config, isActive);
    const updateSamplerVoiceParams = (_bankIdx: number, _key: string, _value: number | string | boolean) => {};

    return {
        context,
        analyserNode: refs.analyserNodeRef.current,
        trackAnalysers: refs.trackAnalysersRef.current,
        webGpuEngine: refs.gpuEngineRef.current,
        wasmEngine: refs.wasmEngineRef.current,
        open303Engine: refs.open303ManagerRef.current,
        singingVoice: undefined,
        playSynth,
        playDrum,
        playSampler: playbackFns.playSampler,
        noteOnSampler: playbackFns.noteOnSampler,
        noteOffSampler: playbackFns.noteOffSampler,
        noteOnSynth,
        noteOffSynth: noteOffSynthById,
        stopAllNotes,
        stopTrackNotes,
        loadSampleToEngine: playbackFns.loadSampleToEngine,
        renderSynthPartToBuffer,
        playBufferedPart,
        playAmbiance,
        stopAmbiance,
        setAmbianceVolume,
        setMasterVolume,
        setMasterSaturation,
        setGlobalPan,
        setReverbType,
        detectSamplePitch,
        processSinging,
        processSpoon,
        prepareVocal: playbackFns.prepareVocal,
        getAlignment: playbackFns.getAlignment,
        setAlignment: playbackFns.setAlignment,
        setSustainMode,
        setSustainGrainSize,
        getMultisampleBank: playbackFns.getMultisampleBank,
        isMultisampleReady: playbackFns.isMultisampleReady,
        setHarmonizerConfig,
        updateSamplerVoiceParams,
        triggerTapeStop,
        resetTapeStop
    };
}
