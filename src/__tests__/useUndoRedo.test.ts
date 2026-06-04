// Tests for useUndoRedo — pure ring-buffer undo/redo without React rendering.
// We call the hook via renderHook from @testing-library/react.

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUndoRedo } from '../hooks/useUndoRedo';

describe('useUndoRedo', () => {
    it('starts empty — canUndo and canRedo are both false', () => {
        const { result } = renderHook(() => useUndoRedo<string>());
        expect(result.current.canUndo()).toBe(false);
        expect(result.current.canRedo()).toBe(false);
    });

    it('undo() returns null when history is empty', () => {
        const { result } = renderHook(() => useUndoRedo<string>());
        expect(result.current.undo()).toBeNull();
    });

    it('redo() returns null when no undo has been done', () => {
        const { result } = renderHook(() => useUndoRedo<string>());
        act(() => result.current.push('a'));
        expect(result.current.redo()).toBeNull();
    });

    it('single push + undo returns the pushed snapshot', () => {
        const { result } = renderHook(() => useUndoRedo<string>());
        act(() => result.current.push('state-before-edit'));
        const restored = result.current.undo();
        expect(restored).toBe('state-before-edit');
        expect(result.current.canUndo()).toBe(false);
    });

    it('undo then redo round-trips correctly', () => {
        const { result } = renderHook(() => useUndoRedo<number>());
        act(() => {
            result.current.push(1);
            result.current.push(2);
        });
        expect(result.current.undo()).toBe(2);
        expect(result.current.undo()).toBe(1);
        expect(result.current.redo()).toBe(1);
        expect(result.current.redo()).toBe(2);
        expect(result.current.redo()).toBeNull(); // no more redo
    });

    it('a new push after undo clears the redo stack', () => {
        const { result } = renderHook(() => useUndoRedo<string>());
        act(() => {
            result.current.push('a');
            result.current.push('b');
        });
        result.current.undo(); // undo b
        expect(result.current.canRedo()).toBe(true);

        act(() => result.current.push('c')); // new edit

        expect(result.current.canRedo()).toBe(false);
        // undo should now yield 'c' (the snapshot we just pushed)
        expect(result.current.undo()).toBe('c');
    });

    it('respects maxHistory — oldest entries are dropped', () => {
        const { result } = renderHook(() => useUndoRedo<number>(3));
        act(() => {
            result.current.push(1);
            result.current.push(2);
            result.current.push(3);
            result.current.push(4); // should evict 1
        });
        expect(result.current.undo()).toBe(4);
        expect(result.current.undo()).toBe(3);
        expect(result.current.undo()).toBe(2);
        expect(result.current.canUndo()).toBe(false); // 1 was evicted
    });

    it('clear() empties both past and future', () => {
        const { result } = renderHook(() => useUndoRedo<string>());
        act(() => {
            result.current.push('x');
            result.current.push('y');
        });
        result.current.undo();
        expect(result.current.canRedo()).toBe(true);

        act(() => result.current.clear());

        expect(result.current.canUndo()).toBe(false);
        expect(result.current.canRedo()).toBe(false);
    });

    it('works with object references without deep-cloning them', () => {
        type State = { count: number };
        const { result } = renderHook(() => useUndoRedo<State>());
        const s1: State = { count: 1 };
        act(() => result.current.push(s1));
        const restored = result.current.undo();
        expect(restored).toBe(s1); // same reference
    });
});
