import type { AudioEngine } from "../../../types";
import { noteToMidi } from "../../../utils/musicTheory";
import { getPitchOffsetSemitones, transposeMidi } from "../../../utils/pitchOffset";
import { PROPHECY_WAVEFORM_SUFFIX } from "../../../engines/ProphecyParams";
import { macroEngineForWaveform } from "../../../engines/MacroParams";
import { substituteMacroWaveform } from "../../../engines/MacroManager";
import { engineTelemetry } from "../../../utils/engineTelemetry";
import { pulseExpressionLed } from "../../../audio/expressionLedPulse";
import { triggerBassEQDuck } from "./duckingEffects";
import {
  SYNTH_TRACK_TO_LED,
  type ActiveSynthNote,
  type NoteOnSynthFn,
  type PlaybackRefs,
} from "./types";

/** Interactive note-ons send 100 to the 303 / Prophecy engines; the follower gets the same, normalised. */
const INTERACTIVE_303_VELOCITY = 100 / 127;
const MACRO_INTERACTIVE_VELOCITY = 0.8;
/** Held keys have no known length; the follower holds this long, then releases. */
const INTERACTIVE_BASS_DURATION = 0.25;

function triggerInteractiveBass(
  context: AudioContext,
  refs: Pick<PlaybackRefs, "bassSidechainEQBusRef" | "singingVoiceManagerRef">,
  time: number,
  velocity: number,
): void {
  triggerBassEQDuck(
    context,
    refs.bassSidechainEQBusRef.current,
    time,
    INTERACTIVE_BASS_DURATION,
    refs.singingVoiceManagerRef.current,
    velocity,
  );
}

export function createNoteOnSynth(
  context: AudioContext,
  refs: Pick<
    PlaybackRefs,
    | "open303ManagerRef"
    | "prophecyManagerRef"
    | "macroManagerRef"
    | "voiceManagerARef"
    | "voiceManagerBRef"
    | "nextSynthNoteId"
    | "activeSynthNotes"
    | "bassSidechainEQBusRef"
    | "singingVoiceManagerRef"
  >,
): NoteOnSynthFn {
  return (params, note, time, track) => {
    // Not a note name: no voice plays it (never MIDI 0).
    const noteMidi = noteToMidi(note);
    if (noteMidi === null) return null;
    const now = time || context.currentTime;

    if (track) {
      pulseExpressionLed(SYNTH_TRACK_TO_LED[track], note);
    }

    if (track === "bass2") {
      if (refs.open303ManagerRef.current?.isBass2Ready()) {
        const midi = transposeMidi(noteMidi, getPitchOffsetSemitones(params));
        triggerInteractiveBass(context, refs, now, INTERACTIVE_303_VELOCITY);
        const t0 = performance.now();
        refs.open303ManagerRef.current.setBass2Drive(params.drive || 0);
        refs.open303ManagerRef.current.noteOnBass2(midi, 100);
        const t1 = performance.now();
        try {
          engineTelemetry.recordLatency("jc303", t1 - t0);
        } catch (_) {}
        const id = refs.nextSynthNoteId.current++;
        refs.activeSynthNotes.current.set(id, {
          stop: () => refs.open303ManagerRef.current?.noteOffBass2(midi),
        });
        return id;
      }
      // 303 not ready — fall through to VoiceManager fallback below
    }

    if (
      track === "partB" &&
      (params.waveform === "303-saw" || params.waveform === "303-sqr")
    ) {
      if (refs.open303ManagerRef.current?.isBass1Ready()) {
        refs.open303ManagerRef.current.applyBass1Params(
          params,
          params.waveform === "303-sqr" ? "sqr" : "saw",
        );
        const midi = transposeMidi(noteMidi, getPitchOffsetSemitones(params));
        triggerInteractiveBass(context, refs, now, INTERACTIVE_303_VELOCITY);
        const t0 = performance.now();
        refs.open303ManagerRef.current.setBass1Drive(params.drive || 0);
        refs.open303ManagerRef.current.noteOnBass1(midi, 100);
        const t1 = performance.now();
        try {
          engineTelemetry.recordLatency("jc303", t1 - t0);
        } catch (_) {}
        const id = refs.nextSynthNoteId.current++;
        refs.activeSynthNotes.current.set(id, {
          stop: () => refs.open303ManagerRef.current?.noteOffBass1(midi),
        });
        return id;
      }
    }

    if (
      track === "partA" &&
      (params.waveform === "303-saw" || params.waveform === "303-sqr")
    ) {
      if (refs.open303ManagerRef.current?.isLead303Ready()) {
        refs.open303ManagerRef.current.applyLead303Params(
          params,
          params.waveform === "303-sqr" ? "sqr" : "saw",
        );
        const midi = transposeMidi(noteMidi, getPitchOffsetSemitones(params));
        const t0 = performance.now();
        refs.open303ManagerRef.current.setLead303Drive(params.drive || 0);
        refs.open303ManagerRef.current.noteOnLead303(midi, 100);
        const t1 = performance.now();
        try {
          engineTelemetry.recordLatency("jc303", t1 - t0);
        } catch (_) {}
        const id = refs.nextSynthNoteId.current++;
        refs.activeSynthNotes.current.set(id, {
          stop: () => refs.open303ManagerRef.current?.noteOffLead303(midi),
        });
        return id;
      }
    }

    // === Prophecy Routing (interactive noteOn) ===
    const prophecyWaveTypeNoteOn = PROPHECY_WAVEFORM_SUFFIX[params.waveform];
    if (track === "partB" && prophecyWaveTypeNoteOn !== undefined) {
      if (refs.prophecyManagerRef?.current?.isPartBReady()) {
        refs.prophecyManagerRef.current.applyPartBParams(
          params,
          prophecyWaveTypeNoteOn,
        );
        const midi = transposeMidi(noteMidi, getPitchOffsetSemitones(params));
        triggerInteractiveBass(context, refs, now, INTERACTIVE_303_VELOCITY);
        const t0 = performance.now();
        refs.prophecyManagerRef.current.noteOnPartB(midi, 100);
        const t1 = performance.now();
        try {
          engineTelemetry.recordLatency("prophecy", t1 - t0);
        } catch (_) {}
        const id = refs.nextSynthNoteId.current++;
        refs.activeSynthNotes.current.set(id, {
          stop: () => refs.prophecyManagerRef?.current?.noteOffPartB(midi),
        });
        return id;
      }
    }

    if (track === "partA" && prophecyWaveTypeNoteOn !== undefined) {
      if (refs.prophecyManagerRef?.current?.isPartAReady()) {
        refs.prophecyManagerRef.current.applyPartAParams(
          params,
          prophecyWaveTypeNoteOn,
        );
        const midi = transposeMidi(noteMidi, getPitchOffsetSemitones(params));
        const t0 = performance.now();
        refs.prophecyManagerRef.current.noteOnPartA(midi, 100);
        const t1 = performance.now();
        try {
          engineTelemetry.recordLatency("prophecy", t1 - t0);
        } catch (_) {}
        const id = refs.nextSynthNoteId.current++;
        refs.activeSynthNotes.current.set(id, {
          stop: () => refs.prophecyManagerRef?.current?.noteOffPartA(midi),
        });
        return id;
      }
    }

    // === Macro Routing (interactive noteOn) ===
    const macroEngine = macroEngineForWaveform(params.waveform);
    let voiceParams = params;
    if (macroEngine && (track === "partA" || track === "partB")) {
      const macroManager = refs.macroManagerRef?.current;
      if (macroManager?.canPlay(track, macroEngine)) {
        // Untransposed: TUNE is the engine's native transpose (applyParams).
        const midi = noteMidi;
        const at = time || undefined;
        macroManager.applyParams(track, params, macroEngine, at);
        if (track === "partB") {
          triggerInteractiveBass(context, refs, now, MACRO_INTERACTIVE_VELOCITY);
        }
        const t0 = performance.now();
        macroManager.noteOn(track, midi, MACRO_INTERACTIVE_VELOCITY, at);
        try {
          engineTelemetry.recordLatency("macro", performance.now() - t0);
        } catch { /* telemetry only */ }
        const id = refs.nextSynthNoteId.current++;
        refs.activeSynthNotes.current.set(id, {
          stop: () => refs.macroManagerRef?.current?.noteOff(track, midi),
        });
        return id;
      }
      // Not playable here: the documented fallback waveform, reported once.
      const substitute = substituteMacroWaveform(track, params.waveform, macroManager);
      if (substitute) voiceParams = { ...params, waveform: substitute };
    }

    let manager = refs.voiceManagerARef.current;
    if (track === "partB") {
      manager = refs.voiceManagerBRef.current;
    }

    if (manager) {
      // partB, or bass2 falling back while its 303 is not ready: both are root bass.
      if (track === "partB" || track === "bass2") {
        triggerInteractiveBass(context, refs, now, 1.0);
      }
      const voice = manager.noteOn(voiceParams, note, now);
      const id = refs.nextSynthNoteId.current++;
      refs.activeSynthNotes.current.set(id, {
        stop: () => voice.stopNote(context.currentTime, voiceParams),
      });
      return id;
    }

    return null;
  };
}

export function noteOffSynth(
  activeSynthNotes: Map<number, ActiveSynthNote>,
  id: number,
): void {
  const entry = activeSynthNotes.get(id);
  if (!entry) {
    return;
  }

  entry.stop();
  activeSynthNotes.delete(id);
}

export function createStopTrackNotes(
  refs: Pick<
    PlaybackRefs,
    | "activeSamplerNotes"
    | "voiceManagerARef"
    | "voiceManagerBRef"
    | "singingVoiceManagerRef"
    | "open303ManagerRef"
    | "prophecyManagerRef"
    | "macroManagerRef"
  >,
): NonNullable<AudioEngine["stopTrackNotes"]> {
  return (track) => {
    if (track === "partA") {
      refs.voiceManagerARef.current?.stopAll(0);
      refs.open303ManagerRef.current?.allNotesOffLead303();
      refs.prophecyManagerRef.current?.allNotesOffPartA();
      refs.macroManagerRef?.current?.allNotesOff("partA");
      return;
    }
    if (track === "partB") {
      refs.voiceManagerBRef.current?.stopAll(0);
      refs.open303ManagerRef.current?.allNotesOffBass1();
      refs.prophecyManagerRef.current?.allNotesOffPartB();
      refs.macroManagerRef?.current?.allNotesOff("partB");
      return;
    }
    if (track === "bass2") {
      refs.open303ManagerRef.current?.allNotesOffBass2();
      return;
    }
    if (track === "sampler") {
      refs.singingVoiceManagerRef.current?.stopAll();
      for (const note of refs.activeSamplerNotes.current.values()) {
        try {
          note.source.stop();
        } catch {
          /* already stopped */
        }
      }
      refs.activeSamplerNotes.current.clear();
    }
  };
}

export function createStopAllNotes(
  refs: Pick<
    PlaybackRefs,
    | "activeSynthNotes"
    | "activeSamplerNotes"
    | "voiceManagerARef"
    | "voiceManagerBRef"
    | "singingVoiceManagerRef"
    | "open303ManagerRef"
    | "prophecyManagerRef"
    | "macroManagerRef"
    | "drumKitEngineRef"
  >,
): NonNullable<AudioEngine["stopAllNotes"]> {
  return () => {
    for (const note of refs.activeSynthNotes.current.values()) {
      note.stop();
    }
    refs.activeSynthNotes.current.clear();

    for (const note of refs.activeSamplerNotes.current.values()) {
      try {
        note.source.stop();
      } catch {
        // Ignore stop() errors from sources that have already stopped or are otherwise invalid.
      }
    }
    refs.activeSamplerNotes.current.clear();

    refs.voiceManagerARef.current?.stopAll(0);
    refs.voiceManagerBRef.current?.stopAll(0);
    refs.singingVoiceManagerRef.current?.stopAll();
    refs.open303ManagerRef.current?.allNotesOffBass1();
    refs.open303ManagerRef.current?.allNotesOffBass2();
    refs.open303ManagerRef.current?.allNotesOffLead303();
    // Steps are posted ahead of time (#1344 P5): notes and hits due after
    // STOP are already queued in the voice worklets — cancel them too.
    refs.prophecyManagerRef?.current?.allNotesOff();
    refs.macroManagerRef?.current?.allNotesOff();
    refs.drumKitEngineRef?.current?.cancelPending();
  };
}
