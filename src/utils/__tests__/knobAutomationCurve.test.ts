import { describe, it, expect } from 'vitest';
import { sampleLaneArcValues, interpolateLaneAtStep, smoothToward } from '../knobAutomationCurve';
import type { UnifiedAutomationLane } from '../../types';

const lane: Pick<UnifiedAutomationLane, 'points' | 'interpolation'> = {
  points: [
    { step: 0, value: 0 },
    { step: 16, value: 1 },
  ],
  interpolation: 'linear',
};

describe('knobAutomationCurve', () => {
  it('interpolates linearly between points', () => {
    expect(interpolateLaneAtStep(lane, 8)).toBeCloseTo(0.5);
  });

  it('samples arc values across the lane', () => {
    const samples = sampleLaneArcValues(lane, 32, 5);
    expect(samples).toHaveLength(5);
    expect(samples[0]).toBe(0);
    expect(samples[4]).toBe(1);
  });

  it('smooths toward target', () => {
    expect(smoothToward(0, 1, 0.5)).toBe(0.5);
  });
});
