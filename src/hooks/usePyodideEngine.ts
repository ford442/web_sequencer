import { useState, useEffect } from 'react';
import { engineTelemetry, logEngineFallback } from '../utils/engineTelemetry';
import type { PyodideLike } from '../utils/pyodideBuffers';

const PYODIDE_BOOTSTRAP_TIMEOUT_MS = 180_000;

// This hook encapsulates the "Spectral Puppet" engine
export const usePyodideEngine = () => {
    // Check global state initially
    const [pyodide, setPyodide] = useState<PyodideLike | null>(
        (globalThis.hyphonPyodide as PyodideLike | undefined) ?? null,
    );
    const [isPyodideReady, setIsPyodideReady] = useState(!!globalThis.hyphonPyodideReady);
    const [pyodideStatus, setPyodideStatus] = useState(
        globalThis.hyphonPyodideReady ? 'Python Engine Ready!' : 'Loading Python engine...'
    );

    useEffect(() => {
        if (isPyodideReady) return;

        // Its own lazy chunk: the loader plus ~700 lines of Python source.
        // initPyodideSystem() is idempotent, so StrictMode's double effect and
        // a remount cannot start a second runtime.
        void import('../pyodide/bootstrap')
            .then(({ initPyodideSystem }) => initPyodideSystem())
            .catch((err: unknown) => {
                logEngineFallback('pyodide', 'pyodide', 'bootstrap module failed to load', err);
                setPyodideStatus('Python engine failed: bootstrap module failed to load');
            });

        const handleReady = () => {
            setPyodide(globalThis.hyphonPyodide as PyodideLike);
            setIsPyodideReady(true);
            setPyodideStatus('Python Engine Ready!');
            try { engineTelemetry.registerResolution('pyodide', 'pyodide', 'bootstrap-ready'); } catch (e) { /* noop */ }
        };

        const handleError = (ev: Event) => {
            const detail = (ev as CustomEvent<{ reason?: string; error?: string }>).detail;
            const reason = detail?.reason ?? 'hyphon-pyodide-error event';
            const err = detail?.error ? new Error(detail.error) : undefined;
            logEngineFallback('pyodide', 'pyodide', reason, err);
            setPyodideStatus(`Python engine failed: ${reason}`);
        };

        const timeoutId = window.setTimeout(() => {
            if (!globalThis.hyphonPyodideReady) {
                logEngineFallback(
                    'pyodide',
                    'pyodide',
                    `bootstrap timeout (${PYODIDE_BOOTSTRAP_TIMEOUT_MS}ms) — is public/pyodide/ vendored?`,
                );
                setPyodideStatus('Python engine timed out (check public/pyodide/ — pnpm run vendor:pyodide)');
            }
        }, PYODIDE_BOOTSTRAP_TIMEOUT_MS);

        window.addEventListener('hyphon-pyodide-ready', handleReady);
        window.addEventListener('hyphon-pyodide-error', handleError);

        return () => {
            window.clearTimeout(timeoutId);
            window.removeEventListener('hyphon-pyodide-ready', handleReady);
            window.removeEventListener('hyphon-pyodide-error', handleError);
        };
    }, [isPyodideReady]);

    useEffect(() => {
        if (isPyodideReady) {
            try { engineTelemetry.registerResolution('pyodide','pyodide','ready'); } catch (e) { /* noop */ }
        }
    }, [isPyodideReady]);

    return { pyodide, isPyodideReady, pyodideStatus };
};
