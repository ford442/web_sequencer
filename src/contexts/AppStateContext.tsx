import React, { createContext, useContext } from 'react';
import { useAppState } from '../hooks/useAppState.tsx';

type AppState = ReturnType<typeof useAppState>;

const AppStateContext = createContext<AppState | null>(null);

/**
 * Provides the global application state (created once) to the entire tree.
 * Wrap the root of the app with this provider so that all sub-components
 * consume the same state instance via `useAppStateContext()`.
 */
export const AppStateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const state = useAppState();
    return <AppStateContext.Provider value={state}>{children}</AppStateContext.Provider>;
};

/**
 * Consume the shared application state.
 * Must be used inside an `AppStateProvider`.
 */
export function useAppStateContext(): AppState {
    const ctx = useContext(AppStateContext);
    if (!ctx) {
        throw new Error('useAppStateContext must be used within an AppStateProvider');
    }
    return ctx;
}
