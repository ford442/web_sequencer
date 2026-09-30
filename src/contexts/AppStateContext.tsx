import React, {
    createContext, useContext, useInsertionEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react';
import { useAppState } from '../hooks/useAppState';
import { createAppStateStore, shallowEqual, type AppStateStore } from '../stores/appStateStore';

export type AppState = ReturnType<typeof useAppState>;

const AppStateStoreContext = createContext<AppStateStore<AppState> | undefined>(undefined);

/**
 * Owns the single `useAppState()` instance and publishes it to an external
 * store. The context value is the (never-changing) store, so the provider
 * re-rendering — which it does on every state change — does not by itself
 * re-render any consumer: consumers subscribe to the slice they select.
 * See src/stores/appStateStore.ts.
 */
export const AppStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const state = useAppState();
    const [store] = useState(() => createAppStateStore(state));
    useInsertionEffect(() => { store.commit(state); });
    useLayoutEffect(() => { store.flush(); });
    return <AppStateStoreContext.Provider value={store}>{children}</AppStateStoreContext.Provider>;
};

function useAppStateStore(): AppStateStore<AppState> {
    const store = useContext(AppStateStoreContext);
    if (store === undefined) {
        throw new Error('useAppStateContext must be used within an AppStateProvider');
    }
    return store;
}

/**
 * Subscribe to a derived value. The component re-renders only when the
 * selector's result changes (`Object.is` by default; pass `shallowEqual` when
 * the selector builds a fresh object or array).
 *
 * Function fields on the state are stable, so selecting a handler never
 * triggers a re-render — but that also means a handler's identity says nothing
 * about whether its closure changed. Compute values by calling the function
 * inside the selector.
 */
export function useAppStateSelector<T>(
    selector: (state: AppState) => T,
    isEqual: (a: T, b: T) => boolean = Object.is,
): T {
    const store = useAppStateStore();
    const memo = useRef<{ snapshot: AppState; selector: (state: AppState) => T; value: T } | null>(null);

    // useSyncExternalStore calls this on every store change and every render;
    // caching on (snapshot, selector) keeps it referentially stable between
    // changes, and `isEqual` keeps the *value* stable across snapshots.
    const getSelection = () => {
        const snapshot = store.getSnapshot();
        const prev = memo.current;
        if (prev && prev.snapshot === snapshot && prev.selector === selector) return prev.value;
        const next = selector(snapshot);
        const value = prev && isEqual(prev.value, next) ? prev.value : next;
        memo.current = { snapshot, selector, value };
        return value;
    };

    return useSyncExternalStore(store.subscribe, getSelection, getSelection);
}

/**
 * Subscribe to a fixed set of fields. Declare the key list once at module
 * scope so the selector is memoised:
 *
 *     const KEYS = ['selectedTrack', 'handleKeyboardPlay'] as const;
 *     const { selectedTrack } = useAppStateSlice(KEYS);
 *
 * Re-renders only when one of the listed fields changes.
 */
export function useAppStateSlice<K extends keyof AppState>(keys: readonly K[]): Pick<AppState, K> {
    const selector = useMemo(
        () => (state: AppState) => {
            const slice = {} as Pick<AppState, K>;
            for (const key of keys) slice[key] = state[key];
            return slice;
        },
        [keys],
    );
    return useAppStateSelector(selector, shallowEqual);
}

/**
 * Subscribe to the entire app state — re-renders on every change.
 *
 * @deprecated Prefer `useAppStateSlice` / `useAppStateSelector`. This exists
 * for tests and for code that genuinely needs everything; using it in a
 * component reintroduces the render fan-out the selectors remove.
 */
export function useAppStateContext(): AppState {
    return useAppStateSelector(identity);
}

function identity(state: AppState): AppState {
    return state;
}
