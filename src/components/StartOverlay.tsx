import React, { useCallback, useEffect } from 'react';
import { LoadingButton } from './LoadingButton';
import { useFocusTrap } from '../hooks/useFocusTrap';

interface StartOverlayProps {
    onStart: () => void;
    isPyodideReady: boolean;
    pyodideStatus: string;
    hasWebGpu: boolean;
    hasNativeModule: boolean;
}

function statusLine(
    label: string,
    ready: boolean,
    loadingLabel = 'LOADING...',
    failLabel?: string,
): React.ReactNode {
    const isFailed = failLabel && !ready && failLabel.length > 0;
    return (
        <div className="flex justify-between mb-1">
            <span>{label}</span>
            {ready ? (
                <span className="text-green-400">READY</span>
            ) : isFailed ? (
                <span className="text-red-400">{failLabel}</span>
            ) : (
                <span className="text-yellow-400 animate-pulse">{loadingLabel}</span>
            )}
        </div>
    );
}

type AudioWindow = Window & typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
    audioContext?: AudioContext;
    __HYPHON_E2E_AUDIO_PATCHED__?: boolean;
};

function isE2EQuery(): boolean {
    try {
        return new URLSearchParams(window.location.search).has('e2e');
    } catch {
        return false;
    }
}

/**
 * Firefox/WebKit drop transient user activation across React setState + await
 * before `initializeAudio` constructs AudioContext — `await context.resume()`
 * then hangs forever on a suspended context (LoadingOverlay never clears).
 *
 * For `?e2e=1` only:
 * 1. Make `resume()` non-blocking so engine init can finish (nodes construct while suspended).
 * 2. On any real pointerdown/click, call the native resume under that gesture so
 *    transport/`currentTime` can advance (RBS playhead assertions, etc.).
 */
function installE2EAudioUnlock(): void {
    if (!isE2EQuery()) return;

    const w = window as AudioWindow;
    if (w.__HYPHON_E2E_AUDIO_PATCHED__) return;
    w.__HYPHON_E2E_AUDIO_PATCHED__ = true;

    const Orig = w.AudioContext ?? w.webkitAudioContext;
    if (!Orig) return;

    // Capture native before replacing — gesture unlock must call the real resume.
    const nativeResumeFn = Orig.prototype.resume;

    Orig.prototype.resume = function (this: AudioContext, ...args: unknown[]) {
        try {
            const result = nativeResumeFn.apply(this, args as []);
            // Do not await — Firefox may never resolve when activation was lost.
            void Promise.resolve(result).catch(() => undefined);
        } catch {
            // ignore
        }
        return Promise.resolve();
    };

    const reuse = function (this: unknown) {
        if (w.audioContext && w.audioContext.state !== 'closed') {
            return w.audioContext;
        }
        const ctx = new Orig();
        w.audioContext = ctx;
        return ctx;
    } as unknown as typeof AudioContext;

    Object.setPrototypeOf(reuse, Orig);
    reuse.prototype = Orig.prototype;
    reuse.prototype.resume = Orig.prototype.resume;
    w.AudioContext = reuse;
    if (w.webkitAudioContext) {
        w.webkitAudioContext = reuse;
    }

    // Capture-phase: Start Playback / any click restores a running clock for E2E.
    const unlockFromGesture = () => {
        const ctx = w.audioContext;
        if (!ctx || ctx.state === 'closed' || ctx.state === 'running') return;
        try {
            void nativeResumeFn.call(ctx);
        } catch {
            // ignore
        }
    };
    document.addEventListener('pointerdown', unlockFromGesture, true);
    document.addEventListener('click', unlockFromGesture, true);
}

function gestureResumeForE2E(): void {
    if (!isE2EQuery()) return;
    const w = window as AudioWindow;
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return;
    try {
        if (!w.audioContext || w.audioContext.state === 'closed') {
            w.audioContext = new Ctor();
        }
        void w.audioContext.resume();
    } catch {
        // ignore
    }
}

/**
 * Click-to-start audio unlock gate.
 *
 * Shows native/WebGPU/Pyodide readiness. E2E-only additions (no visual change):
 * data-testid hooks so Playwright can wait for / click the initialize button
 * reliably across Chromium/Firefox/WebKit. Boot helpers navigate with ?e2e=1;
 * resume() is patched so Firefox/WebKit do not hang after the gesture is
 * consumed by React's async init path.
 */
export const StartOverlay: React.FC<StartOverlayProps> = React.memo(({
    onStart,
    isPyodideReady,
    pyodideStatus,
    hasWebGpu,
    hasNativeModule,
}) => {
    const trapRef = useFocusTrap<HTMLDivElement>(true);
    const pyodideFailed = !isPyodideReady && pyodideStatus.toLowerCase().includes('failed')
        || pyodideStatus.toLowerCase().includes('timed out');
    const canStart = isPyodideReady && hasNativeModule;

    useEffect(() => {
        installE2EAudioUnlock();
    }, []);

    const handleStart = useCallback(() => {
        // Same synchronous turn as the click — best-effort real resume + start.
        gestureResumeForE2E();
        onStart();
    }, [onStart]);

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
                    {statusLine('NATIVE MODULE:', hasNativeModule, 'LOADING...', 'MISSING')}
                    {statusLine('WEBGPU:', hasWebGpu, 'NOT AVAILABLE', undefined)}
                    <div className="flex justify-between">
                        <span>CORE (PYODIDE):</span>
                        {isPyodideReady ? (
                            <span className="text-green-400">LOADED</span>
                        ) : pyodideFailed ? (
                            <span className="text-red-400 truncate max-w-[55%] text-right" title={pyodideStatus}>
                                FAILED
                            </span>
                        ) : (
                            <span className="text-yellow-400 animate-pulse">LOADING...</span>
                        )}
                    </div>
                </div>
                <LoadingButton
                    data-testid="initialize-system"
                    aria-label="Initialize System"
                    onClick={handleStart}
                    isLoading={!canStart}
                    loadingText="LOADING RESOURCES..."
                    spinnerColor="text-gray-500"
                    title={canStart ? 'Start Application' : 'Please wait, loading system resources...'}
                    className={`w-full py-4 rounded-xl font-orbitron text-xl font-bold tracking-widest flex items-center justify-center gap-3 ${
                        canStart
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
