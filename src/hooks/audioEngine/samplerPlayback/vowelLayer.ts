import {
  crossfadeCurve,
  type ConcatenativeHybrid,
  type VowelLayerPlan,
} from "../../../engines/rubberband/ConcatenativeHybrid";
import type { AlignmentResult } from "../../../engines/rubberband/PhonemeAligner";
import type { SamplerBankParams } from "../../../types";

/**
 * One voice's part in a note that hands over from TTS to a vowel loop (V2).
 * `tts` is the bank's phrase, faded out; `vowel` is the loop, faded in.
 */
export interface VowelLayerRole {
  plan: VowelLayerPlan;
  role: "tts" | "vowel";
}

/** Points in the crossfade gain curve (setValueCurveAtTime interpolates between them). */
const CURVE_POINTS = 64;

/**
 * The vowel layer for one note, or null when it stays TTS: the bank flag is
 * off, the pack is not loaded, the bank plays phoneme slices, or the planner's
 * duration gate says no.
 */
export function planVowelLayer(
  hybrid: ConcatenativeHybrid | null | undefined,
  params: SamplerBankParams,
  durationSec: number,
  midiNote: number | null,
  alignment: AlignmentResult | null | undefined,
): VowelLayerPlan | null {
  if (!hybrid || !params.useVowelSamplesOnLongNotes || params.sliceMode === "phoneme" || midiNote === null) {
    return null;
  }
  return hybrid.planNote({ durationSec, midiNote, alignment, minNoteDurationMs: params.minNoteDurationMs });
}

/**
 * A gain between the voice and its FX strip that follows the crossfade:
 * the TTS voice falls 1 → 0, the vowel voice rises 0 → 1, both starting at
 * `noteStart + plan.crossfadeStart`. Returns the node to connect the voice to.
 */
export function connectVowelCrossfade(
  context: BaseAudioContext,
  layer: VowelLayerRole,
  noteStart: number,
  destination: AudioNode,
): GainNode {
  const { plan, role } = layer;
  const direction = role === "vowel" ? "in" : "out";
  const gain = context.createGain();
  // The vowel voice sounds from message arrival (before noteStart): start silent.
  gain.gain.value = direction === "in" ? 0 : 1;
  gain.gain.setValueAtTime(gain.gain.value, Math.max(0, noteStart));
  gain.gain.setValueCurveAtTime(
    crossfadeCurve(plan.curve, CURVE_POINTS, direction),
    Math.max(0, noteStart + plan.crossfadeStart),
    plan.crossfadeDuration,
  );
  gain.connect(destination);
  return gain;
}
