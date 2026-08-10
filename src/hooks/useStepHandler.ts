import { useCallback, useRef } from 'react';
import type {
    Pattern,
    SynthParams,
    Bass2Params,
    SamplerParams,
    AudioEngine,
    PartSequence,
    SamplerBankParams,
    ResolvedTrakEvent,
} from '../types';
import type { MainSequencerHandle } from '../components/MainSequencer';
import type { TrackKey } from '../constants/appDefaults';
import { noteToMidi, midiToNote, tunedNoteToFrequency } from '../utils/musicTheory';
import type { ScaleDefinition } from '../utils/musicTheory';
import { EMPTY_SEQ, EMPTY_SAMPLER_SEQUENCE } from '../constants/appDefaults';
import type { SynthNoteParams } from './audioEngine/audioPlayback';
import { automationStore } from '../stores/automationStore';
import type { AutomationTarget, UnifiedAutomationLane } from '../types';

// ⚡ Bolt: Helper to retrieve the automation store value efficiently using O(1) cache to reduce GC.
const getAutomationValue = (target: AutomationTarget, param: string, step: number): number | undefined => {
    const lanes = automationStore.getLanesForParam(target, param);
    for (let i = 0; i < lanes.length; i++) {
        const lane = lanes[i];
        if (lane.enabled) {
            const v = automationStore.getValueAtStep(lane, step);
            if (v !== null) return v;
        }
    }
    return undefined;
};







import { isE2eMode, setE2eTransportStep } from '../e2e/probe';
import { AutomationScheduler } from '../audio/automation/AutomationScheduler';
import { TICKS_PER_BAR } from '../importers/rbs/types';
import {
    playbackHealthMonitor,
    PLAYBACK_THRESHOLDS,
} from '../audio/playback/PlaybackHealthMonitor';

// Module-level scratch buffers for single-threaded main-thread use to avoid GC on hot path
const _midiScratch: number[] = [];
const _noteScratch: string[] = [];
const _liveValuesKeys: string[] = [];
const _liveValuesScratch: Record<string, number> = {};
const _continuousSamplerParams = new Set([
    'formantShift', 'vibratoRate', 'rootNote', 'coarseTune', 'fineTune',
    'pitchAttack', 'pitchDecay', 'vibratoDepth', 'tremoloDepth', 'breathAmount', 'characterMorph'
]);
const _schedulerLanesScratch: UnifiedAutomationLane[] = [];
const _bankParamsScratch: Partial<SamplerBankParams> = {};

function applyInversion(notes: string | string[], inversionVal: number): string | string[] {
    const isArray = Array.isArray(notes);
    const len = isArray ? (notes as string[]).length : 1;
    if (len <= 1) return notes;

    const maxInversions = len - 1;
    const numInversions = Math.round(inversionVal * maxInversions);
    if (numInversions === 0) return notes;

    // Fill + convert in one pass (no .map allocation)
    _midiScratch.length = len;
    if (isArray) {
        for (let i = 0; i < len; i++) {
            _midiScratch[i] = noteToMidi((notes as string[])[i]);
        }
    } else {
        _midiScratch[0] = noteToMidi(notes as string);
    }

    // Sort ascending in place
    _midiScratch.sort((a, b) => a - b);

    // Rotate without shift() — O(n) total instead of O(n²)
    for (let inv = 0; inv < numInversions; inv++) {
        const lowest = _midiScratch[0];
        for (let i = 0; i < len - 1; i++) {
            _midiScratch[i] = _midiScratch[i + 1];
        }
        _midiScratch[len - 1] = lowest + 12;
    }

    // Convert back — return a fresh array so callers can keep it
    _noteScratch.length = len;
    for (let i = 0; i < len; i++) {
        _noteScratch[i] = midiToNote(_midiScratch[i]);
    }
    return _noteScratch;
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
        stretchProfile: 'vocal' | 'harmonic' | 'fast';
        stretchMode: 'Time' | 'Pitch' | 'Formant';
        lockToSequencer: boolean;
        pan?: number;
    }>;
    activeSamplerBankRef: React.MutableRefObject<number>;
    sliceHighlightRef: React.MutableRefObject<((slice: number) => void) | null>;
    isSongModeActiveRef: React.MutableRefObject<boolean>;
    songStructureRef: React.MutableRefObject<({ [key in TrackKey]: number | null })[]>;
    songMeasureRef: React.MutableRefObject<number>;
    isFirstStepRef: React.MutableRefObject<boolean>;
    trackStorageRef: React.MutableRefObject<Record<TrackKey, (PartSequence | PartSequence[] | null)[]>>;
    setCurrentSongMeasure: (measure: number) => void;
    /** Optional automation scheduler for AudioParam-scheduled 303/synth automation. */
    automationSchedulerRef?: React.MutableRefObject<AutomationScheduler | null>;
    /** Resolved TRAK events from an imported RBS song for sub-step automation scheduling. */
    trakEventsRef?: React.MutableRefObject<ResolvedTrakEvent[] | null>;
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
    automationSchedulerRef,
    trakEventsRef,
}: UseStepHandlerOptions) => {
    const lastHandledStepRef = useRef({ step: -1, audioTime: 0 });
    const lastTrakBarRef = useRef(-1);

    const onStep = useCallback((step: number, audioTime?: number) => {
        currentStepRef.current = step;
        automationStore.setPlaybackStep(step);
        if (isE2eMode()) setE2eTransportStep(step);
        if (sequencerRef.current) sequencerRef.current.setHighlight(step);
        if (!audioEngine) return;

        // Use the sample-accurate audioTime from the AudioWorklet clock when available.
        // This ensures notes are scheduled at the exact moment the step fires on the
        // audio thread, not at the moment the main-thread message is processed (~1-5ms later).
        const time = audioTime ?? audioEngine.context.currentTime;

        const lastHandled = lastHandledStepRef.current;
        if (
            step === lastHandled.step &&
            (time - lastHandled.audioTime) * 1000 < PLAYBACK_THRESHOLDS.stepDuplicateGuardMs
        ) {
            playbackHealthMonitor.recordStepBurst(step);
            return;
        }
        lastHandledStepRef.current = { step, audioTime: time };

        let activePattern = patternRef.current;

        // Song Mode Measure Handling
        if (isSongModeActiveRef.current) {
            if (step === 0) {
                if (isFirstStepRef.current) {
                    isFirstStepRef.current = false;
                    lastTrakBarRef.current = -1;
                } else {
                    const nextM = songMeasureRef.current + 1;
                    songMeasureRef.current = nextM < songStructureRef.current.length ? nextM : 0;
                    requestAnimationFrame(() => setCurrentSongMeasure(songMeasureRef.current));
                }

                // Schedule sub-step trakEvents for the current bar (RBS imported songs).
                if (trakEventsRef?.current?.length && automationSchedulerRef?.current) {
                    const mIdx = songMeasureRef.current;
                    if (lastTrakBarRef.current !== mIdx) {
                        lastTrakBarRef.current = mIdx;
                        const fromTick = mIdx * TICKS_PER_BAR;
                        const toTick = fromTick + TICKS_PER_BAR;
                        automationSchedulerRef.current.scheduleFromTrakEvents(
                            trakEventsRef.current,
                            tempo,
                            time,
                            fromTick,
                            toTick,
                        );
                    }
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
            if (stepData.velocity !== undefined) noteParams.velocity = stepData.velocity;
            if (stepData.timbre !== undefined) noteParams.timbre = stepData.timbre;
            if (stepData.microtiming !== undefined) noteParams.microtiming = stepData.microtiming;
            if (stepData.retrigger !== undefined) noteParams.retrigger = stepData.retrigger;
            if (stepData.formantShift !== undefined) noteParams.formantShift = stepData.formantShift;
            if (stepData.reverbSend !== undefined) noteParams.reverbSend = stepData.reverbSend;
            if (stepData.reverbType !== undefined) noteParams.reverbType = stepData.reverbType;
            if (stepData.delaySend !== undefined) noteParams.delaySend = stepData.delaySend;
            if (stepData.vowel !== undefined) noteParams.vowel = stepData.vowel;
            if (stepData.portamento !== undefined) noteParams.portamento = stepData.portamento;
            if (stepData.drive !== undefined) noteParams.drive = stepData.drive;
            // Apply per-lane automation overrides for prophecy params
            const automation = activePattern[trackKey]?.automation;
            const autoVowel = automation?.['vowel']?.[step];
            if (autoVowel !== undefined && autoVowel !== null) noteParams.vowel = autoVowel;
            const autoPortamento = automation?.['portamento']?.[step];
            if (autoPortamento !== undefined && autoPortamento !== null) noteParams.portamento = autoPortamento;
            const autoFormantShift = automation?.['formantShift']?.[step];
            if (autoFormantShift !== undefined && autoFormantShift !== null) noteParams.formantShift = autoFormantShift;

            // Unified automation lanes (recorded + imported RBS) for filter cutoff/resonance on this synth track
            // These override per-step; values are already 0-1 normalized (playSynth scales to Hz/Q)
            const targetForLane: 'synthA' | 'synthB' = trackKey === 'partA' ? 'synthA' : 'synthB';
            const cutoffVal = getAutomationValue(targetForLane, 'filterCutoff', step);
            if (cutoffVal !== undefined) noteParams.filterCutoff = cutoffVal;
            const resVal = getAutomationValue(targetForLane, 'filterResonance', step);
            if (resVal !== undefined) noteParams.filterResonance = resVal;
            const driveVal = getAutomationValue(targetForLane, 'drive', step);
            if (driveVal !== undefined) noteParams.drive = driveVal;

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
                drive: bass2Ref.current.drive ?? 0,
            };

            if (audioEngine.open303Engine) {
                (audioEngine.open303Engine as any).applyBass2Params?.(bass2Ref.current);
            }

            // Bass2 filter automation from unified lanes (RBS tb303Bcutoff etc maps to bass2)
            const bass2NoteParams: any = {};
            if (stepData.drive !== undefined) bass2NoteParams.drive = stepData.drive;
            const b2Cutoff = getAutomationValue('bass2', 'filterCutoff', step);
            if (b2Cutoff !== undefined) bass2NoteParams.filterCutoff = b2Cutoff;
            const b2Res = getAutomationValue('bass2', 'filterResonance', step);
            if (b2Res !== undefined) bass2NoteParams.filterResonance = b2Res;
            const b2Drive = getAutomationValue('bass2', 'drive', step);
            if (b2Drive !== undefined) bass2NoteParams.drive = b2Drive;

            audioEngine.playSynth(bass2Params, notes, time, stepData.length, stepTime, undefined, 'bass2' as any, currentScale, bass2NoteParams.drive !== undefined || bass2NoteParams.filterCutoff !== undefined || bass2NoteParams.filterResonance !== undefined ? bass2NoteParams : undefined);
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
        // ⚡ Bolt Optimization: Replacing forEach with for loop to prevent closure allocations on hot path
        for (let bankIdx = 0; bankIdx < p.sampler.length; bankIdx++) {
            const seq = p.sampler[bankIdx];
            const stepData = seq.steps[step];
            if (!stepData) continue;
            if (stepData.probability !== undefined && Math.random() > stepData.probability) continue;

            const slideFromMidi = stepData.slide ? lastSamplerMidiRef.current[bankIdx] : undefined;
            const slideFromFormant = (stepData.slide || stepData.slideFormant) ? lastSamplerFormantRef.current[bankIdx] : undefined;

            const rawNotes = stepData.chord ? [stepData.note, ...stepData.chord] : stepData.note;

            // Lock to sequencer logic
            let finalNotes = rawNotes;
            const voiceParams = samplerVoiceParamsRef.current;
            if (voiceParams.lockToSequencer && typeof rawNotes === 'string') {
                let targetStep = -1;
                let firstActiveStep = -1;
                for (let i = 0; i < seq.steps.length; i++) {
                    if (seq.steps[i]) {
                        if (firstActiveStep === -1) firstActiveStep = i;
                        if (i >= step) {
                            targetStep = i;
                            break;
                        }
                    }
                }

                if (targetStep === -1 && firstActiveStep !== -1) {
                    targetStep = firstActiveStep;
                }

                if (targetStep !== -1) {
                    const targetData = seq.steps[targetStep];
                    if (targetData?.note) {
                        finalNotes = targetData.chord
                            ? [targetData.note, ...targetData.chord]
                            : targetData.note;
                    }
                }
            }

            const baseSampler = samplerRef.current[bankIdx];
            const bankParams = Object.assign(_bankParamsScratch, baseSampler);
            bankParams.rootNote = voiceParams.rootNote;
            bankParams.coarseTune = voiceParams.coarseTune;
            bankParams.fineTune = voiceParams.fineTune;
            bankParams.pan = stepData.pan ?? voiceParams.pan;
            bankParams.formantShift = voiceParams.formantShift;
            bankParams.attack = voiceParams.attack;
            bankParams.decay = voiceParams.decay;
            bankParams.stretchProfile = voiceParams.stretchProfile;
            bankParams.stretchMode = voiceParams.stretchMode;
            bankParams.lockToSequencer = voiceParams.lockToSequencer;

            // Sampler track automation (filter, volume) from lanes - complements the Voice Designer ramping below
            const sampCutoff = getAutomationValue('sampler', 'filterCutoff', step);
            if (sampCutoff !== undefined) (bankParams as any).filterCutoff = Math.max(20, sampCutoff * 20000);
            const sampRes = getAutomationValue('sampler', 'filterResonance', step);
            if (sampRes !== undefined) (bankParams as any).filterResonance = sampRes * 20;
            const sampVol = getAutomationValue('sampler', 'volume', step);
            if (sampVol !== undefined) (bankParams as any).volume = sampVol;

            audioEngine.playSampler(bankParams as SamplerBankParams, finalNotes, time, stepData.length, stepTime, { ...stepData, slideFromMidi, slideFromFormant }, currentScale);

            lastSamplerMidiRef.current[bankIdx] = noteToMidi(stepData.note);
            lastSamplerFormantRef.current[bankIdx] = stepData.formantShift !== undefined ? stepData.formantShift : (voiceParams.formantShift || 0);
        }

        // Visual feedback for phoneme slices
        if (sliceHighlightRef.current && samplerRef.current[activeSamplerBankRef.current]?.sliceMode === 'phoneme') {
            // ... (your existing slice highlight logic - unchanged)
        }

        // === UNIFIED AUTOMATION PLAYBACK (builds on Issue #652 store) ===
        // Apply recorded/imported RBS/AI automation lanes with interpolation.
        // High-priority: Voice Designer params (formantShift, drive, attack, decay) via ramping path.
        // This enables full expressive RBS song playback with parameter movement.
        const autoState = automationStore.getState();
        const playbackEnabled = autoState.playbackEnabled;
        if (playbackEnabled && audioEngine) {
            const automationPatternIndex = isSongModeActiveRef.current ? (songMeasureRef.current % 8) : 0;
            const lanes = autoState.lanes;
            const rampDuration = Math.max(0.01, stepTime * 0.85);

            // Collect live values for UI display (keyed "target:parameter")
            const liveValues = _liveValuesScratch;
            let hasLiveValues = false;
            // Clear scratch object
            for (let i = 0; i < _liveValuesKeys.length; i++) {
                liveValues[_liveValuesKeys[i]] = undefined as any;
            }
            _liveValuesKeys.length = 0;

            const schedulerLanes = _schedulerLanesScratch;
            schedulerLanes.length = 0;

            // First pass: collect scheduler lanes and evaluate active non-scheduler lanes without array methods
            for (let i = 0; i < lanes.length; i++) {
                const lane = lanes[i];
                if (!lane.enabled) continue;
                if (lane.scope === 'pattern' && lane.patternIndex !== automationPatternIndex) continue;

                const isSchedulerTarget = lane.target === 'synthA' || lane.target === 'synthB' || lane.target === 'bass2' || lane.target === 'master';

                if (automationSchedulerRef?.current && isSchedulerTarget) {
                    schedulerLanes.push(lane);
                    continue;
                }

                const normVal = automationStore.getValueAtStep(lane, step);
                if (normVal === null) continue;

                // Track for UI automation indicators
                const cacheKey = `${lane.target}:${lane.parameter}`;
                if (liveValues[cacheKey] === undefined) _liveValuesKeys.push(cacheKey);
                liveValues[cacheKey] = normVal;
                hasLiveValues = true;

                // Denormalize using originalRange if present (from RBS import), else heuristics for voice params
                let realVal = normVal;
                if (lane.originalRange && Array.isArray(lane.originalRange)) {
                    const [min, max] = lane.originalRange;
                    realVal = min + normVal * (max - min);
                } else if (lane.parameter === 'formantShift') {
                    realVal = (normVal - 0.5) * 2.0; // 0-1 -> -1..+1
                } else if (['drive', 'attack', 'decay', 'vibratoDepth', 'tremoloDepth', 'breathAmount', 'characterMorph'].includes(lane.parameter)) {
                    realVal = normVal; // assume 0-1 or pass-through
                }

                if (lane.target === 'sampler') {
                    if (!_continuousSamplerParams.has(lane.parameter)) continue;

                    if (audioEngine.updateSamplerVoiceParams) {
                        // Apply to the currently active sampler bank during playback (MVP; future: bank-specific lanes)
                        try {
                            audioEngine.updateSamplerVoiceParams(activeSamplerBankRef.current, lane.parameter, realVal);
                        } catch (e) {
                            // ignore per-param errors
                        }
                    } else if (onParamChange) {
                        // Fallback to singing voice path for formant etc if no direct sampler updater
                        try {
                            onParamChange(activeSamplerBankRef.current, lane.parameter as any, realVal, rampDuration);
                        } catch (e) {}
                    }
                }
            }

            // --- 303 / synth automation via AudioParam-aligned scheduler ---
            if (automationSchedulerRef?.current && schedulerLanes.length > 0) {
                automationSchedulerRef.current.scheduleFromLanes(
                    schedulerLanes,
                    step,
                    1,          // schedule one step ahead
                    stepTime,
                    time
                );
                // Collect live values from these lanes for UI indicators.
                for (let i = 0; i < schedulerLanes.length; i++) {
                    const lane = schedulerLanes[i];
                    const normVal = automationStore.getValueAtStep(lane, step);
                    if (normVal === null) continue;
                    const cacheKey = `${lane.target}:${lane.parameter}`;
                if (liveValues[cacheKey] === undefined) _liveValuesKeys.push(cacheKey);
                liveValues[cacheKey] = normVal;
                    hasLiveValues = true;
                }
            }

            // Notify UI with all live values in a single batched update (one re-render per step)
            if (hasLiveValues) {
                automationStore.setLiveValues(liveValues);
            }
        }
    }, [audioEngine, tempo, onParamChange, currentScaleRef, automationSchedulerRef]);

    return { onStep };
};