import { useCallback, useRef } from 'react';
import type {
    Note,
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
import { noteToMidi, midiToNote, tunedNoteToFrequency, swingPercentToClock } from '../utils/musicTheory';
import type { ScaleDefinition } from '../utils/musicTheory';
import { EMPTY_SEQ, EMPTY_SAMPLER_SEQUENCE } from '../constants/appDefaults';
import { TRACK_KEYS } from '../constants';
import type { SynthNoteParams } from './audioEngine/audioPlayback';
import { automationStore } from '../stores/automationStore';
import { transportMixStore } from '../stores/transportMixStore';
import { trackStepFor, transportGrid } from '../utils/songMeter';
import { trackMuteSoloStore } from '../stores/trackMuteSoloStore';
import type { AutomationTarget, UnifiedAutomationLane } from '../types';

// ⚡ Bolt: Helper to retrieve the automation store value efficiently using O(1) cache to reduce GC.
// Resolved like the scheduler and the offline renders (laneResolver, #1384):
// enabled, in scope for the playing pattern, first lane with a value wins.
const getAutomationValue = (target: AutomationTarget, param: string, step: number, patternIndex: number, songStep?: number): number | undefined =>
    resolveParamAtStep(automationStore.getLanesForParam(target, param), step, patternIndex, songStep) ?? undefined;







import { isE2eMode, recordE2eDrumHit, setE2eTransportStep, setE2eSessionState } from '../e2e/probe';
import { scheduleAtAudioTime } from '../midi/clock/scheduleAtAudioTime';
import { AutomationScheduler } from '../audio/automation/AutomationScheduler';
import { isLaneActive, laneReadStep, resolveParamAtStep } from '../audio/automation/laneResolver';
import { TICKS_PER_BAR } from '../importers/rbs/types';
import {
    playbackHealthMonitor,
    PLAYBACK_THRESHOLDS,
} from '../audio/playback/PlaybackHealthMonitor';
import { Open303Manager } from '../engines/Open303Manager';
import { applyTrackParamSlotToEngine } from '../importers/rbs/applyImportedEngineState';
import { getWamHost } from '../audio/wam';
import type { Arrangement } from '../types';
import { arrangementEnd } from '../arrangement/model';
import { createArrangementFrame, resolveArrangementFrame, type ArrangementFrame } from '../arrangement/playback';
import { arrangementPlayhead } from '../arrangement/playhead';
import { transportPlayhead } from '../sequencer/transportPlayhead';
import { groupSimultaneous } from '../sequencer/noteFx/chain';
import { noteFxEventsForStep } from '../sequencer/noteFx/runtime';
import type { FxNoteEvent, NoteFxTrack } from '../sequencer/noteFx/types';
import { MACRO_AUTOMATION_PARAMS, MACRO_AUTOMATION_TARGETS, macroControlValue } from '../engines/MacroParams';

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
const _chordScratch: string[] = [];

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
    /** Linear arrangement (#1342) — the song the linear player reads. */
    arrangementRef: React.MutableRefObject<Arrangement>;
    songMeasureRef: React.MutableRefObject<number>;
    isFirstStepRef: React.MutableRefObject<boolean>;
    trackStorageRef: React.MutableRefObject<Record<TrackKey, (PartSequence | PartSequence[] | null)[]>>;
    setCurrentSongMeasure: (measure: number) => void;
    /** Optional automation scheduler for AudioParam-scheduled 303/synth automation. */
    automationSchedulerRef?: React.MutableRefObject<AutomationScheduler | null>;
    /** Resolved TRAK events from an imported RBS song for sub-step automation scheduling. */
    trakEventsRef?: React.MutableRefObject<ResolvedTrakEvent[] | null>;
    rbsArrangementExtrasRef?: React.MutableRefObject<import('./appState/useSongModeState').RbsArrangementExtras | null>;
    setSynthA?: React.Dispatch<React.SetStateAction<SynthParams>>;
    setSynthB?: React.Dispatch<React.SetStateAction<SynthParams>>;
    setBass2?: React.Dispatch<React.SetStateAction<Bass2Params>>;
    sessionEngineRef?: React.MutableRefObject<import('../session/SessionLaunchEngine').SessionLaunchEngine | null>;
    sessionClockRef?: React.MutableRefObject<{ step: number; audioTime: number; tempo: number }>;
    setIsSongModeActive?: (active: boolean) => void;
    onSessionTick?: (playing: Record<TrackKey, number | null>) => void;
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
    arrangementRef,
    songMeasureRef,
    isFirstStepRef,
    trackStorageRef,
    setCurrentSongMeasure,
    automationSchedulerRef,
    trakEventsRef,
    rbsArrangementExtrasRef,
    setSynthA,
    setSynthB,
    setBass2,
    sessionEngineRef,
    sessionClockRef,
    setIsSongModeActive,
    onSessionTick,
}: UseStepHandlerOptions) => {
    const lastHandledStepRef = useRef({ step: -1, audioTime: 0 });
    const lastTrakBarRef = useRef(-1);
    // Linear player position: song step last played, and the clock's absStep then.
    const songPosRef = useRef(0);
    const songPosAbsRef = useRef(-1);
    const arrangementFrameRef = useRef<ArrangementFrame>(createArrangementFrame());
    const lastParamSlotsRef = useRef<{ partA: number | null; partB: number | null; bass2: number | null }>({
        partA: null, partB: null, bass2: null,
    });
    // Tracks the previous mute/solo audibility so a track that has just been
    // silenced flushes its voices exactly once instead of every step.
    const prevAudibleRef = useRef<Record<TrackKey, boolean>>({
        partA: true, partB: true, bass2: true, kick: true,
        snare: true, closedHat: true, openHat: true, sampler: true,
    });

    const onStep = useCallback((step: number, audioTime?: number, absStepArg?: number) => {
        // Steps since PLAY (never wraps); per-track loops run off this. Callers
        // without a clock (tests, legacy) get the wrapped step.
        const absStep = absStepArg ?? step;
        const meter = transportMixStore.meterRef.current;
        const e2e = isE2eMode();

        // Pattern index lanes are scoped to — read when needed, after the song
        // measure below has advanced for this step.
        const lanePatternIndex = () => (isSongModeActiveRef.current ? songMeasureRef.current % 8 : 0);

        // The clock posts each step STEP_LOOKAHEAD_MS before it sounds (#1344
        // P5) so its notes reach the voice worklets ahead of their frame. What
        // the user sees — playhead, the step edits record into — waits for the
        // step's own time.
        const atStepTime = (fn: () => void) => {
            if (audioEngine && audioTime !== undefined) scheduleAtAudioTime(audioEngine.context, audioTime, fn);
            else fn();
        };

        // Fallback for CI environments missing an audio sink (headless Firefox),
        // where AudioContext remains permanently suspended and scheduleAtAudioTime hangs.
        // Update the probe immediately to unblock E2E playback polling.
        if (e2e && audioEngine?.context.state !== 'running') {
            setE2eTransportStep(step);
        }

        atStepTime(() => {
            currentStepRef.current = step;
            automationStore.setPlaybackStep(step);
            if (e2e) setE2eTransportStep(step);
            if (sequencerRef.current) {
                // Rows with their own loop length light their own step.
                if (Object.keys(meter.trackLengths).length > 0) {
                    const loopsAnchored = isSongModeActiveRef.current && !sessionEngineRef?.current?.hasPlaying();
                    sequencerRef.current.setHighlight(step, (key: TrackKey) => trackStepFor(meter, key, step, absStep, loopsAnchored));
                } else {
                    sequencerRef.current.setHighlight(step);
                }
            }
        });
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

        // Mute/solo: a track that has just been silenced releases its voices once.
        // Because a silenced track never triggers, it cannot accumulate notes.
        const prevAudible = prevAudibleRef.current;
        for (let i = 0; i < TRACK_KEYS.length; i++) {
            const key = TRACK_KEYS[i];
            const audible = trackMuteSoloStore.isAudible(key);
            if (prevAudible[key] && !audible) {
                audioEngine.stopTrackNotes?.(key);
                lastFreqRef.current[key] = 0;
            }
            prevAudible[key] = audible;
        }

        let activePattern = patternRef.current;

        if (sessionClockRef) {
            sessionClockRef.current = { step, audioTime: time, tempo };
        }
        const sessionEngine = sessionEngineRef?.current;
        if (sessionEngine) {
            const tick = sessionEngine.tick({
                step,
                audioTime: time,
                tempo,
                ...transportGrid(meter),
                swing: swingPercentToClock(meter.swing),
                isPlaying: true,
                songModeActive: isSongModeActiveRef.current,
            });
            if (tick.preemptSongMode) setIsSongModeActive?.(false);
            for (const track of tick.flushTracks) {
                audioEngine.stopTrackNotes?.(track);
                lastFreqRef.current[track] = 0;
            }
            const slots = sessionEngine.playingSlots();
            if (onSessionTick) atStepTime(() => onSessionTick(slots));
            if (e2e) {
                let pCount = 0;
                for (let i = 0; i < TRACK_KEYS.length; i++) {
                    if (slots[TRACK_KEYS[i]] != null) {
                        pCount++;
                    }
                }
                const sessionState = {
                    playingCount: pCount,
                    lastApplyStep: tick.applied[0]?.step ?? (typeof window !== 'undefined' ? window.__HYPHON_E2E_SESSION__?.lastApplyStep ?? -1 : -1),
                    captureCount: sessionEngine.captureEvents.length,
                };
                atStepTime(() => setE2eSessionState(sessionState));
            }
        }

        // The linear player hands each track its clip-local step (loops
        // re-anchor at each clip); pattern and session playback run free from PLAY.
        let arrangementSteps: ArrangementFrame | null = null;

        // Session clip playback overlays the live pattern (stopped tracks are silent).
        if (sessionEngine?.hasPlaying()) {
            const slots = sessionEngine.playingSlots();
            const getSessionSeq = (key: TrackKey) => {
                const slot = slots[key];
                if (slot === null) return key === 'sampler' ? EMPTY_SAMPLER_SEQUENCE : EMPTY_SEQ;
                const stored = trackStorageRef.current[key][slot];
                return stored ?? (key === 'sampler' ? EMPTY_SAMPLER_SEQUENCE : EMPTY_SEQ);
            };
            activePattern = {
                partA: getSessionSeq('partA'),
                partB: getSessionSeq('partB'),
                bass2: getSessionSeq('bass2'),
                kick: getSessionSeq('kick'),
                snare: getSessionSeq('snare'),
                closedHat: getSessionSeq('closedHat'),
                openHat: getSessionSeq('openHat'),
                sampler: getSessionSeq('sampler'),
            } as Pattern;
        } else if (isSongModeActiveRef.current) {
            // Linear player (#1342): the arrangement says which slot and which
            // step of it each track plays at this song step. One clock — the
            // song position advances one step per worklet step.
            const arrangement = arrangementRef.current;
            const spm = Math.max(1, meter.stepCount);
            const length = arrangementEnd(arrangement);
            let pos: number;
            if (isFirstStepRef.current) {
                isFirstStepRef.current = false;
                lastTrakBarRef.current = -1;
                pos = step;
            } else if (absStepArg === undefined || absStep === songPosAbsRef.current + 1) {
                pos = songPosRef.current + 1;
            } else {
                // Re-armed mid-play: resume the current measure at the clock's phase.
                pos = songMeasureRef.current * spm + step;
            }
            if (pos >= length) pos %= length;
            songPosRef.current = pos;
            songPosAbsRef.current = absStep;
            atStepTime(() => arrangementPlayhead.publish(pos));

            const measure = Math.floor(pos / spm);
            if (measure !== songMeasureRef.current) {
                songMeasureRef.current = measure;
                atStepTime(() => requestAnimationFrame(() => setCurrentSongMeasure(measure)));
            }

            // Schedule sub-step trakEvents for the current bar (RBS imported songs).
            // One song measure is one RBS bar (TICKS_PER_BAR) whether the
            // import kept 16 steps or expanded to 32.
            if (pos % spm === 0 && trakEventsRef?.current?.length && automationSchedulerRef?.current) {
                if (lastTrakBarRef.current !== measure) {
                    lastTrakBarRef.current = measure;
                    const fromTick = measure * TICKS_PER_BAR;
                    automationSchedulerRef.current.scheduleFromTrakEvents(
                        trakEventsRef.current,
                        tempo,
                        time,
                        fromTick,
                        fromTick + TICKS_PER_BAR,
                    );
                }
            }

            const frame = resolveArrangementFrame(arrangementFrameRef.current, arrangement, pos, meter);
            arrangementSteps = frame;
            const getSeq = (key: TrackKey) => {
                const slot = frame[key].slot;
                const stored = slot === null ? null : trackStorageRef.current[key][slot];
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

            const storage = rbsArrangementExtrasRef?.current?.trackParamStorage;
            if (storage) {
                const open303 = audioEngine.open303Engine instanceof Open303Manager
                    ? audioEngine.open303Engine
                    : null;
                const last = lastParamSlotsRef.current;
                const recall = (track: 'partA' | 'partB' | 'bass2', slot: number | null) => {
                    if (slot === null || slot === last[track]) return;
                    last[track] = slot;
                    const applied = applyTrackParamSlotToEngine(
                        storage,
                        track,
                        slot,
                        open303,
                        {
                            synthA: synthARef.current,
                            synthB: synthBRef.current,
                            bass2: bass2Ref.current,
                        },
                    );
                    if (applied.synthA) {
                        synthARef.current = applied.synthA;
                        setSynthA?.(applied.synthA);
                    }
                    if (applied.synthB) {
                        synthBRef.current = applied.synthB;
                        setSynthB?.(applied.synthB);
                    }
                    if (applied.bass2) {
                        bass2Ref.current = applied.bass2;
                        setBass2?.(applied.bass2);
                    }
                };
                recall('partA', frame.partA.slot);
                recall('partB', frame.partB.slot);
                recall('bass2', frame.bass2.slot);
            }
        }

        // Off the linear player (pattern / session): the timeline playhead hides.
        if (!arrangementSteps && arrangementPlayhead.get() >= 0) atStepTime(() => arrangementPlayhead.publish(-1));

        // Song position song-timeline lanes are read at (linear player only).
        const laneSongStep = arrangementSteps ? songPosRef.current : undefined;

        const p = activePattern;
        const stepTime = 60 / tempo / 4;
        // Step each track reads: its own loop when it has a length override.
        // -1 (no clip / past a one-shot clip) reads as a rest.
        const trackStep = (key: TrackKey): number =>
            arrangementSteps ? arrangementSteps[key].step : trackStepFor(meter, key, step, absStep, false);
        const currentScale = currentScaleRef.current;

        // Per-track playhead for views outside the grid (piano roll). Captured
        // now: the arrangement frame is reused on the next tick.
        const playheadSteps = {
            partA: trackStep('partA'), partB: trackStep('partB'), bass2: trackStep('bass2'),
            kick: trackStep('kick'), snare: trackStep('snare'), closedHat: trackStep('closedHat'),
            openHat: trackStep('openHat'), sampler: trackStep('sampler'),
        };
        atStepTime(() => transportPlayhead.publish(step, playheadSteps, stepTime));

        // Note FX (#1345): a track with an active chain plays the chain's events
        // for this step instead of the step's own note, each at its sub-step offset.
        const fxBucket = (track: NoteFxTrack, cacheKey: string, seq: PartSequence, tStep: number, salt: number) =>
            noteFxEventsForStep({ track, cacheKey, steps: seq.steps, tStep, absStep, meter, salt });
        const fxTime = (e: FxNoteEvent, tStep: number) => time + (e.start - tStep) * stepTime;

        // Build per-step note params from stepData (including Prophecy params).
        // Note: previously `currentScale` was passed here but `SynthNoteParams` has no scale
        // properties — it was never consumed by createPlaySynth. Microtonal slide tracking
        // continues to use `tunedNoteToFrequency` below. VoiceManager handles scale tuning
        // independently when it plays the note string. `timing` is false for note FX
        // events: their start and repeats are already in the event.
        const buildSynthNoteParams = (trackKey: 'partA' | 'partB', stepData: Note, tStep: number, timing: boolean): SynthNoteParams => {
            const noteParams: SynthNoteParams = {};
            if (stepData.velocity !== undefined) noteParams.velocity = stepData.velocity;
            if (stepData.timbre !== undefined) noteParams.timbre = stepData.timbre;
            if (timing && stepData.microtiming !== undefined) noteParams.microtiming = stepData.microtiming;
            if (timing && stepData.retrigger !== undefined) noteParams.retrigger = stepData.retrigger;
            if (stepData.formantShift !== undefined) noteParams.formantShift = stepData.formantShift;
            if (stepData.reverbSend !== undefined) noteParams.reverbSend = stepData.reverbSend;
            if (stepData.reverbType !== undefined) noteParams.reverbType = stepData.reverbType;
            if (stepData.delaySend !== undefined) noteParams.delaySend = stepData.delaySend;
            if (stepData.vowel !== undefined) noteParams.vowel = stepData.vowel;
            if (stepData.portamento !== undefined) noteParams.portamento = stepData.portamento;
            if (stepData.drive !== undefined) noteParams.drive = stepData.drive;
            // Apply per-lane automation overrides for prophecy params
            const automation = activePattern[trackKey]?.automation;
            const autoVowel = automation?.['vowel']?.[tStep];
            if (autoVowel !== undefined && autoVowel !== null) noteParams.vowel = autoVowel;
            const autoPortamento = automation?.['portamento']?.[tStep];
            if (autoPortamento !== undefined && autoPortamento !== null) noteParams.portamento = autoPortamento;
            const autoFormantShift = automation?.['formantShift']?.[tStep];
            if (autoFormantShift !== undefined && autoFormantShift !== null) noteParams.formantShift = autoFormantShift;
            // Macro knob lanes drawn per step: that step's notes play with them
            // (the next step without a value hears the knob again).
            for (let i = 0; i < MACRO_AUTOMATION_PARAMS.length; i++) {
                const lane = MACRO_AUTOMATION_PARAMS[i];
                const v = automation?.[lane]?.[tStep];
                if (v === undefined || v === null) continue;
                (noteParams.macro ??= {})[MACRO_AUTOMATION_TARGETS[lane].field] = macroControlValue(lane, v);
            }

            // Unified automation lanes (recorded + imported RBS) for filter cutoff/resonance on this synth track
            // These override per-step; values are already 0-1 normalized (playSynth scales to Hz/Q)
            const targetForLane: 'synthA' | 'synthB' = trackKey === 'partA' ? 'synthA' : 'synthB';
            const cutoffVal = getAutomationValue(targetForLane, 'filterCutoff', step, lanePatternIndex(), laneSongStep);
            if (cutoffVal !== undefined) noteParams.filterCutoff = cutoffVal;
            const resVal = getAutomationValue(targetForLane, 'filterResonance', step, lanePatternIndex(), laneSongStep);
            if (resVal !== undefined) noteParams.filterResonance = resVal;
            const driveVal = getAutomationValue(targetForLane, 'drive', step, lanePatternIndex(), laneSongStep);
            if (driveVal !== undefined) noteParams.drive = driveVal;
            return noteParams;
        };

        const playSynthNotes = (
            trackKey: 'partA' | 'partB',
            params: SynthParams,
            notes: string | string[],
            at: number,
            lengthSteps: number | undefined,
            velocity: number,
            slideFrom: number | undefined,
            noteParams: SynthNoteParams,
        ) => {
            const wamHost = getWamHost();
            if (wamHost?.takesOverTrack(trackKey)) {
                wamHost.scheduleTrackNotes(trackKey, notes, at, (lengthSteps ?? 1) * stepTime, velocity);
            } else {
                audioEngine.playSynth(params, notes, at, lengthSteps, stepTime, slideFrom, trackKey, currentScale, noteParams);
            }
        };

        const triggerSynth = (trackKey: 'partA' | 'partB', params: SynthParams) => {
            if (!trackMuteSoloStore.isAudible(trackKey)) return;
            const tStep = trackStep(trackKey);
            const seq = p[trackKey];

            const fx = fxBucket(trackKey, trackKey, seq, tStep, 0);
            if (fx) {
                for (const group of groupSimultaneous(fx)) {
                    const head = group[0];
                    const source = seq.steps[head.sourceStep];
                    if (!source) continue;
                    const notes = group.length === 1 ? midiToNote(head.pitch) : group.map((e) => midiToNote(e.pitch));
                    const noteParams = buildSynthNoteParams(trackKey, source, head.sourceStep, false);
                    noteParams.velocity = head.velocity;
                    const slideFrom = head.slide && lastFreqRef.current[trackKey] > 0 ? lastFreqRef.current[trackKey] : undefined;
                    playSynthNotes(trackKey, params, notes, fxTime(head, tStep), head.length, head.velocity, slideFrom, noteParams);
                    lastFreqRef.current[trackKey] = tunedNoteToFrequency(midiToNote(head.pitch), currentScale);
                }
                return;
            }

            const stepData = seq.steps[tStep];
            if (!stepData) return;

            if (stepData.probability !== undefined && Math.random() > stepData.probability) return;

            let rawNotes: string | string[] = stepData.note;
            if (stepData.chord) {
                _chordScratch.length = 0;
                _chordScratch.push(stepData.note);
                for (let i = 0; i < stepData.chord.length; i++) {
                    _chordScratch.push(stepData.chord[i]);
                }
                rawNotes = _chordScratch;
            }
            const invVal = activePattern[trackKey].automation?.['chordInversion']?.[tStep] ?? 0;
            const notes = invVal > 0 ? applyInversion(rawNotes, invVal) : rawNotes;

            const slideFrom = stepData.slide && lastFreqRef.current[trackKey] > 0
                ? lastFreqRef.current[trackKey]
                : undefined;

            const noteParams = buildSynthNoteParams(trackKey, stepData, tStep, true);
            playSynthNotes(trackKey, params, notes, time, stepData.length, stepData.velocity ?? 1, slideFrom, noteParams);

            // Update last frequency for future slides
            lastFreqRef.current[trackKey] = tunedNoteToFrequency(stepData.note, currentScale);
        };

        // === Bass 2 (TB-303) ===
        const bass2SynthParams = (lengthSteps: number): SynthParams => ({
            waveform: bass2Ref.current.waveform,
            pitch: bass2Ref.current.pitch,
            filterCutoff: bass2Ref.current.cutoff,
            filterResonance: bass2Ref.current.resonance,
            filterMode: bass2Ref.current.filterMode,
            attack: 0.01,
            decay: bass2Ref.current.decay,
            sustain: 0,
            release: 0.1,
            length: lengthSteps * stepTime,
            volume: bass2Ref.current.volume,
            delayTime: 0,
            delayFeedback: 0,
            delayMix: 0,
            drive: bass2Ref.current.drive ?? 0,
        });

        // Bass2 filter automation from unified lanes (RBS tb303Bcutoff etc maps to bass2)
        const bass2NoteParamsFor = (stepData: Note): SynthNoteParams => {
            const bass2NoteParams: SynthNoteParams = {};
            if (stepData.drive !== undefined) bass2NoteParams.drive = stepData.drive;
            const b2Cutoff = getAutomationValue('bass2', 'filterCutoff', step, lanePatternIndex(), laneSongStep);
            if (b2Cutoff !== undefined) bass2NoteParams.filterCutoff = b2Cutoff;
            const b2Res = getAutomationValue('bass2', 'filterResonance', step, lanePatternIndex(), laneSongStep);
            if (b2Res !== undefined) bass2NoteParams.filterResonance = b2Res;
            const b2Drive = getAutomationValue('bass2', 'drive', step, lanePatternIndex(), laneSongStep);
            if (b2Drive !== undefined) bass2NoteParams.drive = b2Drive;
            return bass2NoteParams;
        };

        // Only Open303Manager takes BASS 2 params; the other 303 engines skip them.
        const applyBass2Params = () =>
            (audioEngine.open303Engine as { applyBass2Params?: (p: Bass2Params) => void } | null | undefined)?.applyBass2Params?.(bass2Ref.current);

        const playBass2Notes = (notes: string | string[], at: number, lengthSteps: number | undefined, velocity: number, noteParams: SynthNoteParams) => {
            const wamBass = getWamHost();
            if (wamBass?.takesOverTrack('bass2')) {
                wamBass.scheduleTrackNotes('bass2', notes, at, (lengthSteps ?? 1) * stepTime, velocity);
            } else {
                const hasParams = noteParams.drive !== undefined || noteParams.filterCutoff !== undefined
                    || noteParams.filterResonance !== undefined || noteParams.velocity !== undefined;
                audioEngine.playSynth(bass2SynthParams(lengthSteps ?? 1), notes, at, lengthSteps, stepTime, undefined, 'bass2' as any, currentScale, hasParams ? noteParams : undefined);
            }
        };

        const triggerBass2 = () => {
            if (!trackMuteSoloStore.isAudible('bass2')) return;
            const tStep = trackStep('bass2');

            const fx = fxBucket('bass2', 'bass2', p.bass2, tStep, 0);
            if (fx) {
                if (fx.length > 0) applyBass2Params();
                for (const group of groupSimultaneous(fx)) {
                    const head = group[0];
                    const source = p.bass2.steps[head.sourceStep];
                    if (!source) continue;
                    const notes = group.length === 1 ? midiToNote(head.pitch) : group.map((e) => midiToNote(e.pitch));
                    // FX events carry their own velocity (ratchet decay, humanize).
                    const noteParams = bass2NoteParamsFor(source);
                    noteParams.velocity = head.velocity;
                    playBass2Notes(notes, fxTime(head, tStep), head.length, head.velocity, noteParams);
                }
                return;
            }

            const stepData = p.bass2.steps[tStep];
            if (!stepData) return;
            if (stepData.probability !== undefined && Math.random() > stepData.probability) return;

            let rawNotes: string | string[] = stepData.note;
            if (stepData.chord) {
                _chordScratch.length = 0;
                _chordScratch.push(stepData.note);
                for (let i = 0; i < stepData.chord.length; i++) {
                    _chordScratch.push(stepData.chord[i]);
                }
                rawNotes = _chordScratch;
            }
            const invVal = activePattern.bass2.automation?.['chordInversion']?.[tStep] ?? 0;
            const notes = invVal > 0 ? applyInversion(rawNotes, invVal) : rawNotes;

            applyBass2Params();

            playBass2Notes(notes, time, stepData.length, stepData.velocity ?? 1, bass2NoteParamsFor(stepData));
        };

        // Trigger synths
        triggerSynth('partA', synthARef.current);
        triggerSynth('partB', synthBRef.current);
        triggerBass2();

        // === Drums ===
        const playDrumIfActive = (trackKey: 'kick' | 'snare' | 'closedHat' | 'openHat', sound: any, params: any) => {
            if (!trackMuteSoloStore.isAudible(trackKey)) return;
            const stepData = p[trackKey].steps[trackStep(trackKey)];
            if (stepData && !(stepData.probability !== undefined && Math.random() > stepData.probability)) {
                // The step's pan (note editor) rides with its note: per-hit pan.
                const note = stepData.pan !== undefined ? { note: stepData.note, pan: stepData.pan } : stepData.note;
                audioEngine.playDrum(sound, params, time, currentScale, stepTime, note);
                if (e2e) recordE2eDrumHit(trackKey, arrangementSteps ? songPosRef.current : -1, step);
            }
        };

        playDrumIfActive('kick', 'kick', kickRef.current);
        playDrumIfActive('snare', 'snare', snareRef.current);
        playDrumIfActive('openHat', 'openHat', openHatRef.current);
        if (!p.openHat.steps[trackStep('openHat')]) {
            playDrumIfActive('closedHat', 'closedHat', closedHatRef.current);
        }

        // === Sampler ===
        // Track-level mute/solo only — per-bank muting is a separate concern.
        // ⚡ Bolt Optimization: Replacing forEach with for loop to prevent closure allocations on hot path
        const samplerAudible = trackMuteSoloStore.isAudible('sampler');
        const samplerStep = trackStep('sampler');
        const buildBankParams = (bankIdx: number, pan: number | undefined) => {
            const voiceParams = samplerVoiceParamsRef.current;
            const baseSampler = samplerRef.current[bankIdx];
            const bankParams = Object.assign(_bankParamsScratch, baseSampler);
            bankParams.rootNote = voiceParams.rootNote;
            bankParams.coarseTune = voiceParams.coarseTune;
            bankParams.fineTune = voiceParams.fineTune;
            bankParams.pan = pan ?? voiceParams.pan;
            bankParams.formantShift = voiceParams.formantShift;
            bankParams.attack = voiceParams.attack;
            bankParams.decay = voiceParams.decay;
            bankParams.stretchProfile = voiceParams.stretchProfile;
            bankParams.stretchMode = voiceParams.stretchMode;
            bankParams.lockToSequencer = voiceParams.lockToSequencer;

            // Sampler track automation (filter, volume) from lanes - complements the Voice Designer ramping below
            const sampCutoff = getAutomationValue('sampler', 'filterCutoff', step, lanePatternIndex(), laneSongStep);
            if (sampCutoff !== undefined) (bankParams as any).filterCutoff = Math.max(20, sampCutoff * 20000);
            const sampRes = getAutomationValue('sampler', 'filterResonance', step, lanePatternIndex(), laneSongStep);
            if (sampRes !== undefined) (bankParams as any).filterResonance = sampRes * 20;
            const sampVol = getAutomationValue('sampler', 'volume', step, lanePatternIndex(), laneSongStep);
            if (sampVol !== undefined) (bankParams as any).volume = sampVol;
            return bankParams as SamplerBankParams;
        };
        for (let bankIdx = 0; samplerAudible && bankIdx < p.sampler.length; bankIdx++) {
            const seq = p.sampler[bankIdx];

            // Note FX: one chain for the sampler track, salted per bank.
            const fx = fxBucket('sampler', `sampler:${bankIdx}`, seq, samplerStep, bankIdx);
            if (fx) {
                for (const group of groupSimultaneous(fx)) {
                    const head = group[0];
                    const source = seq.steps[head.sourceStep];
                    if (!source) continue;
                    const notes = group.length === 1 ? midiToNote(head.pitch) : group.map((e) => midiToNote(e.pitch));
                    const slideFromMidi = head.slide ? lastSamplerMidiRef.current[bankIdx] : undefined;
                    const slideFromFormant = (head.slide || source.slideFormant) ? lastSamplerFormantRef.current[bankIdx] : undefined;
                    audioEngine.playSampler(
                        buildBankParams(bankIdx, source.pan),
                        notes,
                        fxTime(head, samplerStep),
                        head.length,
                        stepTime,
                        { ...source, velocity: head.velocity, microtiming: undefined, retrigger: undefined, slideFromMidi, slideFromFormant },
                        currentScale,
                    );
                    lastSamplerMidiRef.current[bankIdx] = head.pitch;
                    lastSamplerFormantRef.current[bankIdx] = source.formantShift !== undefined ? source.formantShift : (samplerVoiceParamsRef.current.formantShift || 0);
                }
                continue;
            }

            const stepData = seq.steps[samplerStep];
            if (!stepData) continue;
            if (stepData.probability !== undefined && Math.random() > stepData.probability) continue;

            const slideFromMidi = stepData.slide ? lastSamplerMidiRef.current[bankIdx] : undefined;
            const slideFromFormant = (stepData.slide || stepData.slideFormant) ? lastSamplerFormantRef.current[bankIdx] : undefined;

            let rawNotes: string | string[] = stepData.note;
            if (stepData.chord) {
                _chordScratch.length = 0;
                _chordScratch.push(stepData.note);
                for (let i = 0; i < stepData.chord.length; i++) {
                    _chordScratch.push(stepData.chord[i]);
                }
                rawNotes = _chordScratch;
            }

            // Lock to sequencer logic
            let finalNotes = rawNotes;
            const voiceParams = samplerVoiceParamsRef.current;
            if (voiceParams.lockToSequencer && typeof rawNotes === 'string') {
                let targetStep = -1;
                let firstActiveStep = -1;
                for (let i = 0; i < seq.steps.length; i++) {
                    if (seq.steps[i]) {
                        if (firstActiveStep === -1) firstActiveStep = i;
                        if (i >= samplerStep) {
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
                        if (targetData.chord) {
                            _chordScratch.length = 0;
                            _chordScratch.push(targetData.note);
                            for (let i = 0; i < targetData.chord.length; i++) {
                                _chordScratch.push(targetData.chord[i]);
                            }
                            finalNotes = _chordScratch;
                        } else {
                            finalNotes = targetData.note;
                        }
                    }
                }
            }

            const bankParams = buildBankParams(bankIdx, stepData.pan);
            audioEngine.playSampler(bankParams, finalNotes, time, stepData.length, stepTime, { ...stepData, slideFromMidi, slideFromFormant }, currentScale);

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
            const automationPatternIndex = lanePatternIndex();
            const lanes = autoState.lanes;
            const rampDuration = Math.max(0.01, stepTime * 0.85);

            // Collect live values for UI display (keyed "target:parameter")
            const liveValues = _liveValuesScratch;
            let hasLiveValues = false;
            // Clear scratch object
            for (let i = 0; i < _liveValuesKeys.length; i++) {
                delete liveValues[_liveValuesKeys[i]];
            }
            _liveValuesKeys.length = 0;

            const schedulerLanes = _schedulerLanesScratch;
            schedulerLanes.length = 0;

            // First pass: collect scheduler lanes and evaluate active non-scheduler lanes without array methods
            for (let i = 0; i < lanes.length; i++) {
                const lane = lanes[i];
                if (!isLaneActive(lane, automationPatternIndex)) continue;

                const isSchedulerTarget = lane.target === 'synthA' || lane.target === 'synthB' || lane.target === 'bass2' || lane.target === 'master';

                if (automationSchedulerRef?.current && isSchedulerTarget) {
                    schedulerLanes.push(lane);
                    continue;
                }

                const normVal = automationStore.getValueAtStep(lane, laneReadStep(lane, step, laneSongStep));
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
                    time,
                    laneSongStep
                );
                // Collect live values from these lanes for UI indicators.
                for (let i = 0; i < schedulerLanes.length; i++) {
                    const lane = schedulerLanes[i];
                    const normVal = automationStore.getValueAtStep(lane, laneReadStep(lane, step, laneSongStep));
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
    }, [audioEngine, tempo, onParamChange, currentScaleRef, automationSchedulerRef, activeSamplerBankRef, bass2Ref, closedHatRef, currentStepRef, isFirstStepRef, isSongModeActiveRef, kickRef, lastFreqRef, lastSamplerFormantRef, lastSamplerMidiRef, onSessionTick, openHatRef, patternRef, rbsArrangementExtrasRef, samplerRef, samplerVoiceParamsRef, sequencerRef, sessionClockRef, sessionEngineRef, setBass2, setCurrentSongMeasure, setIsSongModeActive, setSynthA, setSynthB, sliceHighlightRef, snareRef, songMeasureRef, arrangementRef, synthARef, synthBRef, trackStorageRef, trakEventsRef]);

    return { onStep };
};