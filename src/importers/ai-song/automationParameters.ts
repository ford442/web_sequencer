/**
 * Which `parameter` an AI song automation lane may name for each `target`.
 *
 * Its own module, free of runtime imports, so `scripts/gen-ai-song-schema.ts`
 * can read it without loading the importer's storage layer. The validator
 * (`validateAISongData`) and the generated JSON Schema both use this table.
 */

import type { AIAutomationTarget, AITargetedParameter } from './types';

/** Valid parameters for each target */
export const VALID_PARAMETERS_BY_TARGET: Record<AIAutomationTarget, AITargetedParameter[]> = {
  synthA: ['filterCutoff', 'filterResonance', 'filterMode', 'decay', 'accent', 'envMod', 'waveform', 'pitch', 'volume', 'drive', 'delayTime', 'delayFeedback', 'delayMix', 'macroHarmonics', 'macroTimbre', 'macroMorph', 'macroDecay', 'macroLpgColour', 'macroFmMod', 'macroTimbreMod', 'macroMorphMod', 'macroGlide', 'macroSpread'],
  synthB: ['filterCutoff', 'filterResonance', 'filterMode', 'decay', 'accent', 'envMod', 'waveform', 'pitch', 'volume', 'drive', 'delayTime', 'delayFeedback', 'delayMix', 'macroHarmonics', 'macroTimbre', 'macroMorph', 'macroDecay', 'macroLpgColour', 'macroFmMod', 'macroTimbreMod', 'macroMorphMod', 'macroGlide', 'macroSpread'],
  bass2: ['filterCutoff', 'filterResonance', 'filterMode', 'decay', 'accent', 'envMod', 'waveform', 'pitch', 'volume', 'drive'],
  kick: ['pitch', 'decay', 'tone', 'volume'],
  snare: ['decay', 'tone', 'noise', 'volume'],
  closedHat: ['pitch', 'decay', 'volume'],
  openHat: ['pitch', 'decay', 'volume'],
  sampler: ['filterCutoff', 'filterResonance', 'drive', 'volume', 'playbackSpeed'],
  master: ['tempo', 'swing', 'masterVolume']
};
