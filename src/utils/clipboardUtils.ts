import type { Pattern, Note, PartSequence } from '../types';

export type TrackKey = keyof Pattern;

export interface SelectionState {
    trackKey: TrackKey;
    startStep: number;
    endStep: number;
}

/**
 * Copies a range of steps from the pattern based on the selection.
 * Returns a deep copy of the selected steps.
 */
export function copySteps(pattern: Pattern, selection: SelectionState, activeSamplerBank: number): (Note | null)[] | null {
    const { trackKey, startStep, endStep } = selection;
    const low = Math.min(startStep, endStep);
    const high = Math.max(startStep, endStep);

    let sourceSteps: (Note | null)[];

    if (trackKey === 'sampler') {
        const bank = pattern.sampler[activeSamplerBank];
        if (!bank) return null;
        sourceSteps = bank.steps;
    } else {
        // Cast to PartSequence because all other keys are PartSequence
        const part = pattern[trackKey] as PartSequence;
        if (!part) return null;
        sourceSteps = part.steps;
    }

    // Validate range
    if (low < 0 || high >= sourceSteps.length) return null;

    // Extract slice and deep clone to avoid reference issues
    const slice = sourceSteps.slice(low, high + 1);
    return slice.map(note => (note ? { ...note } : null));
}

/**
 * Pastes clipboard data into the pattern at the specified target track and step.
 * Returns a new Pattern object with the changes applied.
 */
export function pasteSteps(
    pattern: Pattern,
    clipboardData: (Note | null)[],
    targetTrack: TrackKey,
    targetStep: number,
    activeSamplerBank: number
): Pattern {
    // Shallow clone the entire pattern to ensure immutability
    const newPattern = { ...pattern };

    if (targetTrack === 'sampler') {
        newPattern.sampler = [...pattern.sampler];
        if (!newPattern.sampler[activeSamplerBank]) {
            return pattern;
        }
        newPattern.sampler[activeSamplerBank] = {
            ...newPattern.sampler[activeSamplerBank],
            steps: [...newPattern.sampler[activeSamplerBank].steps]
        };
        const maxSteps = newPattern.sampler[activeSamplerBank].steps.length;
        clipboardData.forEach((note, index) => {
            const currentStep = targetStep + index;
            if (currentStep < maxSteps) {
                newPattern.sampler[activeSamplerBank].steps[currentStep] = note ? { ...note } : null;
            }
        });
    } else {
        const part = pattern[targetTrack] as PartSequence;
        const newPart = {
            ...part,
            steps: [...part.steps]
        };
        const maxSteps = newPart.steps.length;
        clipboardData.forEach((note, index) => {
            const currentStep = targetStep + index;
            if (currentStep < maxSteps) {
                newPart.steps[currentStep] = note ? { ...note } : null;
            }
        });
        (newPattern[targetTrack] as PartSequence) = newPart;
    }

    return newPattern;
}
