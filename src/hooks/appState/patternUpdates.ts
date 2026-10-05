import type { Note, Pattern, PartSequence } from '../../types'

type StepUpdater = (s: Note | null) => Note | null;
type NonSamplerTrackKey = Exclude<keyof Pattern, 'sampler'>;

/**
 * Copy `steps`, padding with `null` up to `minLength`. Patterns can now be
 * longer than the arrays a pre-v4 song allocated, so editing past the end must
 * never leave holes.
 */
const copySteps = (steps: (Note | null)[], minLength: number): (Note | null)[] => {
    const copy = [...steps];
    for (let i = copy.length; i < minLength; i++) copy[i] = null;
    return copy;
};

export const updateSamplerStep = (prev: Pattern, bankIdx: number, step: number, updater: StepUpdater): Pattern => {
    const newSampler = [...prev.sampler];
    const newSteps = copySteps(newSampler[bankIdx].steps, step + 1);
    newSteps[step] = updater(newSteps[step]);
    newSampler[bankIdx] = { ...newSampler[bankIdx], steps: newSteps };
    return {
        ...prev,
        sampler: newSampler,
    };
};

export const updateTrackStep = (prev: Pattern, trackKey: keyof Pattern, step: number, updater: StepUpdater): Pattern => {
    if (trackKey === 'sampler') return prev;
    const track = prev[trackKey as NonSamplerTrackKey] as PartSequence;
    const newSteps = copySteps(track.steps, step + 1);
    newSteps[step] = updater(newSteps[step]);
    return {
        ...prev,
        [trackKey]: {
            ...track,
            steps: newSteps,
        },
    };
};

export const updateSamplerRange = (prev: Pattern, bankIdx: number, low: number, high: number, updater: StepUpdater): Pattern => {
    const newSampler = [...prev.sampler];
    const newSteps = copySteps(newSampler[bankIdx].steps, high + 1);
    for (let j = low; j <= high; j++) {
        newSteps[j] = updater(newSteps[j]);
    }
    newSampler[bankIdx] = { ...newSampler[bankIdx], steps: newSteps };
    return {
        ...prev,
        sampler: newSampler,
    };
};

export const updateTrackRange = (prev: Pattern, trackKey: keyof Pattern, low: number, high: number, updater: StepUpdater): Pattern => {
    if (trackKey === 'sampler') return prev;
    const track = prev[trackKey as NonSamplerTrackKey] as PartSequence;
    const newSteps = copySteps(track.steps, high + 1);
    for (let j = low; j <= high; j++) {
        newSteps[j] = updater(newSteps[j]);
    }
    return {
        ...prev,
        [trackKey]: {
            ...track,
            steps: newSteps,
        },
    };
};
