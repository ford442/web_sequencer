import type { Note, Pattern, PartSequence } from '../../types'

type StepUpdater = (s: Note | null) => Note | null;
type NonSamplerTrackKey = Exclude<keyof Pattern, 'sampler'>;

export const updateSamplerStep = (prev: Pattern, bankIdx: number, step: number, updater: StepUpdater): Pattern => {
    const newSampler = [...prev.sampler];
    const newSteps = [...newSampler[bankIdx].steps];
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
    const newSteps = [...track.steps];
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
    const newSteps = [...newSampler[bankIdx].steps];
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
    const newSteps = [...track.steps];
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
