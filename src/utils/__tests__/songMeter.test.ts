import { describe, it, expect } from 'vitest';
import { stepsPerBar, stepsPerBeat, ticksPerStep, swingPercentToClock } from '@/utils/musicTheory';
import {
  gridColumns,
  lengthPresets,
  padSteps,
  resolveSongMeter,
  stepLengthPreset,
  tileSteps,
  trackStepFor,
  transportGrid,
} from '@/utils/songMeter';

describe('meter math', () => {
  it('counts 16th-note steps per bar', () => {
    expect(stepsPerBar([4, 4])).toBe(16);
    expect(stepsPerBar([3, 4])).toBe(12);
    expect(stepsPerBar([6, 8])).toBe(12);
    expect(stepsPerBar([7, 8])).toBe(14);
    expect(stepsPerBar([5, 32])).toBeNull();
    expect(stepsPerBar([4, 3])).toBeNull();
  });

  it('groups beats by denominator, compound x/8 by dotted quarter', () => {
    expect(stepsPerBeat([4, 4])).toBe(4);
    expect(stepsPerBeat([7, 8])).toBe(2);
    expect(stepsPerBeat([6, 8])).toBe(6);
    expect(stepsPerBeat([12, 8])).toBe(6);
  });

  it('keeps a step a 16th whatever the meter', () => {
    expect(ticksPerStep(24)).toBe(6);
    expect(ticksPerStep(480)).toBe(120);
  });

  it('maps MPC swing percent onto the clock range', () => {
    expect(swingPercentToClock(50)).toBe(0);
    expect(swingPercentToClock(40)).toBe(0);
    expect(swingPercentToClock(75)).toBe(1);
    expect(swingPercentToClock(100)).toBe(1);
    expect(swingPercentToClock(66.67)).toBeCloseTo(0.667, 2);
  });
});

describe('song meter', () => {
  it('resolves pre-v4 songs to 32 steps, 4/4, straight', () => {
    expect(resolveSongMeter({})).toEqual({ stepCount: 32, timeSignature: [4, 4], trackLengths: {}, swing: 50 });
    expect(resolveSongMeter(undefined).stepCount).toBe(32);
  });

  it('keeps valid fields and drops invalid ones', () => {
    const meter = resolveSongMeter({
      stepCount: 24,
      timeSignature: [3, 4],
      trackLengths: { closedHat: 12, kick: 0, bogus: 8 },
      swing: 62,
    });
    expect(meter).toEqual({ stepCount: 24, timeSignature: [3, 4], trackLengths: { closedHat: 12 }, swing: 62 });
    expect(resolveSongMeter({ stepCount: 65, timeSignature: [5, 32] })).toMatchObject({ stepCount: 32, timeSignature: [4, 4] });
  });

  it('offers whole-bar lengths for odd meters', () => {
    expect(lengthPresets([4, 4])).toEqual([8, 12, 16, 24, 32, 48, 64]);
    expect(lengthPresets([7, 8])).toEqual([8, 12, 14, 16, 24, 28, 32, 42, 48, 56, 64]);
    expect(stepLengthPreset(32, 1, [4, 4])).toBe(48);
    expect(stepLengthPreset(32, -1, [4, 4])).toBe(24);
    expect(stepLengthPreset(64, 1, [4, 4])).toBe(64);
    expect(stepLengthPreset(8, -1, [4, 4])).toBe(8);
  });

  it('derives the session grid from the meter', () => {
    expect(transportGrid({ stepCount: 24, timeSignature: [3, 4] })).toEqual({ patternSteps: 24, stepsPerBeat: 4, stepsPerBar: 12 });
  });

  it('runs track loops free in pattern mode and re-anchors them in Song Mode', () => {
    const meter = { trackLengths: { closedHat: 12 } };
    // absStep 20 on a 16-step master: master step 4
    expect(trackStepFor(meter, 'closedHat', 4, 20, false)).toBe(8);
    expect(trackStepFor(meter, 'closedHat', 4, 20, true)).toBe(4);
    expect(trackStepFor(meter, 'closedHat', 13, 13, true)).toBe(1);
    expect(trackStepFor(meter, 'kick', 4, 20, false)).toBe(4);
  });

  it('draws enough columns for the longest loop', () => {
    expect(gridColumns({ stepCount: 16, trackLengths: { partA: 24, kick: 12 } })).toBe(24);
    expect(gridColumns({ stepCount: 16, trackLengths: {} })).toBe(16);
  });

  it('pads without truncating and tiles loops', () => {
    const steps = [1, null, 3];
    expect(padSteps(steps, 2)).toBe(steps);
    expect(padSteps(steps, 5)).toEqual([1, null, 3, null, null]);
    expect(tileSteps([1, 2, 3, 4], 6, 3)).toEqual([1, 2, 3, 1, 2, 3]);
    expect(tileSteps([1], 3, 2)).toEqual([1, null, 1]);
  });
});
