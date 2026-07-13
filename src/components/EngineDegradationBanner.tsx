import React, { memo, useCallback } from 'react';
import { useEngineDegradation } from '../stores/engineDegradationStore';
import { engineDegradationStore } from '../stores/engineDegradationStore';

/** Top-of-app banner when GPU/WASM/worklet engines are running in degraded mode. */
export const EngineDegradationBanner = memo(function EngineDegradationBanner() {
    const issues = useEngineDegradation();

    const handleRetry = useCallback(async (id: string) => {
        await engineDegradationStore.retry(id);
    }, []);

    if (issues.length === 0) return null;

    return (
        <div
            className="relative z-40 shrink-0 bg-amber-950/95 border-b border-amber-600/50 text-amber-100 px-3 py-2 text-xs"
            role="status"
            aria-live="polite"
            aria-label="Engine degradation warnings"
        >
            <div className="max-w-[1000px] mx-auto flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1">
                    {issues.map((issue) => (
                        <div key={issue.id} className="flex flex-wrap items-center gap-2">
                            <span className="font-bold uppercase tracking-wider text-amber-300">
                                {issue.status === 'recovering' ? '⟳' : '⚠'} {issue.subsystem}
                            </span>
                            <span>{issue.message}</span>
                            <span className="text-amber-400/70 font-mono text-[10px] hidden sm:inline" title={issue.reason}>
                                ({issue.activeBackend} ← {issue.requestedBackend})
                            </span>
                        </div>
                    ))}
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                    {issues.filter((i) => i.retryable).map((issue) => (
                        <button
                            key={`retry-${issue.id}`}
                            type="button"
                            onClick={() => void handleRetry(issue.id)}
                            disabled={issue.status === 'recovering'}
                            className="min-h-[36px] px-3 py-1 rounded-md bg-amber-800/80 hover:bg-amber-700 border border-amber-500/60 font-bold text-[10px] uppercase tracking-wider touch-manipulation disabled:opacity-50"
                        >
                            {issue.status === 'recovering' ? 'Retrying…' : `Retry ${issue.subsystem}`}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
});
