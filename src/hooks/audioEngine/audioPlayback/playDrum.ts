import type { AudioEngine, HatParams, KickParams, SnareParams } from "../../../types";
import { noteToMidi } from "../../../utils/musicTheory";
import type { SingingVoice } from "../../../engines/SingingVoice";
import { pulseExpressionLed } from "../../../audio/expressionLedPulse";
import { triggerSidechainDuck } from "./duckingEffects";
import { DRUM_SOUND_TO_LED, type PlaybackRefs } from "./types";

/** Reference MIDI note for drum pitch shifting (C3). A step with note C3 plays at unmodified pitch. */
const DRUM_REF_MIDI = 48;

// ⚡ Bolt Optimization: Pre-allocated scratch buffer for retrieving active singing voices without GC overhead
const _activeSingingVoicesScratch: SingingVoice[] = [];

export function createPlayDrum(
  context: AudioContext,
  refs: Pick<
    PlaybackRefs,
    | "masterGainRef"
    | "noiseBufferRef"
    | "reverbNodesRef"
    | "reverbTypeRef"
    | "sidechainGainRef"
    | "drumKitEngineRef"
    | "singingVoiceManagerRef"
  >,
): AudioEngine["playDrum"] {
  return (
    sound,
    params,
    time,
    _tuning,
    stepTime = 0.125,
    note?: string | { note: string; pan?: number },
  ) => {
    const noteStr = typeof note === "string" ? note : note?.note;
    const pan = typeof note === "object" ? note.pan : undefined;
    if (!refs.masterGainRef.current) {
      return;
    }

    pulseExpressionLed(DRUM_SOUND_TO_LED[sound], noteStr, noteStr ? 1 : 0.9);

    // Compute pitch multiplier from note relative to reference C3
    const pitchRatio = noteStr
      ? Math.pow(2, (noteToMidi(noteStr) - DRUM_REF_MIDI) / 12)
      : 1;

    // Hoisted adjustedParams (conditional clone only when pitch changes)
    // Removed redundant retrigger loop (hardcoded to 1) for cleaner hot path
    let adjustedParams = params;
    if (pitchRatio !== 1) {
      if (sound === "kick") {
        const kp = params as KickParams;
        adjustedParams = { ...kp, pitch: kp.pitch * pitchRatio };
      } else if (sound === "snare") {
        const sp = params as SnareParams;
        adjustedParams = { ...sp, tone: sp.tone * pitchRatio };
      } else {
        const hp = params as HatParams;
        adjustedParams = { ...hp, pitch: hp.pitch * pitchRatio };
      }
    }

    const now = time; // single-shot for now

    // Use DrumKitEngine for authentic 808/909 synthesis when available
    const kitEngine = refs.drumKitEngineRef?.current;
    if (kitEngine) {
      if (sound === "kick") {
        if (refs.sidechainGainRef.current) {
          triggerSidechainDuck(context, refs.sidechainGainRef.current, now);
        }
        const manager = refs.singingVoiceManagerRef.current;
        if (manager) {
          const activeVoices = manager.getActiveVoices(_activeSingingVoicesScratch);
          // ⚡ Bolt Optimization: Replacing forEach with for loop to prevent closure allocations on hot path
          for (let i = 0; i < activeVoices.length; i++) {
            const voice = activeVoices[i];
            if (voice.formantSidechainDepth > 0) {
              voice.triggerFormantSidechainDuck(voice.formantSidechainDepth, 0.25, now);
            }
          }
        }
      }

      kitEngine.play(
        context,
        refs.masterGainRef.current,
        refs.noiseBufferRef.current,
        sound,
        adjustedParams,
        now,
      );
      return;
    }

    // Legacy fallback (no kit engine)
    if (sound === "kick") {
      if (refs.sidechainGainRef.current) {
        triggerSidechainDuck(context, refs.sidechainGainRef.current, now);
      }
      const manager = refs.singingVoiceManagerRef.current;
      if (manager) {
        const activeVoices = manager.getActiveVoices(_activeSingingVoicesScratch);
        // ⚡ Bolt Optimization: Replacing forEach with for loop to prevent closure allocations on hot path
        for (let i = 0; i < activeVoices.length; i++) {
          const voice = activeVoices[i];
          if (voice.formantSidechainDepth > 0) {
            voice.triggerFormantSidechainDuck(voice.formantSidechainDepth, 0.25, now);
          }
        }
      }

      const kickParams = params as KickParams;
      const osc = context.createOscillator();
      const gain = context.createGain();

      osc.frequency.setValueAtTime(150 * pitchRatio, now);
      osc.frequency.exponentialRampToValueAtTime(0.01, now + kickParams.decay);

      gain.gain.setValueAtTime(kickParams.volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + kickParams.decay);

      osc.connect(gain);

      let finalDest: AudioNode = gain;
      if (
        (pan !== undefined && pan !== 0) ||
        (kickParams.pan !== undefined && kickParams.pan !== 0)
      ) {
        const activePan = pan !== undefined ? pan : kickParams.pan || 0;
        const panner = context.createStereoPanner();
        panner.pan.value = activePan;
        finalDest.connect(panner);
        finalDest = panner;
      }
      finalDest.connect(refs.masterGainRef.current);

      osc.start(now);
      osc.stop(now + kickParams.decay);
    } else if (sound === "snare") {
      const snareParams = params as SnareParams;
      const osc = context.createOscillator();
      const oscGain = context.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(250 * pitchRatio, now);
      oscGain.gain.setValueAtTime(snareParams.tone * snareParams.volume, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + snareParams.decay);

      let finalDestOsc: AudioNode = oscGain;
      if (
        (pan !== undefined && pan !== 0) ||
        (snareParams.pan !== undefined && snareParams.pan !== 0)
      ) {
        const activePan = pan !== undefined ? pan : snareParams.pan || 0;
        const panner = context.createStereoPanner();
        panner.pan.value = activePan;
        finalDestOsc.connect(panner);
        finalDestOsc = panner;
      }

      if (refs.noiseBufferRef.current) {
        const noise = context.createBufferSource();
        noise.buffer = refs.noiseBufferRef.current;
        const noiseFilter = context.createBiquadFilter();
        noiseFilter.type = "highpass";
        noiseFilter.frequency.value = 1000;
        const noiseGain = context.createGain();
        noiseGain.gain.setValueAtTime(
          snareParams.noise * snareParams.volume,
          now,
        );
        noiseGain.gain.exponentialRampToValueAtTime(
          0.001,
          now + snareParams.decay,
        );

        noise.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        let finalDestNoise: AudioNode = noiseGain;
        if (
          (pan !== undefined && pan !== 0) ||
          (snareParams.pan !== undefined && snareParams.pan !== 0)
        ) {
          const activePan = pan !== undefined ? pan : snareParams.pan || 0;
          const panner = context.createStereoPanner();
          panner.pan.value = activePan;
          finalDestNoise.connect(panner);
          finalDestNoise = panner;
        }
        finalDestNoise.connect(refs.masterGainRef.current);
        noise.start(now);
        noise.stop(now + snareParams.decay);
      }

      osc.connect(oscGain);
      finalDestOsc.connect(refs.masterGainRef.current);
      osc.start(now);
      osc.stop(now + snareParams.decay);
    } else {
      const hatParams = params as HatParams;
      if (refs.noiseBufferRef.current) {
        const src = context.createBufferSource();
        src.buffer = refs.noiseBufferRef.current;
        const filter = context.createBiquadFilter();
        filter.type = "highpass";
        filter.frequency.value = 5000;
        const gain = context.createGain();
        gain.gain.setValueAtTime(hatParams.volume, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + hatParams.decay);

        src.connect(filter);
        filter.connect(gain);
        let finalDest: AudioNode = gain;
        if (
          (pan !== undefined && pan !== 0) ||
          (hatParams.pan !== undefined && hatParams.pan !== 0)
        ) {
          const activePan = pan !== undefined ? pan : hatParams.pan || 0;
          const panner = context.createStereoPanner();
          panner.pan.value = activePan;
          finalDest.connect(panner);
          finalDest = panner;
        }
        finalDest.connect(refs.masterGainRef.current);
        src.start(now);
        src.stop(now + hatParams.decay);
      }
    }
  };
}
