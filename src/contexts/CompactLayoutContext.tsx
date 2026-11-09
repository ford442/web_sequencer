import React, { useContext } from 'react';
import { useCompactLayout, type CompactLayoutState } from '../hooks/useCompactLayout';
import { CompactLayoutContext } from './compactLayoutStore';

export function CompactLayoutProvider({ children }: { children: React.ReactNode }) {
    const value = useCompactLayout();
    return (
        <CompactLayoutContext.Provider value={value}>
            {children}
        </CompactLayoutContext.Provider>
    );
}

/** Safe fallback when provider is absent (tests / Storybook). */
export function useCompactLayoutOptional(): CompactLayoutState | null {
    return useContext(CompactLayoutContext);
}
