import type { LaunchQuantization, TransportClockSnapshot } from './types';

export interface QuantizeResult {
  /** Pattern-local step (0 … patternSteps-1) where the launch applies. */
  step: number;
  /** AudioTime of that boundary. */
  audioTime: number;
  /** Steps from the origin step along the infinite timeline (>= 0). */
  deltaSteps: number;
  timelineStep: number;
}

function quantGrid(quant: LaunchQuantization, clock: TransportClockSnapshot): number {
  switch (quant) {
    case 'immediate':
      return 1;
    case 'step':
      return 1;
    case 'beat':
      return clock.stepsPerBeat;
    case 'bar':
      return clock.stepsPerBar;
    case '2bars':
      return clock.stepsPerBar * 2;
    case '4bars':
      return clock.stepsPerBar * 4;
    default:
      return clock.stepsPerBar;
  }
}

export function secondsPerStep(tempo: number): number {
  return 60 / tempo / 4;
}

/**
 * Map a launch request onto the next quantization boundary of the audio timeline.
 *
 * Uses only the last known worklet step timestamp — never `performance.now()` or
 * React render time — so a stalled UI cannot shift the scheduled boundary.
 *
 * `immediate` applies at the current step's audioTime when the request arrived
 * on that step; otherwise it still waits for the next step so we never schedule
 * in the past relative to the last processed tick.
 */
export function quantizeLaunch(
  quant: LaunchQuantization,
  clock: TransportClockSnapshot,
  requestStep: number,
  requestAudioTime: number,
  timelineOriginStep = 0,
): QuantizeResult {
  const stepDur = secondsPerStep(clock.tempo);
  const pattern = Math.max(1, clock.patternSteps);
  const originStep = ((clock.step % pattern) + pattern) % pattern;
  const originTime = clock.audioTime;
  const originTimeline = timelineOriginStep;

  if (quant === 'immediate') {
    const late = requestAudioTime > originTime + stepDur * 0.5;
    if (!late) {
      return {
        step: originStep,
        audioTime: originTime,
        deltaSteps: 0,
        timelineStep: originTimeline,
      };
    }
    const deltaSteps = 1;
    return {
      step: (originStep + 1) % pattern,
      audioTime: originTime + stepDur,
      deltaSteps,
      timelineStep: originTimeline + deltaSteps,
    };
  }

  const grid = quantGrid(quant, clock);
  const abs = originTimeline;
  // If the request is processed on a boundary that already matches the grid
  // and arrived no later than this step's audioTime, fire on this step.
  const onGrid = abs % grid === 0;
  const arrivedOnThisStep =
    requestStep === originStep && requestAudioTime <= originTime + stepDur * 0.25;

  let deltaSteps: number;
  if (onGrid && arrivedOnThisStep) {
    deltaSteps = 0;
  } else {
    const rem = abs % grid;
    deltaSteps = rem === 0 ? grid : grid - rem;
  }

  return {
    step: (originStep + deltaSteps) % pattern,
    audioTime: originTime + deltaSteps * stepDur,
    deltaSteps,
    timelineStep: originTimeline + deltaSteps,
  };
}

export function nextFollowBoundary(
  clock: TransportClockSnapshot,
  startedTimelineStep: number,
  clipLengthSteps: number,
  timelineOriginStep: number,
): QuantizeResult | null {
  if (clipLengthSteps <= 0) return null;
  const elapsed = timelineOriginStep - startedTimelineStep;
  if (elapsed < 0) return null;
  if (elapsed > 0 && elapsed % clipLengthSteps === 0) {
    return {
      step: clock.step,
      audioTime: clock.audioTime,
      deltaSteps: 0,
      timelineStep: timelineOriginStep,
    };
  }
  return null;
}
