/**
 * Barrel re-export for the domain types that used to live directly in this
 * file (#1233/#1259 follow-up). Domain modules live in `src/types/*`; this
 * file exists only so pre-existing `from '../types'` imports keep working.
 *
 * Oscillator UI theme/image tables (`OSCILLATOR_THEMES`,
 * `OSCILLATOR_PANEL_IMAGES`, `waveformToOscillatorType`, etc.) are NOT
 * re-exported here — they moved to `src/components/oscillatorThemes.ts`
 * since they are UI helpers, not domain types.
 */
export * from './types/synth';
export * from './types/drums';
export * from './types/sampler';
export * from './types/pattern';
export * from './types/automation';
export * from './types/engine';
export * from './types/song';
