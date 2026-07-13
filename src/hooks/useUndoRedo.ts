// useUndoRedo — lightweight undo/redo for immutable pattern state.
//
// Stores up to `maxHistory` snapshots in a ring buffer.
// Call `push(snapshot)` *before* making an edit, then mutate state normally.
// `undo()` returns the most recent snapshot; `redo()` re-applies an undone edit.
//
// The hook is pure: it doesn't call setPattern itself — it returns values and
// callers decide what to do with them. This keeps it framework-agnostic and
// trivially testable.

import { useRef, useCallback } from 'react';
import { useMemo } from "react";

export interface UseUndoRedoReturn<T> {
    /** Save a snapshot before an edit. Call this every time the pattern changes. */
    push: (snapshot: T) => void;
    /** Returns the previous snapshot, or null if history is empty. */
    undo: () => T | null;
    /** Re-applies the most recently undone snapshot, or returns null. */
    redo: () => T | null;
    /** True when there is at least one snapshot to undo. */
    canUndo: () => boolean;
    /** True when there is at least one snapshot to redo. */
    canRedo: () => boolean;
    /** Discard all history (e.g., on song load). */
    clear: () => void;
}

export function useUndoRedo<T>(maxHistory = 50): UseUndoRedoReturn<T> {
    // past[past.length - 1] is the most recent snapshot before the current state.
    const past = useRef<T[]>([]);
    // future holds states that were undone (most recently undone = last element).
    const future = useRef<T[]>([]);

    const push = useCallback((snapshot: T) => {
        // A new edit invalidates any redo-able future.
        future.current = [];

        past.current.push(snapshot);
        // Drop oldest entries once we exceed maxHistory.
        if (past.current.length > maxHistory) {
            past.current.shift();
        }
    }, [maxHistory]);

    const undo = useCallback((): T | null => {
        if (past.current.length === 0) return null;
        const snapshot = past.current.pop()!;
        future.current.push(snapshot);
        return snapshot;
    }, []);

    const redo = useCallback((): T | null => {
        if (future.current.length === 0) return null;
        const snapshot = future.current.pop()!;
        past.current.push(snapshot);
        return snapshot;
    }, []);

    const canUndo = useCallback(() => past.current.length > 0, []);
    const canRedo = useCallback(() => future.current.length > 0, []);

    const clear = useCallback(() => {
        past.current = [];
        future.current = [];
    }, []);

    return useMemo(() => ({ push, undo, redo, canUndo, canRedo, clear }), [push, undo, redo, canUndo, canRedo, clear]);
}
