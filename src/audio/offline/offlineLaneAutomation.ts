/**
 * Song automation lanes for offline renders (#1384).
 *
 * Lanes resolve through `laneResolver` — the resolver the live scheduler uses —
 * onto the render's flat step axis, then into what each offline renderer
 * takes:
 *
 * - **303 freeze / export** (`render303FreezeOffline`): per-step
 *   `Offline303Params` for `Offline303PatternData.paramSteps`. The values are
 *   the normalised ones the live scheduler sends the worklet.
 * - **Pattern renderer** (stems, AI preview): per-step filter cutoff,
 *   resonance and (303) decay in `SynthParams` units, scaled like live
 *   playback scales them.
 *
 * Whatever a renderer cannot play is listed in the report rather than dropped.
 * Only the routed targets are reported: `synthA` / `synthB` / `bass2` and the
 * PCF trio on `master`. Unrouted targets are #1387's.
 */

import type { UnifiedAutomationLane } from '../../types';
import {
  OPEN303_CUTOFF_FULL_SCALE_HZ,
  OPEN303_RESONANCE_FULL_SCALE,
  isOpen303LaneTarget,
  open303ParamForLane,
  resolveLaneTimeline,
  resolveOpen303ParamSteps,
  type LaneTimeline,
  type Open303LaneParam,
  type Open303LaneTarget,
  type ResolvedLaneValue,
} from '../automation/laneResolver';
import type { Offline303Params } from './OfflineOpen303Engine';
import { macroEngineForWaveform } from '../../engines/MacroParams';

/** Cutoff Hz a full-scale per-note override reaches (`playSynth`: `value × 20000`). */
export const SYNTH_NOTE_CUTOFF_FULL_SCALE_HZ = 20000;
/** Resonance a full-scale per-note override reaches (`playSynth`: `value × 20`). */
export const SYNTH_NOTE_RESONANCE_FULL_SCALE = 20;

const PCF_PARAMETERS = new Set(['pcfCutoff', 'pcfResonance', 'pcfEnvAmount']);

export interface OfflineAutomationSkip {
  /** `target.parameter`. */
  lane: string;
  reason: string;
}

/** What an offline render did with the song's automation lanes. */
export interface OfflineAutomationReport {
  /** `target.parameter` of every lane the render plays. */
  applied: string[];
  /** Lanes on routed targets the render could not play, and why. */
  notRendered: OfflineAutomationSkip[];
}

export const EMPTY_AUTOMATION_REPORT: OfflineAutomationReport = { applied: [], notRendered: [] };

/** Lanes that play somewhere on the timeline, one entry per `target.parameter`. */
function playedLanes(resolved: readonly ResolvedLaneValue[][]): UnifiedAutomationLane[] {
  const seen = new Map<string, UnifiedAutomationLane>();
  for (const entries of resolved) {
    for (const { lane } of entries) {
      const key = `${lane.target}.${lane.parameter}`;
      if (!seen.has(key)) seen.set(key, lane);
    }
  }
  return [...seen.values()];
}

function laneKey(lane: UnifiedAutomationLane): string {
  return `${lane.target}.${lane.parameter}`;
}

function finishReport(applied: Set<string>, skips: Map<string, string>): OfflineAutomationReport {
  return {
    applied: [...applied].sort(),
    notRendered: [...skips].map(([lane, reason]) => ({ lane, reason })).sort((a, b) => a.lane.localeCompare(b.lane)),
  };
}

const PCF_SKIP_REASON =
  'no PCF filter in the master chain — the live PcfEffect is never created either, so live playback does not play it';

// ---------------------------------------------------------------------------
// 303 freeze / export
// ---------------------------------------------------------------------------

/** `Offline303Params` field each 303 lane param drives; missing ones the offline engines lack. */
const OFFLINE_303_FIELDS: Partial<Record<Open303LaneParam, keyof Offline303Params>> = {
  cutoff: 'cutoff',
  resonance: 'resonance',
  decay: 'decay',
  envMod: 'envMod',
  accent: 'accent',
  volume: 'volume',
};

const OFFLINE_303_SKIP_REASON: Partial<Record<Open303LaneParam, string>> = {
  drive: 'the offline 303 engines have no drive stage (live: the patch strip\'s waveshaper send)',
  tuning: 'the offline 303 engines take no tuning param',
  abMix: 'the live high-fid A/B blend has no offline counterpart (freeze renders one side)',
  slide: 'slide comes from the steps; the live slide lane is a no-op too',
};

export interface Offline303Automation {
  /** For `Offline303PatternData.paramSteps`; undefined when nothing plays. */
  paramSteps: Array<Partial<Offline303Params> | undefined> | undefined;
  report: OfflineAutomationReport;
}

/**
 * Per-step `Offline303Params` for one 303 voice, on a timeline whose step `g`
 * is pattern step `g` of the offline job.
 */
export function resolveOffline303Automation(
  lanes: readonly UnifiedAutomationLane[],
  timeline: LaneTimeline,
  target: Open303LaneTarget,
): Offline303Automation {
  const resolved = resolveLaneTimeline(lanes.filter((l) => l.target === target), timeline);
  const applied = new Set<string>();
  const skips = new Map<string, string>();
  for (const lane of playedLanes(resolved)) {
    const param = open303ParamForLane(lane.parameter);
    if (!param) continue;
    if (OFFLINE_303_FIELDS[param]) applied.add(laneKey(lane));
    else skips.set(laneKey(lane), OFFLINE_303_SKIP_REASON[param] ?? 'not modelled offline');
  }

  let any = false;
  const paramSteps = resolveOpen303ParamSteps(resolved, target).map((params) => {
    if (!params) return undefined;
    let out: Partial<Offline303Params> | undefined;
    for (const [param, value] of Object.entries(params) as Array<[Open303LaneParam, number]>) {
      const field = OFFLINE_303_FIELDS[param];
      if (field) (out ??= {})[field] = value;
    }
    if (out) any = true;
    return out;
  });
  return { paramSteps: any ? paramSteps : undefined, report: finishReport(applied, skips) };
}

// ---------------------------------------------------------------------------
// Pattern renderer (stems, AI preview)
// ---------------------------------------------------------------------------

/**
 * Filter automation for `renderSynthPattern`, per global step in `SynthParams`
 * units (`filterCutoff` Hz, `filterResonance` Q). `null`: the lane plays
 * nothing there, so the knob value stands.
 */
export interface PatternAutomation {
  filterCutoff?: ReadonlyArray<number | null>;
  filterResonance?: ReadonlyArray<number | null>;
  /**
   * 303 voices only: the envelope decay (the 303 knob's 0–1, which is what
   * the stem renderer's envelope reads). Taken at each note's start.
   */
  decay?: ReadonlyArray<number | null>;
  /**
   * `true` for a 303 voice: the scheduler sets the param on every step, so it
   * moves inside a held note. `false`: a note keeps the value it started with,
   * as the step handler's per-note override does.
   */
  perStep: boolean;
}

export interface SynthLaneVoice {
  target: Open303LaneTarget;
  /** The track's waveform as the user set it (`bass2` is always a 303). */
  waveform: string;
}

export interface SynthLaneAutomation {
  byTarget: Partial<Record<Open303LaneTarget, PatternAutomation>>;
  report: OfflineAutomationReport;
}

function is303Voice(voice: SynthLaneVoice): boolean {
  return voice.target === 'bass2' || voice.waveform === '303-saw' || voice.waveform === '303-sqr';
}

const PATTERN_FIELDS: Partial<Record<Open303LaneParam, 'filterCutoff' | 'filterResonance' | 'decay'>> = {
  cutoff: 'filterCutoff',
  resonance: 'filterResonance',
  decay: 'decay',
};

/**
 * Resolve lanes for the pattern renderer's synth voices, and report every
 * routed lane it cannot play (master PCF, params the renderer has no stage for,
 * macro voices).
 */
export function resolveSynthLaneAutomation(
  lanes: readonly UnifiedAutomationLane[],
  timeline: LaneTimeline,
  voices: readonly SynthLaneVoice[],
): SynthLaneAutomation {
  const resolved = resolveLaneTimeline(lanes, timeline);
  const applied = new Set<string>();
  const skips = new Map<string, string>();
  const voiceFor = new Map(voices.map((v) => [v.target, v]));

  for (const lane of playedLanes(resolved)) {
    if (lane.target === 'master' && PCF_PARAMETERS.has(lane.parameter)) {
      skips.set(laneKey(lane), PCF_SKIP_REASON);
      continue;
    }
    if (!isOpen303LaneTarget(lane.target)) continue;
    const param = open303ParamForLane(lane.parameter);
    if (!param) continue;
    const voice = voiceFor.get(lane.target);
    if (!voice) continue;
    if (macroEngineForWaveform(voice.waveform)) {
      skips.set(laneKey(lane), 'macro voices render offline without filter automation');
    } else if (param === 'decay' && !is303Voice(voice)) {
      skips.set(laneKey(lane), 'decay lanes drive the 303 voice only; this track is not on a 303 waveform');
    } else if (PATTERN_FIELDS[param]) {
      applied.add(laneKey(lane));
    } else {
      skips.set(laneKey(lane), `the stem renderer has no ${param} stage (it does not play the knob value either)`);
    }
  }

  const byTarget: SynthLaneAutomation['byTarget'] = {};
  for (const voice of voices) {
    if (macroEngineForWaveform(voice.waveform)) continue;
    const perStep = is303Voice(voice);
    const cutoffScale = perStep ? OPEN303_CUTOFF_FULL_SCALE_HZ : SYNTH_NOTE_CUTOFF_FULL_SCALE_HZ;
    const resonanceScale = perStep ? OPEN303_RESONANCE_FULL_SCALE : SYNTH_NOTE_RESONANCE_FULL_SCALE;
    const steps = resolveOpen303ParamSteps(resolved, voice.target);
    // Floor at 20 Hz like playSynth: a biquad at 0 Hz is silence, not a closed 303 filter.
    const cutoff = steps.map((p) => (p?.cutoff !== undefined ? Math.max(20, p.cutoff * cutoffScale) : null));
    const resonance = steps.map((p) => (p?.resonance !== undefined ? p.resonance * resonanceScale : null));
    const decay = perStep ? steps.map((p) => p?.decay ?? null) : [];
    const has = (values: Array<number | null>) => values.some((v) => v !== null);
    if (!has(cutoff) && !has(resonance) && !has(decay)) continue;
    byTarget[voice.target] = {
      ...(has(cutoff) ? { filterCutoff: cutoff } : {}),
      ...(has(resonance) ? { filterResonance: resonance } : {}),
      ...(has(decay) ? { decay } : {}),
      perStep,
    };
  }
  return { byTarget, report: finishReport(applied, skips) };
}
