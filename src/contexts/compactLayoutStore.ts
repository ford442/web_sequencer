import { createContext, useContext } from 'react';
import type { CompactLayoutState } from '../hooks/useCompactLayout';

/** Shared with CompactLayoutContext.tsx, which keeps the provider (react-refresh: components only there). */
export const CompactLayoutContext = createContext<CompactLayoutState | null>(null);

export function useCompactLayoutContext(): CompactLayoutState {
    const ctx = useContext(CompactLayoutContext);
    if (!ctx) {
        throw new Error('useCompactLayoutContext must be used within CompactLayoutProvider');
    }
    return ctx;
}
