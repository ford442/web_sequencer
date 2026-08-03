import React from 'react';
import { LoadingButton } from './LoadingButton';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface StartOverlayProps {
    onStart: () => void;
    isReady: boolean;
}

/**
 * Click-to-start audio unlock gate.
 *
 * E2E-only additions (no visual change): data-testid hooks so Playwright can
 * wait for / click the initialize button reliably across Chromium/Firefox/WebKit.
 * Boot helpers navigate with ?e2e=1 (introspection) and perform a real click —
 * do not auto-dismiss here; AudioContext resume requires a user gesture on WebKit.
 */
export const StartOverlay: React.FC<StartOverlayProps> = React.memo(({ onStart, isReady }) => {
    const trapRef = useFocusTrap<HTMLDivElement>(true);
    return (
        <div
            ref={trapRef}
            data-testid="start-overlay"
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#111827] bg-opacity-95 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="start-overlay-title"
            tabIndex={-1}
        >
            <div className="text-center p-8 bg-[#1f2937] border-2 border-cyan-500 rounded-2xl shadow-2xl max-w-lg w-full">
                <h1 id="start-overlay-title" className="text-4xl font-bold font-orbitron text-cyan-400 mb-2 tracking-widest drop-shadow-[0_0_10px_rgba(6,182,212,0.8)]">HYPHON</h1>
                <p className="text-gray-400 mb-8 font-mono text-sm tracking-wide">BROWSER AUDIO WORKSTATION</p>
                <div className="mb-8 p-4 bg-gray-800 rounded-lg border border-gray-700 text-left font-mono text-xs text-gray-300" role="status" aria-live="polite">
                    <p className="mb-2 text-cyan-500 font-bold">SYSTEM CHECK:</p>
                    <div className="flex justify-between mb-1"><span>AUDIO ENGINE:</span><span className="text-green-400">READY</span></div>
                    <div className="flex justify-between mb-1"><span>WEBGPU:</span><span className="text-green-400">DETECTED</span></div>
                    <div className="flex justify-between"><span>CORE (PYODIDE):</span>{isReady ? <span className="text-green-400">LOADED</span> : <span className="text-yellow-400 animate-pulse">LOADING...</span>}</div>
                </div>
                <LoadingButton
                    data-testid="initialize-system"
                    aria-label="Initialize System"
                    onClick={onStart}
                    isLoading={!isReady}
                    loadingText="LOADING RESOURCES..."
                    spinnerColor="text-gray-500"
                    title={isReady ? 'Start Application' : 'Please wait, loading system resources...'}
                    className={`w-full py-4 rounded-xl font-orbitron text-xl font-bold tracking-widest flex items-center justify-center gap-3 ${
                        isReady
                            ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-[0_0_20px_rgba(6,182,212,0.6)] hover:shadow-[0_0_30px_rgba(6,182,212,0.8)] border border-cyan-400 cursor-pointer transform hover:scale-[1.02]'
                            : 'bg-gray-700 text-gray-500 border border-gray-600'
                    }`}
                >
                    INITIALIZE SYSTEM
                </LoadingButton>
            </div>
        </div>
    );
});
