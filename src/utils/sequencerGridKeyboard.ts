import type { TrackKey } from '../types';

export const SEQUENCER_ROW_KEYS: TrackKey[] = [
    'partA',
    'partB',
    'bass2',
    'kick',
    'snare',
    'closedHat',
    'openHat',
    'sampler',
];

export type SequencerCellCoord = { rowKey: TrackKey; step: number };

export type GridDirection = 'left' | 'right' | 'up' | 'down';

export function keyToGridDirection(key: string): GridDirection | null {
    switch (key) {
        case 'ArrowLeft':
            return 'left';
        case 'ArrowRight':
            return 'right';
        case 'ArrowUp':
            return 'up';
        case 'ArrowDown':
            return 'down';
        default:
            return null;
    }
}

export function getAdjacentSequencerCell(
    rowKey: TrackKey,
    step: number,
    direction: GridDirection,
    numSteps = 32,
): SequencerCellCoord {
    const rowIndex = SEQUENCER_ROW_KEYS.indexOf(rowKey);
    if (direction === 'left') {
        return { rowKey, step: Math.max(0, step - 1) };
    }
    if (direction === 'right') {
        return { rowKey, step: Math.min(numSteps - 1, step + 1) };
    }
    if (direction === 'up' && rowIndex > 0) {
        return { rowKey: SEQUENCER_ROW_KEYS[rowIndex - 1], step };
    }
    if (direction === 'down' && rowIndex >= 0 && rowIndex < SEQUENCER_ROW_KEYS.length - 1) {
        return { rowKey: SEQUENCER_ROW_KEYS[rowIndex + 1], step };
    }
    return { rowKey, step };
}

export function sequencerCellKey(rowKey: TrackKey, step: number): string {
    return `${rowKey}:${step}`;
}
