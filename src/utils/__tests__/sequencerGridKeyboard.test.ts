import { describe, it, expect } from 'vitest';
import {
    getAdjacentSequencerCell,
    keyToGridDirection,
    sequencerCellKey,
} from '../sequencerGridKeyboard';

describe('sequencerGridKeyboard', () => {
    it('maps arrow keys to directions', () => {
        expect(keyToGridDirection('ArrowLeft')).toBe('left');
        expect(keyToGridDirection('ArrowRight')).toBe('right');
        expect(keyToGridDirection('Enter')).toBeNull();
    });

    it('moves horizontally within a row', () => {
        expect(getAdjacentSequencerCell('kick', 5, 'left')).toEqual({ rowKey: 'kick', step: 4 });
        expect(getAdjacentSequencerCell('kick', 5, 'right')).toEqual({ rowKey: 'kick', step: 6 });
    });

    it('moves vertically between tracks', () => {
        expect(getAdjacentSequencerCell('kick', 3, 'up')).toEqual({ rowKey: 'bass2', step: 3 });
        expect(getAdjacentSequencerCell('kick', 3, 'down')).toEqual({ rowKey: 'snare', step: 3 });
    });

    it('clamps at grid edges', () => {
        expect(getAdjacentSequencerCell('partA', 0, 'left')).toEqual({ rowKey: 'partA', step: 0 });
        expect(getAdjacentSequencerCell('partA', 0, 'up')).toEqual({ rowKey: 'partA', step: 0 });
        expect(getAdjacentSequencerCell('sampler', 31, 'right')).toEqual({ rowKey: 'sampler', step: 31 });
    });

    it('builds stable cell keys', () => {
        expect(sequencerCellKey('snare', 12)).toBe('snare:12');
    });
});
