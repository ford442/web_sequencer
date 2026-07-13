import type { RawRbsData, Tb303Step } from '../types';
import type { Pattern, PartSequence, Note } from '../../../types';
import { midiToNote } from '../../../utils/musicTheory';
import { convertAccentToBoost } from './parameterCurves';
import type { ImporterContext } from './importerContext';

/** Get default note for drum type. */
function getDefaultDrumNote(drumType: string): string {
  switch (drumType) {
    case 'kick': return 'C2';
    case 'snare': return 'D2';
    case 'closedHat': return 'F#2';
    case 'openHat': return 'A#2';
    default: return 'C3';
  }
}

/** Convert TB-303 pattern steps to Hyphon PartSequence. */
export function convertTb303ToPartSequence(
  ctx: ImporterContext,
  tb303: { steps: Tb303Step[] },
  numSteps: number,
  _isBassTrack: boolean,
): PartSequence {
  const steps: (Note | null)[] = Array(numSteps).fill(null);

  for (let i = 0; i < tb303.steps.length && i < numSteps; i++) {
    const step = tb303.steps[i];

    if (step.note === -1 || step.tie) {
      steps[i] = null;
      continue;
    }

    const midiNote = (step.octave + 1) * 12 + step.note;
    const noteName = midiToNote(midiNote);

    steps[i] = {
      note: noteName,
      velocity: step.accent ? 1.0 : 0.8,
      length: step.slide ? 2 : 1,
      slide: step.slide,
      timbre: 0.5,
    };

    if (step.slide) ctx.stepStats.slideCount++;
    if (step.accent) ctx.stepStats.accentCount++;
    if (step.tie) ctx.stepStats.tieCount++;
  }

  if (numSteps === 32 && tb303.steps.length === 16) {
    for (let i = 16; i < 32; i++) {
      const sourceStep = steps[i - 16];
      if (sourceStep) {
        steps[i] = { ...sourceStep };
      }
    }
  }

  ctx.stepStats.totalSteps += steps.length;
  return { steps };
}

/** Expand 16-step RBS pattern to 32-step Hyphon pattern. */
export function expandPattern16To32(
  ctx: ImporterContext,
  steps16: Tb303Step[],
  _isBassTrack: boolean,
): PartSequence {
  const steps32: (Note | null)[] = Array(32).fill(null);

  for (let i = 0; i < 16; i++) {
    const sourceStep = steps16[i];

    if (sourceStep.tie) {
      ctx.stepStats.tieCount++;
      continue;
    }

    if (sourceStep.note === -1) {
      continue;
    }

    const targetIndex1 = i * 2;

    let tieCount = 0;
    while (i + 1 + tieCount < 16 && steps16[i + 1 + tieCount].tie) {
      tieCount++;
      ctx.stepStats.tieCount++;
    }

    const midiNote = (sourceStep.octave + 1) * 12 + sourceStep.note;
    const noteName = midiToNote(midiNote);

    const baseVelocity = 0.8;
    const accentBoost = sourceStep.accent ? convertAccentToBoost(127) : 0;
    const velocity1 = Math.min(1.0, baseVelocity + accentBoost);

    if (sourceStep.slide) ctx.stepStats.slideCount++;
    if (sourceStep.accent) ctx.stepStats.accentCount++;

    if (sourceStep.slide) {
      steps32[targetIndex1] = {
        note: noteName,
        velocity: velocity1,
        length: 2,
        slide: true,
        timbre: 0.5,
      };
      steps32[targetIndex1 + 1] = null;
      continue;
    }

    const sustainSubSteps = tieCount > 0 ? (1 + tieCount) * 2 : 1;
    steps32[targetIndex1] = {
      note: noteName,
      velocity: velocity1,
      length: sustainSubSteps,
      slide: false,
      timbre: 0.5,
    };
  }

  ctx.stepStats.totalSteps += 32;
  return { steps: steps32 };
}

/** Convert drum pattern boolean array to PartSequence. */
export function convertDrumPattern(
  drumSteps: boolean[],
  numSteps: number,
  drumType: 'kick' | 'snare' | 'closedHat' | 'openHat',
): PartSequence {
  const steps: (Note | null)[] = Array(numSteps).fill(null);
  const defaultNote = getDefaultDrumNote(drumType);

  for (let i = 0; i < drumSteps.length && i < numSteps; i++) {
    if (drumSteps[i]) {
      steps[i] = {
        note: defaultNote,
        velocity: 1.0,
        length: 1,
        timbre: 0.5,
      };
    }
  }

  if (numSteps === 32 && drumSteps.length === 16) {
    for (let i = 16; i < 32; i++) {
      const sourceStep = steps[i - 16];
      if (sourceStep) {
        steps[i] = { ...sourceStep };
      }
    }
  }

  return { steps };
}

/** Convert RBS patterns to Hyphon Pattern. */
export function convertPattern(ctx: ImporterContext, raw: RawRbsData, _warnings: string[]): Pattern {
  const numSteps = ctx.options.expandTo32Steps ? 32 : raw.project.patternLength;
  const isExpansion = numSteps === 32 && raw.project.patternLength === 16;

  let partA: PartSequence;
  if (isExpansion) {
    partA = expandPattern16To32(
      ctx,
      raw.tb303PatternA.steps,
      ctx.options.tb303ATarget === 'bass2',
    );
  } else {
    partA = convertTb303ToPartSequence(
      ctx,
      raw.tb303PatternA,
      numSteps,
      ctx.options.tb303ATarget === 'bass2',
    );
  }

  let partB: PartSequence;
  if (isExpansion) {
    partB = expandPattern16To32(
      ctx,
      raw.tb303PatternB.steps,
      ctx.options.tb303BTarget === 'bass2',
    );
  } else {
    partB = convertTb303ToPartSequence(
      ctx,
      raw.tb303PatternB,
      numSteps,
      ctx.options.tb303BTarget === 'bass2',
    );
  }

  const kick = convertDrumPattern(raw.drums.kick, numSteps, 'kick');
  const snare = convertDrumPattern(raw.drums.snare, numSteps, 'snare');
  const closedHat = convertDrumPattern(raw.drums.closedHat, numSteps, 'closedHat');
  const openHat = convertDrumPattern(raw.drums.openHat, numSteps, 'openHat');

  const pattern: Pattern = {
    partA,
    partB,
    bass2: ctx.options.tb303ATarget === 'bass2' ? partA :
      ctx.options.tb303BTarget === 'bass2' ? partB :
        { steps: Array(numSteps).fill(null) },
    kick,
    snare,
    closedHat,
    openHat,
    sampler: Array(8).fill(null).map(() => ({ steps: Array(numSteps).fill(null) })),
  };

  return pattern;
}
