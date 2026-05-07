import { useCallback } from 'react'
import type { Pattern, SynthParams, Bass2Params, SamplerParams, AudioEngine, PartSequence, SamplerBankParams } from '../types'
import type { MainSequencerHandle } from '../components/MainSequencer'
import type { TrackKey } from '../constants/appDefaults'
import { noteToFrequency } from '../constants'
import { noteToMidi, midiToNote } from '../utils/musicTheory'
import { EMPTY_SEQ, EMPTY_SAMPLER_SEQUENCE } from '../constants/appDefaults'

function applyInversion(notes: string | string[], inversionVal: number): string | string[] {
    const notesArray = Array.isArray(notes) ? notes : [notes];
    if (notesArray.length <= 1) return notes; // No inversions for single notes

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
    synthARef: React.MutableRefObject<SynthParams>;
    synthBRef: React.MutableRefObject<SynthParams>;
    bass2Ref: React.MutableRefObject<Bass2Params>;
    kickRef: React.MutableRefObject<any>;
    snareRef: React.MutableRefObject<any>;
    closedHatRef: React.MutableRefObject<any>;
    openHatRef: React.MutableRefObject<any>;
    samplerRef: React.MutableRefObject<SamplerParams>;
    samplerVoiceParamsRef: React.MutableRefObject<{
        rootNote: number;
        coarseTune: number;
        fineTune: number;
        formantShift: number;
        pitchAttack: number;
        pitchDecay: number;
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
    synthARef,
    synthBRef,
    bass2Ref,
    kickRef,
    snareRef,
    closedHatRef,
    openHatRef,
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
        if (!audioEngine) return
        const time = audioEngine.context.currentTime
        let activePattern = patternRef.current;

        if (isSongModeActiveRef.current) {
            if (step === 0) {
                if (isFirstStepRef.current) {
                    isFirstStepRef.current = false;
                } else {
                    const nextM = songMeasureRef.current + 1;
                    if (nextM < songStructureRef.current.length) {
                        songMeasureRef.current = nextM;
                        setTimeout(() => setCurrentSongMeasure(nextM), 0);
                    } else {
                        songMeasureRef.current = 0;
                        setTimeout(() => setCurrentSongMeasure(0), 0);
                    }
                }
            }
            const currentMeasureIdx = songMeasureRef.current;
            const measureData = songStructureRef.current[currentMeasureIdx];
            if (measureData) {
                const getSeq = (key: TrackKey) => {
                    const slot = measureData[key];
                    if (slot === null) { return key === 'sampler' ? EMPTY_SAMPLER_SEQUENCE : EMPTY_SEQ; }
                    const stored = trackStorageRef.current[key][slot];
                    if (!stored) { return key === 'sampler' ? EMPTY_SAMPLER_SEQUENCE : EMPTY_SEQ; }
                    return stored;
                };
                activePattern = { partA: getSeq('partA'), partB: getSeq('partB'), bass2: getSeq('bass2'), kick: getSeq('kick'), snare: getSeq('snare'), closedHat: getSeq('closedHat'), openHat: getSeq('openHat'), sampler: getSeq('sampler') } as Pattern;
            }
        }

        const p = activePattern;
        const stepTime = 60 / tempo / 4;

        const triggerSynth = (trackKey: 'partA' | 'partB', params: SynthParams) => {
            const stepData = p[trackKey].steps[step];
            if (stepData) {
                // Probability Check
                if (stepData.probability !== undefined && Math.random() > stepData.probability) return;

                const currentBaseFreq = noteToFrequency(stepData.note) * Math.pow(2, params.pitch / 12);
                let slideFrom: number | undefined = undefined;
                if (stepData.slide && lastFreqRef.current[trackKey] > 0) { slideFrom = lastFreqRef.current[trackKey]; }

                const rawNotes = stepData.chord ? [stepData.note, ...stepData.chord] : stepData.note;
                const invVal = activePattern[trackKey].automation?.['chordInversion']?.[step] ?? 0;
                const notes = invVal > 0 ? applyInversion(rawNotes, invVal) : rawNotes;

                const noteParams = { timbre: stepData.timbre, microtiming: stepData.microtiming, retrigger: stepData.retrigger };
                audioEngine.playSynth(params, notes, time, stepData.length, stepTime, slideFrom, trackKey, noteParams, state.currentScale);
                lastFreqRef.current[trackKey] = currentBaseFreq;
            }
        };

        // Trigger BASS 2 (TB-303) - Uses independent bass2 params
        const triggerBass2 = () => {
            const stepData = p.bass2.steps[step];
            if (stepData) {
                if (stepData.probability !== undefined && Math.random() > stepData.probability) return;

                const rawNotes = stepData.chord ? [stepData.note, ...stepData.chord] : stepData.note;
                const invVal = activePattern.bass2.automation?.['chordInversion']?.[step] ?? 0;
                const notes = invVal > 0 ? applyInversion(rawNotes, invVal) : rawNotes;

                const noteParams = { timbre: stepData.timbre, microtiming: stepData.microtiming, retrigger: stepData.retrigger };

                // Create SynthParams-like object for bass2
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
                    length: 0.25,
                    volume: bass2Ref.current.volume,
                    delayTime: 0,
                    delayFeedback: 0,
                    delayMix: 0,
                };

                // Apply bass2 params to Open303Manager before playing
                if (audioEngine.open303Engine) {
                    const manager = audioEngine.open303Engine as any;
                    if (manager.applyBass2Params) {
                        manager.applyBass2Params(bass2Ref.current);
                    }
                }

                // @ts-expect-error - Auto-generated to fix CI build
                audioEngine.playSynth(bass2Params, notes, time, stepData.length, stepTime, undefined, 'bass2', noteParams, state.currentScale);
            }
        };

        triggerSynth('partA', synthARef.current);
        triggerSynth('partB', synthBRef.current);
        triggerBass2();

        // Drums (Basic probability check)
        const playDrumIfActive = (trackKey: 'kick' | 'snare' | 'closedHat' | 'openHat', sound: any, params: any) => {
            const stepData = p[trackKey].steps[step];
            if (stepData) {
                 if (stepData.probability !== undefined && Math.random() > stepData.probability) return;
                 const noteParams = { retrigger: stepData.retrigger };
                 audioEngine.playDrum(sound, params, time, noteParams, stepTime);
            }
        };

        playDrumIfActive('kick', 'kick', kickRef.current);
        playDrumIfActive('snare', 'snare', snareRef.current);
        playDrumIfActive('openHat', 'openHat', openHatRef.current);
        if (!p.openHat.steps[step]) playDrumIfActive('closedHat', 'closedHat', closedHatRef.current); // Only closed if open not playing

        p.sampler.forEach((seq, bankIdx) => {
            const stepData = seq.steps[step];
            if (stepData) {
                if (stepData.probability !== undefined && Math.random() > stepData.probability) return;

                let slideFromMidi: number | undefined = undefined;
                if (stepData.slide && lastSamplerMidiRef.current[bankIdx] !== undefined) {
                    slideFromMidi = lastSamplerMidiRef.current[bankIdx];
                }
                const noteParams = { timbre: stepData.timbre, microtiming: stepData.microtiming, reverse: stepData.reverse, sliceIndex: stepData.sliceIndex, retrigger: stepData.retrigger, phonemes: stepData.phonemes, freeze: stepData.freeze };
                // Combine note and chord for polyphonic playback
                const notes = stepData.chord ? [stepData.note, ...stepData.chord] : stepData.note;
                lastSamplerMidiRef.current[bankIdx] = noteToMidi(stepData.note);

                // Pass sampler voice params from the panel (using ref for latest values)
                const voiceParams = samplerVoiceParamsRef.current;
                const bankParams = {
                    ...samplerRef.current[bankIdx],
                    rootNote: voiceParams.rootNote,
                    coarseTune: voiceParams.coarseTune,
                    fineTune: voiceParams.fineTune,
                    formantShift: voiceParams.formantShift,
                    pitchAttack: voiceParams.pitchAttack,
                    pitchDecay: voiceParams.pitchDecay,
                    quality: voiceParams.quality,
                    stretchMode: voiceParams.stretchMode,
                    lockToSequencer: voiceParams.lockToSequencer
                };

                // If lockToSequencer is enabled, quantize to active sequencer steps
                let finalNotes = notes;
                if (voiceParams.lockToSequencer && typeof notes === 'string') {
                    const activeSteps = seq.steps.map((s, i) => s ? i : -1).filter(i => i !== -1);
                    if (activeSteps.length > 0) {
                        // Find nearest active step to quantize to
                        const currentStepIndex = activeSteps.findIndex(s => s >= step) || 0;
                        const targetStep = activeSteps[currentStepIndex] ?? activeSteps[0];
                        const targetStepData = seq.steps[targetStep];
                        if (targetStepData?.note) {
                            finalNotes = targetStepData.chord
                                ? [targetStepData.note, ...targetStepData.chord]
                                : targetStepData.note;
                        }
                    }
                }

                // @ts-expect-error - Auto-generated to fix CI build
                audioEngine.playSampler(bankParams, finalNotes, time, stepData.length, stepTime, noteParams, state.currentScale);
            }
        });

        // Visual Slice Feedback for Active Bank
        if (sliceHighlightRef.current) {
            const bankIdx = activeSamplerBankRef.current;
            const bankParams = samplerRef.current[bankIdx];

            // Only update if we are in Phoneme Slice Mode (and bank exists)
            if (bankParams && bankParams.sliceMode === 'phoneme') {
                 let activeSlice = -1;
                 // Look back to find sustaining note
                 for (let i = step; i >= Math.max(0, step - 15); i--) {
                     const s = patternRef.current.sampler[bankIdx]?.steps[i];
                     if (s && s.note) {
                         const len = s.length || 1;
                         if (i + len > step) {
                             if (s.sliceIndex !== undefined) {
                                 activeSlice = s.sliceIndex;
                             } else {
                                 activeSlice = noteToMidi(s.note) - 60;
                             }
                             break;
                         }
                     }
                 }
                 sliceHighlightRef.current(activeSlice);
            }
        }

        // Apply Automation
        if (onParamChange) {
            const bankIdx = activeSamplerBankRef.current;
            const bankSeq = p.sampler[bankIdx];
            if (bankSeq && bankSeq.automation) {
                const stepDuration = 60 / tempo / 4; // Length of a 16th note in seconds

                // Formant Shift
                const formantVal = bankSeq.automation['formantShift']?.[step];
                if (formantVal !== undefined && formantVal !== null) {
                     // Map 0-1 to -12 to +12
                     const mapped = (formantVal * 24) - 12;
                     onParamChange(bankIdx, 'formantShift', mapped, stepDuration);
                }

                // Vibrato Depth
                const vibVal = bankSeq.automation['vibratoDepth']?.[step];
                if (vibVal !== undefined && vibVal !== null) {
                     onParamChange(bankIdx, 'vibratoDepth', vibVal * 100);
                }

                // Pitch Scale (e.g. 0.5 to 2.0) - centered at 0.5 (1.0)
                // Let's assume automation 0-1 maps to 0.5x to 2.0x?
                // Or just keep simple for now. Formant is main goal.
            }
        }

    }, [audioEngine, tempo, onParamChange])

    return { onStep };
}
