/**
 * The app's handle on the live project runtime (#1597 P2). Yjs-free, so the
 * entry chunk (keyboard shortcuts, the load path, the history panel, the
 * co-producer host) can use it without loading the CRDT: the runtime lives
 * in a lazy chunk (`liveProjectRuntime.ts`) and attaches itself here once it
 * has loaded, a moment after boot.
 *
 * Until then every call degrades to "no history": `edit` just runs its
 * function, undo does nothing, the snapshot is empty. Store writes made in
 * that window become the doc's seed when the runtime attaches.
 */

import { useSyncExternalStore } from 'react';
import type { SavedSongData } from '@/types';
import type { SongField } from './binding';
import type { EditorKind, HistorySnapshot } from './history';

export type EditScope = EditorKind | 'load' | 'playback';

/** What the runtime offers once it is attached. */
export interface LiveProjectRuntime {
    edit<T>(scope: EditScope, fn: () => T, label?: string): T;
    editAsync<T>(scope: EditScope, fn: () => Promise<T>, label?: string): Promise<T>;
    undo(editor: EditorKind): boolean;
    redo(editor: EditorKind): boolean;
    canUndo(editor: EditorKind): boolean;
    canRedo(editor: EditorKind): boolean;
    jumpTo(id: string): boolean;
    beginStep(editor: EditorKind): void;
    stepLabels(editor: EditorKind): string[];
    getHistorySnapshot(): HistorySnapshot;
    subscribeHistory(listener: () => void): () => void;
    readField(field: SongField): unknown;
    readSong(): SavedSongData;
}

const EMPTY: HistorySnapshot = { entries: [], canUndo: false, canRedo: false };

let runtime: LiveProjectRuntime | null = null;
let releaseHistory: () => void = () => {};
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of [...listeners]) listener();
}

export const liveProject = {
    /** Called by the runtime chunk. Returns the detach function. */
    attach(next: LiveProjectRuntime): () => void {
        releaseHistory();
        runtime = next;
        releaseHistory = next.subscribeHistory(emit);
        emit();
        return () => {
            if (runtime !== next) return;
            releaseHistory();
            releaseHistory = () => {};
            runtime = null;
            emit();
        };
    },

    isAttached(): boolean {
        return runtime !== null;
    },

    /** Run `fn` with its store writes attributed to `scope` (see `ProjectRuntime.edit`). */
    edit<T>(scope: EditScope, fn: () => T, label?: string): T {
        return runtime ? runtime.edit(scope, fn, label) : fn();
    },

    editAsync<T>(scope: EditScope, fn: () => Promise<T>, label?: string): Promise<T> {
        return runtime ? runtime.editAsync(scope, fn, label) : fn();
    },

    undo(editor: EditorKind = 'human'): boolean {
        return runtime?.undo(editor) ?? false;
    },

    redo(editor: EditorKind = 'human'): boolean {
        return runtime?.redo(editor) ?? false;
    },

    canUndo(editor: EditorKind = 'human'): boolean {
        return runtime?.canUndo(editor) ?? false;
    },

    canRedo(editor: EditorKind = 'human'): boolean {
        return runtime?.canRedo(editor) ?? false;
    },

    jumpTo(id: string): boolean {
        return runtime?.jumpTo(id) ?? false;
    },

    /** The next human change starts a new undo step (a new pointer gesture, a key press). */
    beginGesture(): void {
        runtime?.beginStep('human');
    },

    beginStep(editor: EditorKind): void {
        runtime?.beginStep(editor);
    },

    stepLabels(editor: EditorKind): string[] {
        return runtime?.stepLabels(editor) ?? [];
    },

    /** A bound field as the doc holds it, or `undefined` before the runtime attaches. */
    readField(field: SongField): unknown {
        return runtime?.readField(field);
    },

    /** The whole song as the doc holds it, or null before the runtime attaches. */
    readSong(): SavedSongData | null {
        return runtime?.readSong() ?? null;
    },

    // Arrows: passed bare to useSyncExternalStore.
    subscribe: (listener: () => void): (() => void) => {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },

    getSnapshot: (): HistorySnapshot => runtime?.getHistorySnapshot() ?? EMPTY,
};

/** The project's undo history (re-renders when it changes). */
export function useProjectHistory(): HistorySnapshot {
    return useSyncExternalStore(liveProject.subscribe, liveProject.getSnapshot, liveProject.getSnapshot);
}

const never = () => false;

/**
 * Whether this tab's user can undo / redo. With `active` false both read
 * false and the caller never re-renders on history changes (a closed panel).
 */
export function useUndoAvailability(active = true): { canUndo: boolean; canRedo: boolean } {
    const canUndo = useSyncExternalStore(liveProject.subscribe, active ? () => liveProject.canUndo() : never, never);
    const canRedo = useSyncExternalStore(liveProject.subscribe, active ? () => liveProject.canRedo() : never, never);
    return { canUndo, canRedo };
}

/** Undo / redo this tab's last human step (Ctrl/Cmd+Z, Shift+Z, the panels' buttons). */
export const undoHuman = (): void => {
    liveProject.beginGesture();
    liveProject.undo('human');
};
export const redoHuman = (): void => {
    liveProject.beginGesture();
    liveProject.redo('human');
};
