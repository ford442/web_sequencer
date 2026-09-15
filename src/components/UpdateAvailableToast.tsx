import React, { useEffect, useState } from 'react';
import { swUpdateStore } from '@/stores/swUpdateStore';

/**
 * Shown when the service worker registered in main.tsx finds a new release
 * already installed and waiting. Styled to match Toast.tsx, but kept as its
 * own component: it needs an action button (Toast is message + auto-dismiss
 * only) and must work independent of AppStateContext, since main.tsx's
 * registration code runs before React mounts.
 */
export const UpdateAvailableToast: React.FC = React.memo(() => {
    const [applyUpdate, setApplyUpdate] = useState<(() => void) | null>(null);

    useEffect(
        // setState treats a bare function argument as an updater callback
        // (prevState) => nextState, not "set the state to this function" —
        // swUpdateStore publishes a function, so it must be wrapped or React
        // invokes it immediately and stores its (undefined) return value.
        () => swUpdateStore.subscribe((callback) => setApplyUpdate(() => callback)),
        [],
    );

    if (!applyUpdate) return null;

    return (
        <div
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded shadow-lg border border-cyan-500 bg-cyan-950/95 text-cyan-100 flex items-center gap-3"
            role="status"
            aria-live="polite"
        >
            <span aria-hidden="true">⟳</span>
            <span className="font-mono text-sm">New version available</span>
            <button
                type="button"
                onClick={applyUpdate}
                className="min-h-[32px] px-3 py-1 rounded-md bg-cyan-700 hover:bg-cyan-600 border border-cyan-400/60 font-bold text-[10px] uppercase tracking-wider touch-manipulation focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-cyan-950 focus:outline-none"
            >
                Reload
            </button>
            <button
                type="button"
                onClick={() => swUpdateStore.dismiss()}
                className="ml-1 hover:opacity-75 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-cyan-950 focus-visible:ring-cyan-400 rounded p-0.5 transition-opacity"
                aria-label="Dismiss"
                title="Dismiss"
            >
                <span aria-hidden="true">✕</span>
            </button>
        </div>
    );
});
