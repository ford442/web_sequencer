import type { AutomationInterpolation, AutomationLanePoint, UnifiedAutomationLane } from '../types';

/** Sample a lane into normalized arc values for mini knob ghost curves. */
export function sampleLaneArcValues(
  lane: Pick<UnifiedAutomationLane, 'points' | 'interpolation'>,
  totalSteps: number,
  sampleCount = 24,
): number[] {
  if (lane.points.length === 0) return [];
  const samples: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    const step = (i / Math.max(1, sampleCount - 1)) * totalSteps;
    const v = interpolateLaneAtStep(lane, step);
    if (v !== null) samples.push(v);
  }
  return samples;
}

/** Interpolate lane value at a fractional step (shared with automation store logic). */
export function interpolateLaneAtStep(
  lane: Pick<UnifiedAutomationLane, 'points' | 'interpolation'>,
  step: number,
): number | null {
  const { points, interpolation } = lane;
  if (points.length === 0) return null;

  let before: AutomationLanePoint | null = null;
  let after: AutomationLanePoint | null = null;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.step === step) return p.value;
    if (p.step < step) {
      before = p;
    } else if (p.step > step) {
      after = p;
      break; // Points are sorted, so the first point > step is the only 'after' we need
    }
  }

  if (!before && !after) return null;
  if (!before) return after!.value;
  if (!after) return before.value;

  const interp = before.interpolation || interpolation;
  if (interp === 'step') return before.value;

  const t = (step - before.step) / (after.step - before.step);
  if (interp === 'linear') {
    return before.value + t * (after.value - before.value);
  }
  const smoothT = t * t * (3 - 2 * t);
  return before.value + smoothT * (after.value - before.value);
}

/** Build SVG path along knob arc from normalized sample values. */
export function buildKnobArcSvgPath(
  samples: number[],
  cx: number,
  cy: number,
  arcRadius: number,
  sweepStartRad: number,
  sweepTotalRad: number,
): string {
  if (samples.length < 2) return '';
  const parts: string[] = [];
  samples.forEach((v, i) => {
    const angle = sweepStartRad + v * sweepTotalRad;
    const x = cx + Math.cos(angle) * arcRadius;
    const y = cy + Math.sin(angle) * arcRadius;
    parts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
  });
  return parts.join(' ');
}

/** Exponential smoothing for live recording needle motion. */
export function smoothToward(current: number, target: number, alpha = 0.22): number {
  return current + (target - current) * alpha;
}

/** Latest value from an active recording buffer (optionally smoothed externally). */
export function getRecordingBufferValue(
  points: AutomationLanePoint[],
): number | null {
  if (points.length === 0) return null;
  return points[points.length - 1].value;
}
