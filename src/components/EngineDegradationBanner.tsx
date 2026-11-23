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

    const renderRow = (issue: (typeof issues)[number]) => (
        <div key={issue.id} className="flex flex-wrap items-center gap-2">
            <span className="font-bold uppercase tracking-wider text-amber-300">
                {issue.status === 'recovering' ? '⟳' : '⚠'} {issue.subsystem}
            </span>
            <span>{issue.message}</span>
            <span className="text-amber-400/70 font-mono text-[10px] hidden sm:inline" title={issue.reason}>
                ({issue.activeBackend} ← {issue.requestedBackend})
            </span>
        </div>
    );
    // An audio problem (suspended context) is the one a person can act on right now, so it is never
    // folded away. Engine fallbacks (GPU / WASM / TTS) are informational and collapse when there are several.
    const urgent = issues.filter((i) => i.category === 'audio');
    const rest = issues.filter((i) => i.category !== 'audio');

    return (
        <div
            className="relative z-40 shrink-0 bg-amber-950/95 border-b border-amber-600/50 text-amber-100 px-3 py-2 text-xs"
            aria-label="Engine degradation warnings"
        >
            <div className="max-w-[1000px] mx-auto flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1">
                    <span role="status" aria-live="polite" className="sr-only">
                        {issues.map(i => `${i.status === 'recovering' ? 'Retrying' : 'Warning'} ${i.subsystem}: ${i.message}`).join('. ')}
                    </span>
                    {urgent.map(renderRow)}
                    {rest.length > 1 ? (
                        // Several fallbacks at once (a host with no WebGPU reports four) would otherwise
                        // stack into a banner a third of a phone screen tall: summarise, details on demand.
                        <details data-testid="degradation-details" className="group">
                            <summary className="cursor-pointer list-none flex items-center gap-2 min-h-[32px] focus-visible:ring-2 focus-visible:ring-amber-500 rounded">
                                <span className="font-bold uppercase tracking-wider text-amber-300">⚠ {rest.length} engines in fallback mode</span>
                                <span className="text-amber-400/70 hidden sm:inline">
                                    {rest.map((i) => i.subsystem).join(' · ')}
                                </span>
                                <span className="text-amber-300/80 underline decoration-dotted group-open:hidden">details</span>
                                <span className="text-amber-300/80 underline decoration-dotted hidden group-open:inline">hide</span>
                            </summary>
                            <div className="mt-1 flex flex-col gap-1">{rest.map(renderRow)}</div>
                        </details>
                    ) : (
                        rest.map(renderRow)
                    )}
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                    {issues.filter((i) => i.retryable).map((issue) => (
                        <button
                            key={`retry-${issue.id}`}
                            type="button"
                            onClick={() => {
                                if (issue.status === 'recovering') return;
                                void handleRetry(issue.id);
                            }}
                            aria-disabled={issue.status === 'recovering'}
                            aria-label={issue.status === 'recovering' ? `Retrying ${issue.subsystem}` : `Retry ${issue.subsystem}`}
                            className={`min-h-[36px] px-3 py-1 rounded-md bg-amber-800/80 border border-amber-500/60 font-bold text-[10px] uppercase tracking-wider touch-manipulation focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 focus-visible:ring-offset-amber-950 focus:outline-none ${issue.status === 'recovering' ? 'opacity-50 cursor-not-allowed' : 'hover:bg-amber-700'}`}
                        >
                            {issue.status === 'recovering' ? 'Retrying…' : `Retry ${issue.subsystem}`}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
});
