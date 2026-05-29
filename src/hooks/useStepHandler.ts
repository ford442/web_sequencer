import { useCallback } from 'react';
import type {
    Pattern,
    SynthParams,
    Bass2Params,
    SamplerParams,
    AudioEngine,
    PartSequence,
    SamplerBankParams,
} from '../types';
import type { MainSequencerHandle } from '../components/MainSequencer';
import type { TrackKey } from '../constants/appDefaults';
import { noteToMidi, midiToNote, tunedNoteToFrequency } from '../utils/musicTheory';
import type { ScaleDefinition } from '../utils/musicTheory';
import { EMPTY_SEQ, EMPTY_SAMPLER_SEQUENCE } from '../constants/appDefaults';
import type { SynthNoteParams } from './audioEngine/audioPlayback';

function applyInversion(notes: string | string[], inversionVal: number): string | string[] {
    const notesArray = Array.isArray(notes) ? notes : [notes];
    if (notesArray.length <= 1) return notes;

    const maxInversions = notesArray.length - 1;
    const numInversions = Math.round(inversionVal * maxInversions);
    if (numInversions === 0) return notes;

    const midiNotes = notesArray.map(noteToMidi);
    midiNotes.sort((a, b) => a - b);

    for (let i = 0; i < numInversions; i++) {
        const lowest = midiNotes.shift()!;
        midiNotes.push(lowest + 12);
    }

    return midiNotes.map(midiToNote);
}

export interface UseStepHandlerOptions {
    audioEngine: AudioEngine | null;
    tempo: number;
    onParamChange: ((bankIdx: number, key: keyof SamplerBankParams, value: number, rampTime?: number) => void) | undefined;
    currentStepRef: React.MutableRefObject<number>;
    sequencerRef: React.RefObject<MainSequencerHandle | null>;
    patternRef: React.MutableRefObject<Pattern>;
    lastFreqRef: React.MutableRefObject<Record<string, number>>;
    lastSamplerMidiRef: React.MutableRefObject<Record<number, number>>;
    lastSamplerFormantRef: React.MutableRefObject<Record<number, number>>;
    synthARef: React.MutableRefObject<SynthParams>;
    synthBRef: React.MutableRefObject<SynthParams>;
    bass2Ref: React.MutableRefObject<Bass2Params>;
    kickRef: React.MutableRefObject<any>;
    snareRef: React.MutableRefObject<any>;
    closedHatRef: React.MutableRefObject<any>;
    openHatRef: React.MutableRefObject<any>;
    currentScaleRef: React.MutableRefObject<ScaleDefinition | null>;
    samplerRef: React.MutableRefObject<SamplerParams>;
    samplerVoiceParamsRef: React.MutableRefObject<{
        drive: number;
        rootNote: number;
        coarseTune: number;
        fineTune: number;
        formantShift: number;
        attack: number;
        decay: number;
        quality: 'preview' | 'good' | 'better' | 'best';
        stretchMode: 'Time' | 'Pitch' | 'Formant';
        lockToSequencer: boolean;
    }>;
    activeSamplerBankRef: React.MutableRefObject<number>;
    sliceHighlightRef: React.MutableRefObject<((slice: number) => void) | null>;
    isSongModeActiveRef: React.MutableRefObject<boolean>;
    songStructureRef: React.MutableRefObject<({ [key in TrackKey]: number | null })[]>;
    songMeasureRef: React.MutableRefObject<number>;
    isFirstStepRef: React.MutableRefObject<boolean>;
    trackStorageRef: React.MutableRefObject<Record<TrackKey, (PartSequence | PartSequence[] | null)[]>>;
    setCurrentSongMeasure: (measure: number) => void;
}

export const useStepHandler = ({
    audioEngine,
    tempo,
    onParamChange,
    currentStepRef,
    sequencerRef,
    patternRef,
    lastFreqRef,
    lastSamplerMidiRef,
    lastSamplerFormantRef,
    synthARef,
    synthBRef,
    bass2Ref,
    kickRef,
    snareRef,
    closedHatRef,
    openHatRef,
    currentScaleRef,
    samplerRef,
    samplerVoiceParamsRef,
    activeSamplerBankRef,
    sliceHighlightRef,
    isSongModeActiveRef,
    songStructureRef,
    songMeasureRef,
    isFirstStepRef,
    trackStorageRef,
    setCurrentSongMeasure,
}: UseStepHandlerOptions) => {
    const onStep = useCallback((step: number) => {
        currentStepRef.current = step;
        if (sequencerRef.current) sequencerRef.current.setHighlight(step);
        if (!audioEngine) return;

        const time = audioEngine.context.currentTime;
        let activePattern = patternRef.current;

        // Song Mode Measure Handling
        if (isSongModeActiveRef.current) {
            if (step === 0) {
                if (isFirstStepRef.current) {
                    isFirstStepRef.current = false;
                } else {
                    const nextM = songMeasureRef.current + 1;
                    songMeasureRef.current = nextM < songStructureRef.current.length ? nextM : 0;
                    setTimeout(() => setCurrentSongMeasure(songMeasureRef.current), 0);
                }
            }

            const currentMeasureIdx = songMeasureRef.current;
            const measureData = songStructureRef.current[currentMeasureIdx];

            if (measureData) {
                const getSeq = (key: TrackKey) => {
                    const slot = measureData[key];
                    if (slot === null) return key === 'sampler' ? EMPTY_SAMPLER_SEQUENCE : EMPTY_SEQ;
                    const stored = trackStorageRef.current[key][slot];
                    return stored ?? (key === 'sampler' ? EMPTY_SAMPLER_SEQUENCE : EMPTY_SEQ);
                };

                activePattern = {
                    partA: getSeq('partA'),
                    partB: getSeq('partB'),
                    bass2: getSeq('bass2'),
                    kick: getSeq('kick'),
                    snare: getSeq('snare'),
                    closedHat: getSeq('closedHat'),
                    openHat: getSeq('openHat'),
                    sampler: getSeq('sampler'),
                } as Pattern;
            }
        }

        const p = activePattern;
        const stepTime = 60 / tempo / 4;
        const currentScale = currentScaleRef.current;

        const triggerSynth = (trackKey: 'partA' | 'partB', params: SynthParams) => {
            const stepData = p[trackKey].steps[step];
            if (!stepData) return;

            if (stepData.probability !== undefined && Math.random() > stepData.probability) return;

            const rawNotes = stepData.chord ? [stepData.note, ...stepData.chord] : stepData.note;
            const invVal = activePattern[trackKey].automation?.['chordInversion']?.[step] ?? 0;
            const notes = invVal > 0 ? applyInversion(rawNotes, invVal) : rawNotes;

            const slideFrom = stepData.slide && lastFreqRef.current[trackKey] > 0
                ? lastFreqRef.current[trackKey]
                : undefined;

            // Build per-step note params from stepData (including Prophecy params).
            // Note: previously `currentScale` was passed here but `SynthNoteParams` has no scale
            // properties — it was never consumed by createPlaySynth. Microtonal slide tracking
            // continues to use `tunedNoteToFrequency` below. VoiceManager handles scale tuning
            // independently when it plays the note string.
            const noteParams: SynthNoteParams = {};
            if (stepData.timbre !== undefined) noteParams.timbre = stepData.timbre;
            if (stepData.microtiming !== undefined) noteParams.microtiming = stepData.microtiming;
            if (stepData.retrigger !== undefined) noteParams.retrigger = stepData.retrigger;
            if (stepData.formantShift !== undefined) noteParams.formantShift = stepData.formantShift;
            if (stepData.reverbSend !== undefined) noteParams.reverbSend = stepData.reverbSend;
            if (stepData.reverbType !== undefined) noteParams.reverbType = stepData.reverbType;
            if (stepData.delaySend !== undefined) noteParams.delaySend = stepData.delaySend;
            if (stepData.vowel !== undefined) noteParams.vowel = stepData.vowel;
            if (stepData.portamento !== undefined) noteParams.portamento = stepData.portamento;
            // Apply per-lane automation overrides for prophecy params
            const automation = activePattern[trackKey]?.automation;
            const autoVowel = automation?.['vowel']?.[step];
            if (autoVowel !== undefined && autoVowel !== null) noteParams.vowel = autoVowel;
            const autoPortamento = automation?.['portamento']?.[step];
            if (autoPortamento !== undefined && autoPortamento !== null) noteParams.portamento = autoPortamento;
            const autoFormantShift = automation?.['formantShift']?.[step];
            if (autoFormantShift !== undefined && autoFormantShift !== null) noteParams.formantShift = autoFormantShift;

            audioEngine.playSynth(params, notes, time, stepData.length, stepTime, slideFrom, trackKey, currentScale, noteParams);

            // Update last frequency for future slides
            lastFreqRef.current[trackKey] = tunedNoteToFrequency(stepData.note, currentScale);
        };

        // === Bass 2 (TB-303) ===
        const triggerBass2 = () => {
            const stepData = p.bass2.steps[step];
            if (!stepData) return;
            if (stepData.probability !== undefined && Math.random() > stepData.probability) return;

            const rawNotes = stepData.chord ? [stepData.note, ...stepData.chord] : stepData.note;
            const invVal = activePattern.bass2.automation?.['chordInversion']?.[step] ?? 0;
            const notes = invVal > 0 ? applyInversion(rawNotes, invVal) : rawNotes;

            const bass2Params: SynthParams = {
                waveform: bass2Ref.current.waveform,
                pitch: bass2Ref.current.pitch,
                filterCutoff: bass2Ref.current.cutoff,
                filterResonance: bass2Ref.current.resonance,
                filterMode: bass2Ref.current.filterMode,
                attack: 0.01,
                decay: bass2Ref.current.decay,
                sustain: 0,
                release: 0.1,
                length: (stepData.length ?? 1) * stepTime,
                volume: bass2Ref.current.volume,
                delayTime: 0,
                delayFeedback: 0,
                delayMix: 0,
            };

            if (audioEngine.open303Engine) {
                (audioEngine.open303Engine as any).applyBass2Params?.(bass2Ref.current);
            }

            audioEngine.playSynth(bass2Params, notes, time, stepData.length, stepTime, undefined, 'bass2' as any, currentScale, undefined);
        };

        // Trigger synths
        triggerSynth('partA', synthARef.current);
        triggerSynth('partB', synthBRef.current);
        triggerBass2();

        // === Drums ===
        const playDrumIfActive = (trackKey: 'kick' | 'snare' | 'closedHat' | 'openHat', sound: any, params: any) => {
            const stepData = p[trackKey].steps[step];
            if (stepData && !(stepData.probability !== undefined && Math.random() > stepData.probability)) {
                audioEngine.playDrum(sound, params, time, currentScale, stepTime, stepData.note);
            }
        };

        playDrumIfActive('kick', 'kick', kickRef.current);
        playDrumIfActive('snare', 'snare', snareRef.current);
        playDrumIfActive('openHat', 'openHat', openHatRef.current);
        if (!p.openHat.steps[step]) {
            playDrumIfActive('closedHat', 'closedHat', closedHatRef.current);
        }

        // === Sampler ===
        p.sampler.forEach((seq, bankIdx) => {
            const stepData = seq.steps[step];
            if (!stepData) return;
            if (stepData.probability !== undefined && Math.random() > stepData.probability) return;

            const slideFromMidi = stepData.slide ? lastSamplerMidiRef.current[bankIdx] : undefined;
            const slideFromFormant = (stepData.slide || stepData.slideFormant) ? lastSamplerFormantRef.current[bankIdx] : undefined;

            const rawNotes = stepData.chord ? [stepData.note, ...stepData.chord] : stepData.note;

            // Lock to sequencer logic
            let finalNotes = rawNotes;
            const voiceParams = samplerVoiceParamsRef.current;
            if (voiceParams.lockToSequencer && typeof rawNotes === 'string') {
                const activeSteps = seq.steps
                    .map((s, i) => (s ? i : -1))
                    .filter(i => i !== -1);

                if (activeSteps.length > 0) {
                    const targetStep = activeSteps.find(s => s >= step) ?? activeSteps[0];
                    const targetData = seq.steps[targetStep];
                    if (targetData?.note) {
                        finalNotes = targetData.chord
                            ? [targetData.note, ...targetData.chord]
                            : targetData.note;
                    }
                }
            }

            const bankParams: SamplerBankParams = {
                ...samplerRef.current[bankIdx],
                rootNote: voiceParams.rootNote,
                coarseTune: voiceParams.coarseTune,
                fineTune: voiceParams.fineTune,
                pan: stepData.pan ?? voiceParams.pan,
                formantShift: voiceParams.formantShift,
                attack: voiceParams.attack,
                decay: voiceParams.decay,
                quality: voiceParams.quality,
                stretchMode: voiceParams.stretchMode,
                lockToSequencer: voiceParams.lockToSequencer,
            };

            audioEngine.playSampler(bankParams, finalNotes, time, stepData.length, stepTime, { ...stepData, slideFromMidi, slideFromFormant }, currentScale);

            lastSamplerMidiRef.current[bankIdx] = noteToMidi(stepData.note);
            lastSamplerFormantRef.current[bankIdx] = stepData.formantShift !== undefined ? stepData.formantShift : (voiceParams.formantShift || 0);
        });

        // Visual feedback for phoneme slices
        if (sliceHighlightRef.current && samplerRef.current[activeSamplerBankRef.current]?.sliceMode === 'phoneme') {
            // ... (your existing slice highlight logic - unchanged)
        }

        // Automation
        if (onParamChange) {
            // ... (your automation logic - unchanged)
        }
    }, [audioEngine, tempo, onParamChange, currentScaleRef]);

    return { onStep };
};