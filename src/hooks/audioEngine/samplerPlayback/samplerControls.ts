import type { SamplerBankParams } from "../../../types";
import { noteToMidi } from "../../../utils/musicTheory";
import type { PlaySamplerFn, PlaySamplerVoiceFn, SamplerPlaybackRefs } from "./types";

export function createPlaySampler(
  playSamplerVoice: PlaySamplerVoiceFn,
  refs: Pick<SamplerPlaybackRefs, "harmonizerRef">,
): PlaySamplerFn {
  return (params, note, time, durationSteps = 1, stepTime = 0.2, tuning) => {
    // Harmonize support - if harmonizer is active, generate multiple harmony voices
    const harmonizer = refs.harmonizerRef.current;
    if (harmonizer?.getIsActive()) {
      const voices = harmonizer.generateVoices();

      // Play base voice (index 0) - the original note
      playSamplerVoice(params, note, time, durationSteps, stepTime, undefined, 0, tuning);

      // Play each harmony voice (skip index 0 which is base)
      // ⚡ Bolt Optimization: Replacing forEach with for...of to prevent closure allocations on hot path
      for (const voice of voices) {
        if (voice.index === 0) continue; // Skip base voice, already played above

        // Create modified params for this harmony voice
        const config = harmonizer.getConfig();
        const voiceParams: SamplerBankParams = {
          ...params,
          pan: Math.max(-1, Math.min(1, (params.pan || 0) + (voice.pan || 0))),
          volume: params.volume * voice.gain * 0.85,
          formantShift: (params.formantShift || 0) + voice.formantShift,
          fineTune: (params.fineTune || 0) + voice.detuneCents
        };
        if (config.harmonyAttack !== undefined) {
          voiceParams.attack = config.harmonyAttack;
        }
        if (config.harmonyRelease !== undefined) {
          voiceParams.release = config.harmonyRelease;
        }

        // Play this voice with pitch offset and slight delay for natural ensemble effect
        const delayMs = voice.index * 5;
        // ⚡ Bolt Optimization: Replace main-thread setTimeout with worklet/API-scheduled delayed start time
        playSamplerVoice(voiceParams, note, time + (delayMs / 1000), durationSteps, stepTime, undefined, voice.pitchOffset, tuning);
      }
      return;
    }

    playSamplerVoice(params, note, time, durationSteps, stepTime, undefined, 0, tuning);
  };
}

export type NoteOnSamplerFn = (
  params: SamplerBankParams,
  note: string,
  time?: number,
  tuning?: any,
) => number | null;

export function createNoteOnSampler(
  context: AudioContext,
  refs: Pick<
    SamplerPlaybackRefs,
    | "multisampleBanksRef"
    | "loadedSampleBuffersRef"
    | "masterSaturationRef"
    | "nextSamplerNoteId"
    | "activeSamplerNotes"
  >,
): NoteOnSamplerFn {
  return (params, note, time, _tuning) => {
    const now = time || context.currentTime;

    const multisampleBank = refs.multisampleBanksRef.current.get(params.sampleName);
    const legacyBuffer = refs.loadedSampleBuffersRef.current.get(params.sampleName);
    const buffer = multisampleBank?.baseBuffer || legacyBuffer;

    if (!buffer || !refs.masterSaturationRef.current) return null;

    const rootNote = params.rootNote ?? 60;
    const coarseTune = params.coarseTune ?? 0;
    const fineTune = params.fineTune ?? 0;

    const targetMidi = noteToMidi(note);
    const source = context.createBufferSource();

    let playbackBuffer: AudioBuffer;
    let pitchRatio: number;

    if (multisampleBank?.pitchBank.has(targetMidi)) {
      playbackBuffer = multisampleBank.pitchBank.get(targetMidi)!;
      pitchRatio = params.playbackSpeed;
    } else {
      playbackBuffer = multisampleBank?.baseBuffer || buffer;
      const rootMidi = multisampleBank?.rootNote ?? rootNote;
      const effectivePitchOffset = coarseTune + (fineTune / 100);
      pitchRatio = params.playbackSpeed * Math.pow(2, (targetMidi - rootMidi + effectivePitchOffset) / 12);
    }

    source.buffer = playbackBuffer;
    source.playbackRate.value = pitchRatio;

    const gain = context.createGain();
    gain.gain.value = params.volume;

    source.connect(gain);
    gain.connect(refs.masterSaturationRef.current);
    source.start(now);

    const id = refs.nextSamplerNoteId.current++;
    refs.activeSamplerNotes.current.set(id, { source, envGain: gain });
    return id;
  };
}

export function createNoteOffSampler(
  context: AudioContext,
  refs: Pick<SamplerPlaybackRefs, "activeSamplerNotes">,
) {
  return (id: number) => {
    const note = refs.activeSamplerNotes.current.get(id);
    if (note) {
      const now = context.currentTime;
      note.envGain.gain.cancelScheduledValues(now);
      note.envGain.gain.linearRampToValueAtTime(0, now + 0.1);
      note.source.stop(now + 0.1);
      refs.activeSamplerNotes.current.delete(id);
    }
  };
}
