import { describe, it, expect } from 'vitest';
import { getAdjacentSongCell, keyToSongGridDirection } from '../songModeGridKeyboard';

describe('songModeGridKeyboard', () => {
    it('maps arrow keys to directions', () => {
        expect(keyToSongGridDirection('ArrowLeft')).toBe('left');
        expect(keyToSongGridDirection(' ')).toBeNull();
    });

    it('moves between measures on the same track', () => {
        expect(getAdjacentSongCell(2, 'kick', 'left', 8)).toEqual({ measure: 1, track: 'kick' });
        expect(getAdjacentSongCell(2, 'kick', 'right', 8)).toEqual({ measure: 3, track: 'kick' });
    });

    it('moves between tracks at the same measure', () => {
        expect(getAdjacentSongCell(1, 'kick', 'up', 4)).toEqual({ measure: 1, track: 'bass2' });
        expect(getAdjacentSongCell(1, 'kick', 'down', 4)).toEqual({ measure: 1, track: 'snare' });
    });

    it('clamps at measure boundaries', () => {
        expect(getAdjacentSongCell(0, 'partA', 'left', 4)).toEqual({ measure: 0, track: 'partA' });
        expect(getAdjacentSongCell(3, 'partA', 'right', 4)).toEqual({ measure: 3, track: 'partA' });
    });
});
