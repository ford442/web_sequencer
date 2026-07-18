import React, { createContext, useContext } from 'react';
import { useCompactLayout, type CompactLayoutState } from '../hooks/useCompactLayout';

const CompactLayoutContext = createContext<CompactLayoutState | null>(null);

export function CompactLayoutProvider({ children }: { children: React.ReactNode }) {
    const value = useCompactLayout();
    return (
        <CompactLayoutContext.Provider value={value}>
            {children}
        </CompactLayoutContext.Provider>
    );
}

export function useCompactLayoutContext(): CompactLayoutState {
    const ctx = useContext(CompactLayoutContext);
    if (!ctx) {
        throw new Error('useCompactLayoutContext must be used within CompactLayoutProvider');
    }
    return ctx;
}

/** Safe fallback when provider is absent (tests / Storybook). */
export function useCompactLayoutOptional(): CompactLayoutState | null {
    return useContext(CompactLayoutContext);
}
