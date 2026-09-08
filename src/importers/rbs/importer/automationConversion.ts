import type {
  Tb303Step, PcfSettings, AutomationLane, HyphonAutomationLane,
} from '../types';
import { clampNormalized } from '../importer-types';
import { resolveTb303Target } from '../importOptions';
import { convertCutoffToHz } from './parameterCurves';
import type { ImporterContext } from './importerContext';

export { resolveTb303Target };

/**
 * Parameter name for a filter knob on a resolved target.
 *
 * `SynthParams` (partA/partB) names them `filterCutoff` / `filterResonance`;
 * `Bass2Params` names them `cutoff` / `resonance`.  The scheduler accepts both
 * spellings, but emitting the target's own key keeps lanes bindable to the
 * hardware knobs for that track.
 */
function filterParamForTarget(
  target: HyphonAutomationLane['target'],
  knob: 'cutoff' | 'resonance',
): string {
  if (target === 'bass2') return knob;
  return knob === 'cutoff' ? 'filterCutoff' : 'filterResonance';
}

/** Display label for a resolved TB-303 lane target. */
function trackLabelForTarget(target: HyphonAutomationLane['target']): string {
  switch (target) {
    case 'synthA': return 'TB-303 A';
    case 'synthB': return 'TB-303 B';
    case 'bass2': return 'Bass 2';
    default: return String(target);
  }
}

/** Convert PCF modulation pattern to automation points. */
export function convertPcfPatternToPoints(
  ctx: ImporterContext,
  pattern: number[],
  baseValue: number,
): [number, number][] {
  const points: [number, number][] = [];
  const numSteps = ctx.options.expandTo32Steps ? 32 : pattern.length;

  for (let i = 0; i < numSteps; i++) {
    const sourceIndex = i % pattern.length;
    const value = pattern[sourceIndex];
    const normalizedValue = Math.min(1.0, (value / 127) * (baseValue / 8000));

    if (ctx.options.quantizeTo16th) {
      points.push([i, normalizedValue]);
    } else {
      points.push([i, normalizedValue]);
    }
  }

  return points;
}

/** Convert PCF settings to Hyphon automation lanes. */
export function convertPcfToAutomation(
  ctx: ImporterContext,
  pcf: PcfSettings,
): HyphonAutomationLane[] {
  const automation: HyphonAutomationLane[] = [];

  if (!pcf.enabled) {
    return automation;
  }

  const baseCutoffHz = convertCutoffToHz(pcf.cutoff);

  if (pcf.target.tb303A) {
    const target = resolveTb303Target(ctx.options.tb303ATarget);
    automation.push({
      target,
      parameter: filterParamForTarget(target, 'cutoff'),
      name: `PCF → ${trackLabelForTarget(target)} Filter`,
      points: convertPcfPatternToPoints(ctx, pcf.pattern, baseCutoffHz),
      interpolation: ctx.options.interpolateAutomation ? 'smooth' : 'linear',
      originalRange: [0, 127],
    });
  }

  if (pcf.target.tb303B) {
    const target = resolveTb303Target(ctx.options.tb303BTarget);
    automation.push({
      target,
      parameter: filterParamForTarget(target, 'cutoff'),
      name: `PCF → ${trackLabelForTarget(target)} Filter`,
      points: convertPcfPatternToPoints(ctx, pcf.pattern, baseCutoffHz),
      interpolation: ctx.options.interpolateAutomation ? 'smooth' : 'linear',
      originalRange: [0, 127],
    });
  }

  // `pcf.target.drums` is intentionally not converted to a lane: Hyphon has no
  // per-drum-bus PCF endpoint, so a `master.drumPcfModulation` lane would only
  // schedule into a no-op.  The flag is preserved losslessly in
  // `song.rbsMetadata.pcfSettings` (and in `song.pcfFilter` when
  // `importPcfAsFilter` is set) for re-export and future routing.

  return automation;
}

/** Generate per-step accent and slide automation lanes from TB-303 step data. */
export function generateAccentSlideAutomation(
  ctx: ImporterContext,
  steps: Tb303Step[],
  target: HyphonAutomationLane['target'],
  baseAccentNorm: number,
): HyphonAutomationLane[] {
  const numSteps = ctx.options.expandTo32Steps ? 32 : steps.length;
  const accentPoints: [number, number][] = [];
  const slidePoints: [number, number][] = [];
  let hasAccent = false;
  let hasSlide = false;

  for (let i = 0; i < numSteps; i++) {
    const src = steps[i % steps.length];
    accentPoints.push([i, src.accent ? 1.0 : clampNormalized(baseAccentNorm)]);
    slidePoints.push([i, src.slide ? 1.0 : 0.0]);
    if (src.accent) hasAccent = true;
    if (src.slide) hasSlide = true;
  }

  const trackLabel = trackLabelForTarget(target);

  const lanes: HyphonAutomationLane[] = [];

  if (hasAccent) {
    lanes.push({
      target,
      parameter: 'accent',
      name: `${trackLabel} Accent`,
      points: accentPoints,
      interpolation: 'step',
      originalRange: [0, 1],
    });
  }

  if (hasSlide) {
    lanes.push({
      target,
      parameter: 'slide',
      name: `${trackLabel} Slide`,
      points: slidePoints,
      interpolation: 'step',
      originalRange: [0, 1],
    });
  }

  return lanes;
}

/** Convert automation points to normalized Hyphon format. */
export function convertAutomationPoints(
  ctx: ImporterContext,
  points: [number, number][],
  range: [number, number],
  _interpolation: 'step' | 'linear' | 'smooth',
): [number, number][] {
  const [minVal, maxVal] = range;
  const rangeSpan = maxVal - minVal || 1;
  const numSteps = ctx.options.expandTo32Steps ? 32 : 16;

  const convertedPoints: [number, number][] = [];

  for (const [stepIndex, value] of points) {
    const normalizedValue = clampNormalized((value - minVal) / rangeSpan);
    const finalStep = ctx.options.quantizeTo16th
      ? Math.round(stepIndex)
      : stepIndex;

    if (finalStep >= 0 && finalStep < numSteps) {
      convertedPoints.push([finalStep, normalizedValue]);
    }
  }

  convertedPoints.sort((a, b) => a[0] - b[0]);

  const uniquePoints: [number, number][] = [];
  let lastStep = -1;
  for (const point of convertedPoints) {
    if (point[0] !== lastStep) {
      uniquePoints.push(point);
      lastStep = point[0];
    }
  }

  return uniquePoints;
}

/** Convert a single automation lane. */
export function convertAutomationLane(
  ctx: ImporterContext,
  lane: AutomationLane,
): HyphonAutomationLane | null {
  let target: HyphonAutomationLane['target'];
  let parameter: string;
  let name: string;

  // TB-303 lanes follow the same routing option as the notes for that voice.
  const tb303A = resolveTb303Target(ctx.options.tb303ATarget);
  const tb303B = resolveTb303Target(ctx.options.tb303BTarget);

  switch (lane.parameter) {
    case 'tb303Acutoff':
      target = tb303A;
      parameter = filterParamForTarget(tb303A, 'cutoff');
      name = lane.name || `${trackLabelForTarget(tb303A)} Cutoff`;
      break;
    case 'tb303Bcutoff':
      target = tb303B;
      parameter = filterParamForTarget(tb303B, 'cutoff');
      name = lane.name || `${trackLabelForTarget(tb303B)} Cutoff`;
      break;
    case 'tb303Aresonance':
      target = tb303A;
      parameter = filterParamForTarget(tb303A, 'resonance');
      name = lane.name || `${trackLabelForTarget(tb303A)} Resonance`;
      break;
    case 'tb303Bresonance':
      target = tb303B;
      parameter = filterParamForTarget(tb303B, 'resonance');
      name = lane.name || `${trackLabelForTarget(tb303B)} Resonance`;
      break;
    case 'tb303Adecay':
      target = tb303A;
      parameter = 'decay';
      name = lane.name || `${trackLabelForTarget(tb303A)} Decay`;
      break;
    case 'tb303Bdecay':
      target = tb303B;
      parameter = 'decay';
      name = lane.name || `${trackLabelForTarget(tb303B)} Decay`;
      break;
    case 'pcfCutoff':
      target = 'master';
      // Must match the name AutomationScheduler._applyPcfParam dispatches on.
      parameter = 'pcfCutoff';
      name = lane.name || 'PCF Cutoff';
      break;
    case 'pcfResonance':
      target = 'master';
      parameter = 'pcfResonance';
      name = lane.name || 'PCF Resonance';
      break;
    case 'pcfEnvAmount':
      target = 'master';
      parameter = 'pcfEnvAmount';
      name = lane.name || 'PCF Env Amount';
      break;
    // 'tempo', 'swing' and 'masterVolume' are deliberately dropped: the
    // scheduler has no audio-clock endpoint for them (tempo/swing are transport
    // state applied from `song.tempo` / `song.swing`; master volume has no node
    // wired into AutomationScheduler), so a lane would schedule into a no-op.
    // The values remain available in `song.rbsMetadata.automation`.
    default:
      return null;
  }

  const points = convertAutomationPoints(ctx, lane.points, lane.range, lane.interpolation);

  return {
    target,
    parameter,
    name,
    points,
    interpolation: ctx.options.interpolateAutomation ? 'smooth' : lane.interpolation,
    originalRange: lane.range,
  };
}

/** Convert RBS automation lanes to Hyphon format. */
export function convertAutomationLanes(
  ctx: ImporterContext,
  lanes: AutomationLane[],
): HyphonAutomationLane[] {
  const hyphonLanes: HyphonAutomationLane[] = [];

  for (const lane of lanes) {
    const converted = convertAutomationLane(ctx, lane);
    if (converted) {
      hyphonLanes.push(converted);
    }
  }

  return hyphonLanes;
}
