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
    return JSON.parse(JSON.stringify(slice));
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
    // Deep clone the entire pattern to ensure immutability
    const newPattern = JSON.parse(JSON.stringify(pattern)) as Pattern;

    let targetSteps: (Note | null)[];

    if (targetTrack === 'sampler') {
        // Ensure the bank exists (it should, based on initialization)
        if (!newPattern.sampler[activeSamplerBank]) {
             // If for some reason it doesn't exist, we can't paste. Return original.
             return pattern;
        }
        targetSteps = newPattern.sampler[activeSamplerBank].steps;
    } else {
        targetSteps = (newPattern[targetTrack] as PartSequence).steps;
    }

    const maxSteps = targetSteps.length;

    clipboardData.forEach((note, index) => {
        const currentStep = targetStep + index;
        if (currentStep < maxSteps) {
             // Deep clone the note from clipboard to avoid shared references across pastes
             targetSteps[currentStep] = note ? JSON.parse(JSON.stringify(note)) : null;
        }
    });

    return newPattern;
}
