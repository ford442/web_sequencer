import type { SynthParams } from "../../../types";
import { noteToMidi } from "../../../utils/musicTheory";
import { PROPHECY_WAVEFORM_SUFFIX } from "../../../engines/ProphecyParams";
import type { Voice } from "../../../engines/VoiceManager";
import { pulseExpressionLed } from "../../../audio/expressionLedPulse";
import { triggerBassEQDuck } from "./duckingEffects";
import { SYNTH_TRACK_TO_LED, type PlaySynthFn, type PlaybackRefs } from "./types";

const _synthParamsScratchKeys: string[] = [];
const _synthParamsScratch: SynthParams = {} as SynthParams;

export function createPlaySynth(
  context: AudioContext,
  refs: Pick<
    PlaybackRefs,
    | "masterGainRef"
    | "open303ManagerRef"
    | "prophecyManagerRef"
    | "voiceManagerARef"
    | "voiceManagerBRef"
    | "reverbNodesRef"
    | "reverbTypeRef"
    | "bassSidechainEQBusRef"
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
      noteParams?.formantShift !== undefined
    ) {
      for (let i = 0; i < _synthParamsScratchKeys.length; i++) {
        (_synthParamsScratch as any)[_synthParamsScratchKeys[i]] = undefined;
      }
      _synthParamsScratchKeys.length = 0;
      effectiveParams = _synthParamsScratch;
      // Reuse a module-level object to prevent allocations on hot path
      for (const k in params) {
        (effectiveParams as any)[k] = (params as any)[k];
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
    }

    const retrigger = Math.max(1, Math.floor(noteParams?.retrigger || 1));
    const subDurationSteps = durationSteps / retrigger;
    const subDuration = subDurationSteps * stepTime;

    // === HOISTED NOTE PROCESSING ===

    const noteStr = Array.isArray(note) ? note[0] : note;
    if (!noteStr) {
      return;
    }
    if (track) {
      pulseExpressionLed(SYNTH_TRACK_TO_LED[track], noteStr);
    }
    const midi = noteToMidi(noteStr);
    const velocity = Math.round((noteParams?.velocity ?? 0.8) * 127);
    const prophecyWaveType = PROPHECY_WAVEFORM_SUFFIX[params.waveform];

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
          );

          const driveAmount =
            noteParams?.drive !== undefined
              ? noteParams.drive
              : params.drive || 0;
          setTimeout(() => {
            refs.open303ManagerRef.current?.setBass2Drive(driveAmount);
          }, startDelay * 1000);
          refs.open303ManagerRef.current?.noteOnBass2(midi, velocity, noteTime);

          if (slideFromFreq === undefined) {
            refs.open303ManagerRef.current?.noteOffBass2(midi, noteTime + noteDuration);
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
          );

          const driveAmount =
            noteParams?.drive !== undefined
              ? noteParams.drive
              : params.drive || 0;
          setTimeout(() => {
            refs.open303ManagerRef.current?.setBass1Drive(driveAmount);
          }, startDelay * 1000);
          refs.open303ManagerRef.current?.noteOnBass1(midi, velocity, noteTime);

          if (slideFromFreq === undefined) {
            refs.open303ManagerRef.current?.noteOffBass1(midi, noteTime + noteDuration);
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
          setTimeout(() => {
            refs.open303ManagerRef.current?.setLead303Drive(driveAmount);
          }, startDelay * 1000);
          refs.open303ManagerRef.current?.noteOnLead303(midi, velocity, noteTime);

          if (slideFromFreq === undefined) {
            refs.open303ManagerRef.current?.noteOffLead303(midi, noteTime + noteDuration);
          }

          continue;
        }
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
          );

          refs.prophecyManagerRef?.current?.noteOnPartB(midi, 100, noteTime);

          if (slideFromFreq === undefined) {
            refs.prophecyManagerRef?.current?.noteOffPartB(midi, noteTime + noteDuration);
          }

          continue;
        }
      }

      if (track === "partA" && prophecyWaveType !== undefined) {
        if (refs.prophecyManagerRef?.current?.isPartAReady()) {
          const now = context.currentTime;
          const startDelay = Math.max(0, noteTime - now);
          const noteDuration = subDuration;

          refs.prophecyManagerRef?.current?.noteOnPartA(midi, 100, noteTime);

          if (slideFromFreq === undefined) {
            refs.prophecyManagerRef?.current?.noteOffPartA(midi, noteTime + noteDuration);
          }

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
