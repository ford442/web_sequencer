import type { Note, Pattern, PartSequence } from '../../types'

type StepUpdater = (s: Note | null) => Note | null;
type NonSamplerTrackKey = Exclude<keyof Pattern, 'sampler'>;

export const updateSamplerStep = (prev: Pattern, bankIdx: number, step: number, updater: StepUpdater): Pattern => ({
    ...prev,
    sampler: prev.sampler.map((bank, i) =>
        i === bankIdx
            ? { ...bank, steps: bank.steps.map((s, j) => (j === step ? updater(s) : s)) }
            : bank
    ),
});

export const updateTrackStep = (prev: Pattern, trackKey: keyof Pattern, step: number, updater: StepUpdater): Pattern => {
    if (trackKey === 'sampler') return prev;
    const track = prev[trackKey as NonSamplerTrackKey] as PartSequence;
    return {
        ...prev,
        [trackKey]: {
            ...track,
            steps: track.steps.map((s, j) => (j === step ? updater(s) : s)),
        },
    };
};

export const updateSamplerRange = (prev: Pattern, bankIdx: number, low: number, high: number, updater: StepUpdater): Pattern => ({
    ...prev,
    sampler: prev.sampler.map((bank, i) =>
        i === bankIdx
            ? { ...bank, steps: bank.steps.map((s, j) => (j >= low && j <= high ? updater(s) : s)) }
            : bank
    ),
});

export const updateTrackRange = (prev: Pattern, trackKey: keyof Pattern, low: number, high: number, updater: StepUpdater): Pattern => {
    if (trackKey === 'sampler') return prev;
    const track = prev[trackKey as NonSamplerTrackKey] as PartSequence;
    return {
        ...prev,
        [trackKey]: {
            ...track,
            steps: track.steps.map((s, j) => (j >= low && j <= high ? updater(s) : s)),
        },
    };
};
