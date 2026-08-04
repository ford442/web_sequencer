import type { AudioEngine } from "../../../types";
import { noteToMidi } from "../../../utils/musicTheory";
import { PROPHECY_WAVEFORM_SUFFIX } from "../../../engines/ProphecyParams";
import { engineTelemetry } from "../../../utils/engineTelemetry";
import { pulseExpressionLed } from "../../../audio/expressionLedPulse";
import { triggerBassEQDuck } from "./duckingEffects";
import {
  SYNTH_TRACK_TO_LED,
  type ActiveSynthNote,
  type NoteOnSynthFn,
  type PlaybackRefs,
} from "./types";

export function createNoteOnSynth(
  context: AudioContext,
  refs: Pick<
    PlaybackRefs,
    | "open303ManagerRef"
    | "prophecyManagerRef"
    | "voiceManagerARef"
    | "voiceManagerBRef"
    | "nextSynthNoteId"
    | "activeSynthNotes"
    | "bassSidechainEQBusRef"
  >,
): NoteOnSynthFn {
  return (params, note, time, track) => {
    const now = time || context.currentTime;

    if (track) {
      pulseExpressionLed(SYNTH_TRACK_TO_LED[track], note);
    }

    if (track === "bass2") {
      if (refs.open303ManagerRef.current?.isBass2Ready()) {
        const midi = noteToMidi(note);
        triggerBassEQDuck(
          context,
          refs.bassSidechainEQBusRef.current,
          now,
          0.25,
        ); // Approximate duration for interactive play
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
        const midi = noteToMidi(note);
        triggerBassEQDuck(
          context,
          refs.bassSidechainEQBusRef.current,
          now,
          0.25,
        ); // Approximate duration
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
        const midi = noteToMidi(note);
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
        const midi = noteToMidi(note);
        triggerBassEQDuck(
          context,
          refs.bassSidechainEQBusRef.current,
          now,
          0.25,
        );
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
        const midi = noteToMidi(note);
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

    let manager = refs.voiceManagerARef.current;
    if (track === "partB") {
      manager = refs.voiceManagerBRef.current;
    }

    if (manager) {
      const voice = manager.noteOn(params, note, now);
      const id = refs.nextSynthNoteId.current++;
      refs.activeSynthNotes.current.set(id, {
        stop: () => voice.stopNote(context.currentTime, params),
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

export function createStopAllNotes(
  refs: Pick<
    PlaybackRefs,
    | "activeSynthNotes"
    | "activeSamplerNotes"
    | "voiceManagerARef"
    | "voiceManagerBRef"
    | "singingVoiceManagerRef"
    | "open303ManagerRef"
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
    refs.open303ManagerRef.current?.noteOffBass1(0);
    refs.open303ManagerRef.current?.noteOffBass2(0);
    refs.open303ManagerRef.current?.noteOffLead303(0);
  };
}
