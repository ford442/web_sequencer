import React, { useCallback, useEffect } from 'react';
import { LoadingButton } from './LoadingButton';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { ensureRunning } from '../audio/runtime/AudioRuntime';
import type { HyphonNativeStatus } from '../engines/hyphonNativeProbe';
import type { PythonEngineStatus } from '../pyodide/pythonEngineStore';

interface StartOverlayProps {
    onStart: () => void;
    /** `pending` until the probe settles; `failed` = the JS fallbacks are the active engines. */
    nativeStatus: HyphonNativeStatus;
    hasWebGpu: boolean;
    /** The Python table engine — loads on demand, never gates the start. */
    pythonStatus: PythonEngineStatus;
    pythonReason: string | null;
    onLoadPython: () => void;
}

function statusLine(label: string, value: React.ReactNode, testId?: string): React.ReactNode {
    return (
        <div className="flex justify-between mb-1" data-testid={testId}>
            <span>{label}</span>
            {value}
        </div>
    );
}

function nativeValue(status: HyphonNativeStatus): React.ReactNode {
    if (status === 'ready') return <span className="text-green-400">READY</span>;
    if (status === 'failed') {
        return (
            <span className="text-yellow-400" title="hyphon_native could not be loaded; the voices run their JS fallbacks">
                JS FALLBACK
            </span>
        );
    }
    return <span className="text-yellow-400 animate-pulse">LOADING...</span>;
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

    const reuse = function (this: unknown, ...args: ConstructorParameters<typeof AudioContext>) {
        if (w.audioContext && w.audioContext.state !== 'closed') {
            return w.audioContext;
        }
        const ctx = new Orig(...args);
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
        void ensureRunning('click', w.audioContext);
    } catch {
        // ignore
    }
}

/**
 * Click-to-start audio unlock gate.
 *
 * Shows native/WebGPU/Python-table-engine status; only the native module's
 * verdict gates the button. E2E-only additions (no visual change):
 * data-testid hooks so Playwright can wait for / click the initialize button
 * reliably across Chromium/Firefox/WebKit. Boot helpers navigate with ?e2e=1;
 * resume() is patched so Firefox/WebKit do not hang after the gesture is
 * consumed by React's async init path.
 */
export const StartOverlay: React.FC<StartOverlayProps> = React.memo(({
    onStart,
    nativeStatus,
    hasWebGpu,
    pythonStatus,
    pythonReason,
    onLoadPython,
}) => {
    const trapRef = useFocusTrap<HTMLDivElement>(true);
    // The transport needs the voice module's verdict, not Python: ready, or
    // failed with the JS fallbacks active. The click is the gesture that resumes
    // the context. Python never gates this.
    const canStart = nativeStatus !== 'pending';

    const pythonValue = pythonStatus === 'ready' ? (
        <span className="text-green-400">LOADED</span>
    ) : pythonStatus === 'loading' ? (
        <span className="text-yellow-400 animate-pulse">LOADING...</span>
    ) : pythonStatus === 'failed' ? (
        <span className="text-red-400 truncate max-w-[55%] text-right" title={pythonReason ?? undefined}>FAILED</span>
    ) : (
        <span className="flex items-center gap-2">
            <span className="text-gray-500">NOT REQUESTED</span>
            <button
                type="button"
                data-testid="load-python-engine"
                onClick={onLoadPython}
                className="px-2 border border-gray-600 rounded text-cyan-400 hover:border-cyan-400"
                title="Load the Python table engine (numpy / scipy). Not needed to play."
            >
                LOAD
            </button>
        </span>
    );

    useEffect(() => {
        installE2EAudioUnlock();
    }, []);

    const handleStart = useCallback(() => {
        // Same synchronous turn as the click — best-effort real resume + start.
        gestureResumeForE2E();
        // Records the gesture; resumes the live context when one already exists.
        void ensureRunning('click');
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
                    {statusLine('NATIVE MODULE:', nativeValue(nativeStatus), 'status-native')}
                    {statusLine(
                        'WEBGPU:',
                        hasWebGpu
                            ? <span className="text-green-400">READY</span>
                            : <span className="text-yellow-400 animate-pulse">NOT AVAILABLE</span>,
                    )}
                    {statusLine('PYTHON TABLE ENGINE:', pythonValue, 'status-python')}
                </div>
                <LoadingButton
                    data-testid="initialize-system"
                    aria-label="Initialize System"
                    onClick={handleStart}
                    isLoading={!canStart}
                    loadingText="CHECKING AUDIO ENGINE..."
                    spinnerColor="text-gray-500"
                    title={canStart ? 'Start Application' : 'Checking the audio engine...'}
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
