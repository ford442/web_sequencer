import { describe, expect, it } from 'vitest';
import { passesThrough, resolveRollKey, type RollKeyEvent } from '../model/rollKeyboard';

const key = (k: string, mods: Partial<RollKeyEvent> = {}): RollKeyEvent => ({
    key: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...mods,
});

describe('resolveRollKey', () => {
    it('moves the cursor by the grid unit, a beat with Shift, an octave vertically with Shift', () => {
        expect(resolveRollKey(key('ArrowRight'), 0.5)).toEqual({ type: 'cursor', dPosition: 0.5, dPitch: 0 });
        expect(resolveRollKey(key('ArrowLeft', { shiftKey: true }), 1)).toEqual({ type: 'cursor', dPosition: -4, dPitch: 0 });
        expect(resolveRollKey(key('ArrowUp', { shiftKey: true }), 1)).toEqual({ type: 'cursor', dPosition: 0, dPitch: 12 });
        expect(resolveRollKey(key('PageDown'), 1)).toEqual({ type: 'cursor', dPosition: 0, dPitch: -12 });
    });

    it('maps Alt+arrows to moves and resizes, Ctrl+arrows to note jumps', () => {
        expect(resolveRollKey(key('ArrowDown', { altKey: true }), 1)).toEqual({ type: 'move', dPosition: 0, dPitch: -1 });
        expect(resolveRollKey(key('ArrowRight', { altKey: true }), 0.25)).toEqual({ type: 'move', dPosition: 0.25, dPitch: 0 });
        expect(resolveRollKey(key('ArrowRight', { altKey: true, shiftKey: true }), 1)).toEqual({ type: 'resize', dLength: 1 });
        expect(resolveRollKey(key('ArrowLeft', { ctrlKey: true }), 1)).toEqual({ type: 'jumpNote', direction: -1 });
    });

    it('covers every pointer edit with a key', () => {
        expect(resolveRollKey(key('Enter'), 1)?.type).toBe('toggleAtCursor');
        expect(resolveRollKey(key('Enter', { shiftKey: true }), 1)).toEqual({ type: 'selectAtCursor', additive: true });
        expect(resolveRollKey(key('Delete'), 1)?.type).toBe('delete');
        expect(resolveRollKey(key(']'), 1)).toEqual({ type: 'resize', dLength: 1 });
        expect(resolveRollKey(key('d', { metaKey: true }), 1)?.type).toBe('duplicate');
        expect(resolveRollKey(key('Q'), 1)?.type).toBe('quantize');
        expect(resolveRollKey(key('l'), 1)?.type).toBe('lockToScale');
        expect(resolveRollKey(key('s'), 1)?.type).toBe('slide');
        expect(resolveRollKey(key('='), 1)).toEqual({ type: 'velocity', delta: 0.1 });
        expect(resolveRollKey(key('a', { ctrlKey: true }), 1)?.type).toBe('selectAll');
        expect(resolveRollKey(key('c', { ctrlKey: true }), 1)?.type).toBe('copy');
        expect(resolveRollKey(key('v', { ctrlKey: true }), 1)?.type).toBe('paste');
        expect(resolveRollKey(key('Escape'), 1)?.type).toBe('escape');
        expect(resolveRollKey(key('?'), 1)?.type).toBe('help');
        expect(resolveRollKey(key('x'), 1)).toBeNull();
    });

    it('leaves Space, Tab and undo/redo to the app', () => {
        expect(passesThrough(key(' '))).toBe(true);
        expect(passesThrough(key('Tab', { shiftKey: true }))).toBe(true);
        expect(passesThrough(key('z', { ctrlKey: true }))).toBe(true);
        expect(passesThrough(key('Y', { metaKey: true }))).toBe(true);
        expect(passesThrough(key('Escape'))).toBe(false);
        expect(passesThrough(key('Delete'))).toBe(false);
        expect(passesThrough(key('a'))).toBe(false);
    });
});
