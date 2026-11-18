/**
 * One immutable value behind `useSyncExternalStore`, with a ref the audio
 * path reads without a render (#1597 P2).
 *
 * Writes are synchronous: `ref.current` and `getSnapshot()` hold the new value
 * the moment `set` returns, and listeners have run. That is the property the
 * project doc bindings rely on (a write lands in the doc inside the editor
 * scope that made it), and what `useState` + a ref synced in an effect could
 * not give.
 */

import { useSyncExternalStore, type SetStateAction } from 'react';

/** Members are arrow-typed: each is passed around bare (`useSyncExternalStore(store.subscribe, ...)`). */
export interface ValueStore<T> {
    readonly subscribe: (listener: () => void) => () => void;
    readonly getSnapshot: () => T;
    /** Same contract as a React state setter; a no-op when the value is unchanged. */
    readonly set: (action: SetStateAction<T>) => void;
    /** Always equal to `getSnapshot()`. */
    readonly ref: { current: T };
    readonly reset: () => void;
}

export function createValueStore<T>(initial: T | (() => T)): ValueStore<T> {
    const init = () => (typeof initial === 'function' ? (initial as () => T)() : initial);
    let value = init();
    const listeners = new Set<() => void>();
    const ref = { current: value };
    const store: ValueStore<T> = {
        subscribe: (listener) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        getSnapshot: () => value,
        set: (action) => {
            const next = typeof action === 'function' ? (action as (prev: T) => T)(value) : action;
            // A caller may have written the ref ahead of the set; keep them equal.
            ref.current = next;
            if (Object.is(next, value)) return;
            value = next;
            listeners.forEach((listener) => listener());
        },
        ref,
        reset: () => store.set(init()),
    };
    return store;
}

export function useValueStore<T>(store: ValueStore<T>): T {
    return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
