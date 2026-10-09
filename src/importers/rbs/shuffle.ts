/**
 * ReBirth shuffle ↔ Hyphon song swing.
 *
 * ReBirth's GLOB chunk stores shuffle as 0–127 with 64 = no shuffle (the
 * jsynth corpus files read 64 and 69). Hyphon song swing is an MPC-style
 * percent, 0–100 with 50 = straight and 75 = the hardest the clock plays.
 * The mapping is linear around the neutral points: 64 → 50, 127 → 75, 0 → ~25
 * (values under 50 play straight). This is the only place the units convert;
 * `RawRbsData.project.swing` is always song percent.
 */

export const RBS_SHUFFLE_NEUTRAL = 64;
const RBS_SHUFFLE_MAX = 127;
const SWING_STRAIGHT = 50;
const SWING_SPAN = 25;

/** ReBirth GLOB shuffle (0–127, 64 = none) → song swing percent (50 = straight). */
export function rbsShuffleToSwingPercent(shuffle: number): number {
  if (!Number.isFinite(shuffle)) return SWING_STRAIGHT;
  const clamped = Math.max(0, Math.min(RBS_SHUFFLE_MAX, shuffle));
  const span = RBS_SHUFFLE_MAX - RBS_SHUFFLE_NEUTRAL;
  return SWING_STRAIGHT + ((clamped - RBS_SHUFFLE_NEUTRAL) / span) * SWING_SPAN;
}

/** Song swing percent (50 = straight) → ReBirth GLOB shuffle (0–127, 64 = none). */
export function swingPercentToRbsShuffle(percent: number | undefined): number {
  if (percent === undefined || !Number.isFinite(percent)) return RBS_SHUFFLE_NEUTRAL;
  const span = RBS_SHUFFLE_MAX - RBS_SHUFFLE_NEUTRAL;
  const shuffle = RBS_SHUFFLE_NEUTRAL + ((percent - SWING_STRAIGHT) / SWING_SPAN) * span;
  return Math.max(0, Math.min(RBS_SHUFFLE_MAX, Math.round(shuffle)));
}
