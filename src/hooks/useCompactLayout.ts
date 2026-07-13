import { useCallback, useEffect, useMemo, useState } from 'react';

export type CompactLayoutPreference = 'auto' | 'compact' | 'comfortable';

const STORAGE_KEY = 'hyphon:compact-layout';
const COMPACT_BREAKPOINT_PX = 768;

export interface CompactLayoutState {
    preference: CompactLayoutPreference;
    isCompact: boolean;
    isPortrait: boolean;
    isCoarsePointer: boolean;
    viewportWidth: number;
    setPreference: (mode: CompactLayoutPreference) => void;
    toggleCompact: () => void;
}

function readStoredPreference(): CompactLayoutPreference {
    if (typeof window === 'undefined') return 'auto';
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'compact' || stored === 'comfortable' || stored === 'auto') {
            return stored;
        }
    } catch {
        // ignore
    }
    return 'auto';
}

export function useCompactLayout(): CompactLayoutState {
    const [preference, setPreferenceState] = useState<CompactLayoutPreference>(readStoredPreference);
    const [viewportWidth, setViewportWidth] = useState(
        typeof window !== 'undefined' ? window.innerWidth : 1024
    );
    const [isPortrait, setIsPortrait] = useState(
        typeof window !== 'undefined' ? window.innerHeight > window.innerWidth : false
    );
    const [isCoarsePointer, setIsCoarsePointer] = useState(false);

    useEffect(() => {
        const coarseMq = window.matchMedia('(pointer: coarse)');
        const portraitMq = window.matchMedia('(orientation: portrait)');

        const sync = () => {
            setViewportWidth(window.innerWidth);
            setIsPortrait(portraitMq.matches);
            setIsCoarsePointer(coarseMq.matches);
        };

        sync();
        window.addEventListener('resize', sync);
        coarseMq.addEventListener('change', sync);
        portraitMq.addEventListener('change', sync);
        return () => {
            window.removeEventListener('resize', sync);
            coarseMq.removeEventListener('change', sync);
            portraitMq.removeEventListener('change', sync);
        };
    }, []);

    const setPreference = useCallback((mode: CompactLayoutPreference) => {
        setPreferenceState(mode);
        try {
            localStorage.setItem(STORAGE_KEY, mode);
        } catch {
            // ignore
        }
    }, []);

    const isCompact = useMemo(() => {
        if (preference === 'compact') return true;
        if (preference === 'comfortable') return false;
        return viewportWidth < COMPACT_BREAKPOINT_PX || isCoarsePointer;
    }, [preference, viewportWidth, isCoarsePointer]);

    const toggleCompact = useCallback(() => {
        setPreference(isCompact ? 'comfortable' : 'compact');
    }, [isCompact, setPreference]);

    return {
        preference,
        isCompact,
        isPortrait,
        isCoarsePointer,
        viewportWidth,
        setPreference,
        toggleCompact,
    };
}
