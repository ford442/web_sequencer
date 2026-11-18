/**
 * The PCF worklet's control-plane vocabulary (#1497 follow-up P1): what the
 * `target` of a PARAM_SET record means to pcf-processor, and its one
 * engine-private record type.
 *
 * The master `pcf*` automation lanes used to reach the worklet through a
 * main-thread setTimeout and a `set-automation` port message, so they landed
 * on whatever block was rendering when the timer fired. They are now
 * PARAM_SET records stamped with their frame; the worklet splits its block on
 * that frame.
 *
 * Real-time shared code (src/shared/rt/tsconfig.json): ES2022 only.
 */

import { EventType } from './eventLayout';

/** PARAM_SET `target` ids of the PCF's automation overrides. */
export const PcfParam = {
  /** Absolute cutoff in Hz, overriding the pattern-driven cutoff. */
  CutoffHz: 0,
  /** Resonance 0–127, overriding the resonance knob. */
  ResonanceMidi: 1,
  /** Envelope amount 0–1, overriding the env-amount knob. */
  EnvAmountNorm: 2,
} as const;

export type PcfParamId = (typeof PcfParam)[keyof typeof PcfParam];

/** PARAM_SET `value` that clears an override (every override's real range is >= 0). */
export const PCF_PARAM_CLEAR = -1;

/**
 * Engine-private type: drop the PARAM_SET records still waiting for their
 * frame, as the worklet takes this one from its inbox (a transport stop: the
 * lookahead already sent values for steps that will not play).
 */
export const PCF_CANCEL_SCHEDULED = EventType.Engine;
