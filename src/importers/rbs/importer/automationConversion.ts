import type {
  Tb303Step, PcfSettings, AutomationLane, HyphonAutomationLane,
} from '../types';
import { clampNormalized } from '../importer-types';
import { convertCutoffToHz } from './parameterCurves';
import type { ImporterContext } from './importerContext';

/** Resolve a tb303ATarget / tb303BTarget option string to HyphonAutomationLane target. */
export function resolveTb303Target(
  option: 'partA' | 'partB' | 'bass2',
): HyphonAutomationLane['target'] {
  switch (option) {
    case 'bass2': return 'bass2';
    case 'partB': return 'synthB';
    case 'partA':
    default: return 'synthA';
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
    automation.push({
      target: 'synthA',
      parameter: 'filterCutoff',
      name: 'PCF → Synth A Filter',
      points: convertPcfPatternToPoints(ctx, pcf.pattern, baseCutoffHz),
      interpolation: ctx.options.interpolateAutomation ? 'smooth' : 'linear',
      originalRange: [0, 127],
    });
  }

  if (pcf.target.tb303B) {
    automation.push({
      target: 'synthB',
      parameter: 'filterCutoff',
      name: 'PCF → Synth B Filter',
      points: convertPcfPatternToPoints(ctx, pcf.pattern, baseCutoffHz),
      interpolation: ctx.options.interpolateAutomation ? 'smooth' : 'linear',
      originalRange: [0, 127],
    });
  }

  if (pcf.target.drums) {
    automation.push({
      target: 'master',
      parameter: 'drumPcfModulation',
      name: 'PCF → Drum Filter',
      points: convertPcfPatternToPoints(ctx, pcf.pattern, pcf.envAmount / 127),
      interpolation: ctx.options.interpolateAutomation ? 'smooth' : 'linear',
      originalRange: [0, 127],
    });
  }

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

  const trackLabel =
    target === 'synthA' ? 'TB-303 A' :
      target === 'synthB' ? 'TB-303 B' :
        'Bass 2';

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

  switch (lane.parameter) {
    case 'tempo':
      target = 'master';
      parameter = 'tempo';
      name = lane.name || 'Tempo';
      break;
    case 'swing':
      target = 'master';
      parameter = 'swing';
      name = lane.name || 'Swing';
      break;
    case 'tb303Acutoff':
      target = 'synthA';
      parameter = 'filterCutoff';
      name = lane.name || 'TB-303 A Cutoff';
      break;
    case 'tb303Bcutoff':
      target = 'synthB';
      parameter = 'filterCutoff';
      name = lane.name || 'TB-303 B Cutoff';
      break;
    case 'tb303Aresonance':
      target = 'synthA';
      parameter = 'filterResonance';
      name = lane.name || 'TB-303 A Resonance';
      break;
    case 'tb303Bresonance':
      target = 'synthB';
      parameter = 'filterResonance';
      name = lane.name || 'TB-303 B Resonance';
      break;
    case 'tb303Adecay':
      target = 'synthA';
      parameter = 'decay';
      name = lane.name || 'TB-303 A Decay';
      break;
    case 'tb303Bdecay':
      target = 'synthB';
      parameter = 'decay';
      name = lane.name || 'TB-303 B Decay';
      break;
    case 'pcfCutoff':
      target = 'master';
      parameter = 'pcfModulation';
      name = lane.name || 'PCF Modulation';
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
    case 'masterVolume':
      target = 'master';
      parameter = 'volume';
      name = lane.name || 'Master Volume';
      break;
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
