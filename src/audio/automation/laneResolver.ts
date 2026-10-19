/**
 * Lane → value resolver shared by live playback and every offline render (#1384).
 *
 * Song automation lanes (`SavedSongData.automationLanes`) reach the engines
 * through two consumers: `AutomationScheduler` on the live `AudioContext`, and
 * the offline renderers (stems, AI preview, 303 freeze). Both resolve a lane's
 * value here, so the value a bounce renders on a step is the value the live
 * scheduler plays on it.
 *
 * Rules, in the order the live scheduler applied them before this module:
 *   - a lane plays when enabled, and in scope: `song`, or `pattern` with the
 *     playing pattern index (song mode: `measure % 8`, pattern mode: 0);
 *   - lanes are read at the *pattern* step (the wrapped step the clock posts),
 *     interpolated by `interpolateLaneAtStep` — except a `timeline: 'song'`
 *     lane, which Song Mode reads at the song position;
 *   - a point outside [0, 1] is rejected in dev and clamped otherwise;
 *   - the first lane per `target:parameter` with a value wins that step;
 *   - note FX parameters are not scheduled (the step handler reads them).
 */

import type { AutomationTarget, UnifiedAutomationLane } from '../../types';
import { interpolateLaneAtStep } from '../../utils/knobAutomationCurve';
import { isNoteFxParameter } from '../../sequencer/noteFx/params';
import { isMacroAutomationParam } from '../../engines/MacroParams';

// ---------------------------------------------------------------------------
// Engine units
// ---------------------------------------------------------------------------

/**
 * Hz a `SynthParams.filterCutoff` knob maps to a full-scale 303 cutoff:
 * `Open303Manager.apply*Params` sends `filterCutoff / 8000` to the worklet.
 */
export const OPEN303_CUTOFF_FULL_SCALE_HZ = 8000;
/** Same for `filterResonance` (`filterResonance / 20`). */
export const OPEN303_RESONANCE_FULL_SCALE = 20;

/** The 303 voice param a lane parameter drives (`AutomationScheduler._apply303Param`). */
export type Open303LaneParam =
  | 'cutoff'
  | 'resonance'
  | 'decay'
  | 'envMod'
  | 'accent'
  | 'slide'
  | 'volume'
  | 'drive'
  | 'tuning'
  | 'abMix';

const OPEN303_LANE_PARAMS: Readonly<Record<string, Open303LaneParam>> = {
  filterCutoff: 'cutoff',
  cutoff: 'cutoff',
  tb303Acutoff: 'cutoff',
  tb303Bcutoff: 'cutoff',
  filterResonance: 'resonance',
  resonance: 'resonance',
  tb303Aresonance: 'resonance',
  tb303Bresonance: 'resonance',
  decay: 'decay',
  tb303Adecay: 'decay',
  tb303Bdecay: 'decay',
  envMod: 'envMod',
  accent: 'accent',
  slide: 'slide',
  volume: 'volume',
  drive: 'drive',
  // TRAK TUNE controller (rbs.h tb303_event_t 0x02) → OPEN303_TUNING.
  tune: 'tuning',
  // Live high-fid A/B blend (Phase L2): 0 = stock Open303, 1 = high-fid.
  abMix: 'abMix',
};

/** The 303 param `parameter` drives on a `synthA` / `synthB` / `bass2` lane, or null. */
export function open303ParamForLane(parameter: string): Open303LaneParam | null {
  return Object.prototype.hasOwnProperty.call(OPEN303_LANE_PARAMS, parameter)
    ? OPEN303_LANE_PARAMS[parameter]
    : null;
}

/** Lane targets the live scheduler routes to a 303 voice. */
export const OPEN303_LANE_TARGETS = ['synthA', 'synthB', 'bass2'] as const;
export type Open303LaneTarget = (typeof OPEN303_LANE_TARGETS)[number];

export function isOpen303LaneTarget(target: AutomationTarget): target is Open303LaneTarget {
  return target === 'synthA' || target === 'synthB' || target === 'bass2';
}

/** Prophecy formant params the scheduler sends to a `synthA` / `synthB` Prophecy part. */
export const PROPHECY_LANE_PARAMS: ReadonlySet<string> = new Set(['vowel', 'portamento', 'formantShift']);

/** Master lanes the scheduler sends to `PcfEffect`. */
const PCF_LANE_PARAMS: ReadonlySet<string> = new Set(['pcfCutoff', 'pcfResonance', 'pcfEnvAmount']);

/**
 * Why live playback never plays a `target.parameter` lane, or null when it
 * does: the cases `AutomationScheduler._scheduleParam` dispatches, plus note FX
 * parameters (the step handler reads those). A lane with a gap is stored,
 * saved and drawn, but nothing hears it.
 */
export function laneDispatchGap(target: AutomationTarget, parameter: string): string | null {
  if (isNoteFxParameter(parameter)) return null;
  switch (target) {
    case 'synthA':
    case 'synthB':
      if (PROPHECY_LANE_PARAMS.has(parameter) || isMacroAutomationParam(parameter)) return null;
      return open303ParamForLane(parameter) ? null : `the scheduler has no ${target} case for "${parameter}"`;
    case 'bass2':
      return open303ParamForLane(parameter) ? null : `the scheduler has no bass2 case for "${parameter}"`;
    case 'master':
      return PCF_LANE_PARAMS.has(parameter)
        ? 'nothing creates the PcfEffect the scheduler sends PCF lanes to'
        : `the scheduler has no master case for "${parameter}"`;
    case 'wam':
      return null;
    default:
      return `the scheduler routes no ${target} lanes`;
  }
}

// ---------------------------------------------------------------------------
// Lane values
// ---------------------------------------------------------------------------

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Whether `lane` plays while pattern `patternIndex` is playing. */
export function isLaneActive(lane: UnifiedAutomationLane, patternIndex: number): boolean {
  if (!lane.enabled) return false;
  return lane.scope !== 'pattern' || lane.patternIndex === patternIndex;
}

/**
 * Dev-only guard for the lane value invariant: every `AutomationLanePoint.value`
 * is normalised to [0, 1] (see `AutomationLanePoint` in types.ts).  A lane that
 * stores raw engine units (Hz, 0–127 MIDI …) would be silently clamped to the
 * parameter maximum, so reject the point instead of playing a wrong value.
 *
 * @returns `true` when the value may be played.
 */
export function assertNormalizedLaneValue(
  lane: UnifiedAutomationLane,
  step: number,
  value: number,
): boolean {
  if (!import.meta.env.DEV) return true;
  if (Number.isFinite(value) && value >= 0 && value <= 1) return true;
  console.error(
    `[AutomationScheduler] Lane "${lane.name}" (${lane.target}.${lane.parameter}, ` +
    `source=${lane.source}) has a non-normalised point value ${value} at step ${step}. ` +
    'AutomationPoint.value must be in [0, 1]; originalRange is display metadata only. ' +
    'Point rejected.',
  );
  return false;
}

/**
 * The step `lane` is read at: the song position for a song-timeline lane
 * while Song Mode supplies one, else the pattern step.
 */
export function laneReadStep(
  lane: Pick<UnifiedAutomationLane, 'timeline'>,
  step: number,
  songStep: number | undefined,
): number {
  return lane.timeline === 'song' && songStep !== undefined ? songStep : step;
}

/**
 * A lane's normalised value at a (pattern) step, or null when it has none.
 * `originalRange` is display metadata and is deliberately NOT applied.
 */
export function resolveLaneValue(lane: UnifiedAutomationLane, step: number): number | null {
  const value = interpolateLaneAtStep(lane, step);
  if (value === null || !Number.isFinite(value)) return null;
  if (!assertNormalizedLaneValue(lane, step, value)) return null;
  return clamp01(value);
}

export interface ResolvedLaneValue {
  lane: UnifiedAutomationLane;
  value: number;
}

/**
 * What plays on `step` from already-active lanes: the first lane per
 * `target:parameter` that has a value, in lane order. This is the list
 * `AutomationScheduler.scheduleFromLanes` schedules.
 */
export function resolveLaneValuesAtStep(
  lanes: readonly UnifiedAutomationLane[],
  step: number,
  songStep?: number,
): ResolvedLaneValue[] {
  const out: ResolvedLaneValue[] = [];
  const seen = new Set<string>();
  for (const lane of lanes) {
    if (!lane.enabled) continue;
    // Note FX parameters shape which notes are generated; the step handler
    // reads them when it builds a pass (#1345). Nothing here could play them.
    if (isNoteFxParameter(lane.parameter)) continue;
    const key = `${lane.target}:${lane.parameter}`;
    if (seen.has(key)) continue;
    const value = resolveLaneValue(lane, laneReadStep(lane, step, songStep));
    if (value === null) continue;
    seen.add(key);
    out.push({ lane, value });
  }
  return out;
}

/**
 * The value one parameter plays at `step`: the first active lane with a value.
 * Used by the live step handler for per-note overrides.
 */
export function resolveParamAtStep(
  lanes: readonly UnifiedAutomationLane[],
  step: number,
  patternIndex: number,
  songStep?: number,
): number | null {
  for (const lane of lanes) {
    if (!isLaneActive(lane, patternIndex)) continue;
    const value = resolveLaneValue(lane, laneReadStep(lane, step, songStep));
    if (value !== null) return value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Offline timeline
// ---------------------------------------------------------------------------

/** How an offline render's flat step axis maps onto what the live clock posts. */
export interface LaneTimeline {
  /** Steps in total. */
  totalSteps: number;
  /** Song pattern length: the clock wraps here and the measure advances. */
  stepCount: number;
  /** Song mode: pattern-scoped lanes follow `measure % 8`; otherwise pattern 0. */
  songMode: boolean;
}

/** The pattern step and pattern index the live clock plays at `globalStep`. */
export function lanePositionAt(
  globalStep: number,
  timeline: Pick<LaneTimeline, 'stepCount' | 'songMode'>,
): { step: number; patternIndex: number } {
  const stepCount = Math.max(1, Math.floor(timeline.stepCount));
  const measure = Math.floor(globalStep / stepCount);
  return {
    step: globalStep - measure * stepCount,
    patternIndex: timeline.songMode ? measure % 8 : 0,
  };
}

/**
 * Resolve every lane on an offline timeline: entry `g` is what the live
 * scheduler would play on global step `g` (empty when nothing plays).
 */
export function resolveLaneTimeline(
  lanes: readonly UnifiedAutomationLane[],
  timeline: LaneTimeline,
): ResolvedLaneValue[][] {
  const out: ResolvedLaneValue[][] = [];
  if (lanes.length === 0) {
    for (let g = 0; g < timeline.totalSteps; g++) out.push([]);
    return out;
  }
  const activeByPattern = new Map<number, UnifiedAutomationLane[]>();
  for (let g = 0; g < timeline.totalSteps; g++) {
    const { step, patternIndex } = lanePositionAt(g, timeline);
    let active = activeByPattern.get(patternIndex);
    if (!active) {
      active = lanes.filter((lane) => isLaneActive(lane, patternIndex));
      activeByPattern.set(patternIndex, active);
    }
    out.push(resolveLaneValuesAtStep(active, step, timeline.songMode ? g : undefined));
  }
  return out;
}

/**
 * Per-step 303 params for one voice: entry `g` holds the params the scheduler
 * would set on global step `g`, keyed by {@link Open303LaneParam}. A step with
 * nothing to set is `undefined`. Aliases (`cutoff` / `filterCutoff`) land on
 * the same param; the later lane wins, as its message reaches the worklet last.
 */
export function resolveOpen303ParamSteps(
  resolved: readonly ResolvedLaneValue[][],
  target: Open303LaneTarget,
): Array<Partial<Record<Open303LaneParam, number>> | undefined> {
  return resolved.map((entries) => {
    let params: Partial<Record<Open303LaneParam, number>> | undefined;
    for (const { lane, value } of entries) {
      if (lane.target !== target) continue;
      const param = open303ParamForLane(lane.parameter);
      if (!param) continue;
      (params ??= {})[param] = value;
    }
    return params;
  });
}
