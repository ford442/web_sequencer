import type { SynthParams } from "../../../types";
import { noteToMidi } from "../../../utils/musicTheory";
import { getPitchOffsetSemitones, transposeMidi } from "../../../utils/pitchOffset";
import { PROPHECY_WAVEFORM_SUFFIX } from "../../../engines/ProphecyParams";
import { macroEngineForWaveform } from "../../../engines/MacroParams";
import { substituteMacroWaveform, type MacroPart } from "../../../engines/MacroManager";
import type { Voice } from "../../../engines/VoiceManager";
import { pulseExpressionLed } from "../../../audio/expressionLedPulse";
import { triggerBassEQDuck } from "./duckingEffects";
import { SYNTH_TRACK_TO_LED, type PlaySynthFn, type PlaybackRefs } from "./types";

const _synthParamsScratchKeys: string[] = [];
const _synthParamsScratch: SynthParams = {} as SynthParams;

/** Typed view for the scratch-object key copy below — avoids `any` on the hot path. */
function asRecord(obj: SynthParams): Record<string, unknown> {
  return obj as unknown as Record<string, unknown>;
}

export function createPlaySynth(
  context: AudioContext,
  refs: Pick<
    PlaybackRefs,
    | "masterGainRef"
    | "open303ManagerRef"
    | "prophecyManagerRef"
    | "macroManagerRef"
    | "voiceManagerARef"
    | "voiceManagerBRef"
    | "reverbNodesRef"
    | "reverbTypeRef"
    | "bassSidechainEQBusRef"
    | "singingVoiceManagerRef"
  >,
): PlaySynthFn {
  return (
    params,
    note,
    time,
    durationSteps = 1,
    stepTime = 0.2,
    slideFromFreq,
    track,
    noteParams,
    tuning,
  ) => {
    if (!refs.masterGainRef.current) {
      return;
    }

    const actualTime =
      time + (noteParams?.microtiming ? noteParams.microtiming * stepTime : 0);
    let effectiveParams = params;

    if (
      noteParams?.pan !== undefined ||
      noteParams?.timbre !== undefined ||
      noteParams?.envMod !== undefined ||
      noteParams?.filterCutoff !== undefined ||
      noteParams?.filterResonance !== undefined ||
      noteParams?.vowel !== undefined ||
      noteParams?.portamento !== undefined ||
      noteParams?.formantShift !== undefined ||
      noteParams?.macro !== undefined
    ) {
      for (let i = 0; i < _synthParamsScratchKeys.length; i++) {
        asRecord(_synthParamsScratch)[_synthParamsScratchKeys[i]] = undefined;
      }
      _synthParamsScratchKeys.length = 0;
      effectiveParams = _synthParamsScratch;
      // Reuse a module-level object to prevent allocations on hot path
      for (const k in params) {
        asRecord(effectiveParams)[k] = asRecord(params)[k];
        _synthParamsScratchKeys.push(k);
      }

      if (noteParams?.timbre !== undefined) {
        const mod = 0.5 + noteParams.timbre;
        effectiveParams.filterCutoff = Math.min(
          20000,
          params.filterCutoff * mod,
        );
      }
      if (noteParams?.filterCutoff !== undefined) {
        effectiveParams.filterCutoff = Math.max(
          20,
          noteParams.filterCutoff * 20000,
        );
      }
      if (noteParams?.filterResonance !== undefined) {
        effectiveParams.filterResonance = noteParams.filterResonance * 20;
      }
      if (noteParams?.pan !== undefined) {
        effectiveParams.pan = noteParams.pan;
      }
      if (noteParams?.envMod !== undefined) {
        // @ts-expect-error envMod may not exist on SynthParams directly, but gets mapped correctly to Bass2/Open303 overrides
        effectiveParams.envMod = noteParams.envMod;
      }
      if (noteParams?.vowel !== undefined) {
        effectiveParams.vowel = noteParams.vowel;
      }
      if (noteParams?.portamento !== undefined) {
        effectiveParams.portamento = noteParams.portamento;
      }
      if (noteParams?.formantShift !== undefined) {
        effectiveParams.formantShift = noteParams.formantShift;
      }
      if (noteParams?.macro !== undefined) {
        effectiveParams.macro = { ...params.macro, ...noteParams.macro };
      }
    }

    const retrigger = Math.max(1, Math.floor(noteParams?.retrigger || 1));
    const subDurationSteps = durationSteps / retrigger;
    const subDuration = subDurationSteps * stepTime;

    // === HOISTED NOTE PROCESSING ===

    const noteStr = Array.isArray(note) ? note[0] : note;
    const midi = noteToMidi(noteStr);
    // No note, or a name that does not parse: silent, never MIDI 0.
    if (midi === null) {
      return;
    }
    if (track) {
      pulseExpressionLed(SYNTH_TRACK_TO_LED[track], noteStr);
    }
    // TUNE (module pitch offset, semitones) applies to the engine-driven voices.
    // The VoiceManager path applies it itself from params, so it is not used there.
    const engineMidi = transposeMidi(midi, getPitchOffsetSemitones(effectiveParams));
    const velocity = Math.round((noteParams?.velocity ?? 0.8) * 127);
    const prophecyWaveType = PROPHECY_WAVEFORM_SUFFIX[params.waveform];

    // === Macro engine (macro-* models, polyphonic) ===
    // A part that cannot render the model plays its documented fallback
    // waveform through VoiceManager instead and reports the substitution —
    // never silence (docs/audio-engine/macro-voices.md#fallback).
    const macroEngine = macroEngineForWaveform(params.waveform);
    let macroPart: MacroPart | null = null;
    if (macroEngine && (track === "partA" || track === "partB")) {
      const macroManager = refs.macroManagerRef?.current;
      if (macroManager?.canPlay(track, macroEngine)) {
        macroPart = track;
        // TUNE travels as the native transpose, so the notes below stay untransposed.
        macroManager.applyParams(track, effectiveParams, macroEngine, actualTime);
      } else {
        const substitute = substituteMacroWaveform(track, params.waveform, macroManager);
        if (substitute) effectiveParams = { ...effectiveParams, waveform: substitute };
      }
    }

    // Hoist expensive WASM parameter mappings to avoid cross-boundary calls in retrigger loop
    if (
      track === "partB" &&
      (params.waveform === "303-saw" || params.waveform === "303-sqr")
    ) {
      if (refs.open303ManagerRef.current?.isBass1Ready()) {
        refs.open303ManagerRef.current.applyBass1Params(
          effectiveParams,
          params.waveform === "303-sqr" ? "sqr" : "saw",
        );
      }
    }
    if (
      track === "partA" &&
      (params.waveform === "303-saw" || params.waveform === "303-sqr")
    ) {
      if (refs.open303ManagerRef.current?.isLead303Ready()) {
        refs.open303ManagerRef.current.applyLead303Params(
          effectiveParams,
          params.waveform === "303-sqr" ? "sqr" : "saw",
        );
      }
    }
    if (track === "partB" && prophecyWaveType !== undefined) {
      if (refs.prophecyManagerRef?.current?.isPartBReady()) {
        refs.prophecyManagerRef.current.applyPartBParams(
          effectiveParams,
          prophecyWaveType,
        );
      }
    }
    if (track === "partA" && prophecyWaveType !== undefined) {
      if (refs.prophecyManagerRef?.current?.isPartAReady()) {
        refs.prophecyManagerRef.current.applyPartAParams(
          effectiveParams,
          prophecyWaveType,
        );
      }
    }

    for (let i = 0; i < retrigger; i++) {
      const noteTime = actualTime + i * subDuration;

      if (track === "bass2") {
        if (refs.open303ManagerRef.current?.isBass2Ready()) {
          const now = context.currentTime;
          const startDelay = Math.max(0, noteTime - now);
          const noteDuration = subDuration;

          triggerBassEQDuck(
            context,
            refs.bassSidechainEQBusRef.current,
            noteTime,
            noteDuration,
            refs.singingVoiceManagerRef.current,
            velocity / 127
          );

          const driveAmount =
            noteParams?.drive !== undefined
              ? noteParams.drive
              : params.drive || 0;
          refs.open303ManagerRef.current?.scheduleParamAtTime('bass2', 'setDrive', driveAmount, noteTime);
          refs.open303ManagerRef.current?.noteOnBass2(engineMidi, velocity, noteTime);

          if (slideFromFreq === undefined) {
            refs.open303ManagerRef.current?.noteOffBass2(engineMidi, noteTime + noteDuration);
          }
        }
        continue;
      }

      if (
        track === "partB" &&
        (params.waveform === "303-saw" || params.waveform === "303-sqr")
      ) {
        if (refs.open303ManagerRef.current?.isBass1Ready()) {
          const now = context.currentTime;
          const startDelay = Math.max(0, noteTime - now);
          const noteDuration = subDuration;

          triggerBassEQDuck(
            context,
            refs.bassSidechainEQBusRef.current,
            noteTime,
            noteDuration,
            refs.singingVoiceManagerRef.current,
            velocity / 127
          );

          const driveAmount =
            noteParams?.drive !== undefined
              ? noteParams.drive
              : params.drive || 0;
          refs.open303ManagerRef.current?.scheduleParamAtTime('bass1', 'setDrive', driveAmount, noteTime);
          refs.open303ManagerRef.current?.noteOnBass1(engineMidi, velocity, noteTime);

          if (slideFromFreq === undefined) {
            refs.open303ManagerRef.current?.noteOffBass1(engineMidi, noteTime + noteDuration);
          }

          continue;
        }
      }

      if (
        track === "partA" &&
        (params.waveform === "303-saw" || params.waveform === "303-sqr")
      ) {
        if (refs.open303ManagerRef.current?.isLead303Ready()) {
          const now = context.currentTime;
          const startDelay = Math.max(0, noteTime - now);
          const noteDuration = subDuration;

          const driveAmount =
            noteParams?.drive !== undefined
              ? noteParams.drive
              : params.drive || 0;
          refs.open303ManagerRef.current?.scheduleParamAtTime('lead303', 'setDrive', driveAmount, noteTime);
          refs.open303ManagerRef.current?.noteOnLead303(engineMidi, velocity, noteTime);

          if (slideFromFreq === undefined) {
            refs.open303ManagerRef.current?.noteOffLead303(engineMidi, noteTime + noteDuration);
          }

          continue;
        }
      }

      // === Macro Routing === every chord note is its own voice.
      if (macroPart) {
        const macroManager = refs.macroManagerRef?.current;
        if (macroManager) {
          const noteDuration = subDuration;
          const noteNames = Array.isArray(note) ? note : [note];
          const noteVelocity = noteParams?.velocity ?? 0.8;
          // A step's timbre (0–1, 0.5 neutral) bends TIMBRE around the knob.
          const timbre = noteParams?.timbre !== undefined ? noteParams.timbre - 0.5 : 0;
          const slide = i === 0 && slideFromFreq !== undefined;
          if (macroPart === "partB") {
            triggerBassEQDuck(
              context,
              refs.bassSidechainEQBusRef.current,
              noteTime,
              noteDuration,
              refs.singingVoiceManagerRef.current,
              noteVelocity,
            );
          }
          for (const name of noteNames) {
            const noteMidi = noteToMidi(name);
            if (noteMidi === null) continue;
            macroManager.noteOn(macroPart, noteMidi, noteVelocity, noteTime, { timbre, slide });
            // Always released: a slid note keeps sounding only through the
            // mono legato in the engine, never by leaving a gate open.
            macroManager.noteOff(macroPart, noteMidi, noteTime + noteDuration);
          }
        }
        continue;
      }

      // === Prophecy Routing ===
      if (track === "partB" && prophecyWaveType !== undefined) {
        if (refs.prophecyManagerRef?.current?.isPartBReady()) {
          const now = context.currentTime;
          const startDelay = Math.max(0, noteTime - now);
          const noteDuration = subDuration;

          triggerBassEQDuck(
            context,
            refs.bassSidechainEQBusRef.current,
            noteTime,
            noteDuration,
            refs.singingVoiceManagerRef.current,
            velocity / 127
          );

          refs.prophecyManagerRef?.current?.noteOnPartB(engineMidi, 100, noteTime);
          // Always released: Prophecy is polyphonic and has no legato path, so
          // the next note takes another voice and a slide step left without
          // a noteOff held forever (glide is the PORTAMENTO knob).
          refs.prophecyManagerRef?.current?.noteOffPartB(engineMidi, noteTime + noteDuration);

          continue;
        }
      }

      if (track === "partA" && prophecyWaveType !== undefined) {
        if (refs.prophecyManagerRef?.current?.isPartAReady()) {
          const now = context.currentTime;
          const startDelay = Math.max(0, noteTime - now);
          const noteDuration = subDuration;

          refs.prophecyManagerRef?.current?.noteOnPartA(engineMidi, 100, noteTime);
          // Always released: Prophecy is polyphonic and has no legato path, so
          // the next note takes another voice and a slide step left without
          // a noteOff held forever (glide is the PORTAMENTO knob).
          refs.prophecyManagerRef?.current?.noteOffPartA(engineMidi, noteTime + noteDuration);

          continue;
        }
      }

      const noteDuration = subDuration;
      const effectiveSlide = i === 0 ? slideFromFreq : undefined;

      let voice: Voice | null = null;
      if (track === "partB" && refs.voiceManagerBRef.current) {
        voice = refs.voiceManagerBRef.current.playNote(
          effectiveParams,
          typeof note === "string" ? note : (note as any).note,
          noteTime,
          noteDuration,
          effectiveSlide,
        );
        triggerBassEQDuck(
          context,
          refs.bassSidechainEQBusRef.current,
          noteTime,
          noteDuration,
          refs.singingVoiceManagerRef.current,
          velocity / 127
        );
      } else if (refs.voiceManagerARef.current) {
        voice = refs.voiceManagerARef.current.playNote(
          effectiveParams,
          typeof note === "string" ? note : (note as any).note,
          noteTime,
          noteDuration,
          effectiveSlide,
        );
      }

      if (voice) {
        const delaySendAmount =
          noteParams?.delaySend !== undefined ? noteParams.delaySend : 0;
        voice.setDelaySend(delaySendAmount, noteTime);

        const reverbSendAmount =
          noteParams?.reverbSend !== undefined ? noteParams.reverbSend : 0;
        if (typeof (voice as any).setReverbSend === "function") {
          (voice as any).setReverbSend(reverbSendAmount, noteTime);
        }
      }
    }
  };
}
