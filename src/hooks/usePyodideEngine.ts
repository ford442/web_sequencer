import { useState, useEffect } from 'react';
import { engineTelemetry } from '../utils/engineTelemetry';

// This hook encapsulates the "Spectral Puppet" engine
export const usePyodideEngine = () => {
    // Check global state initially
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [pyodide, setPyodide] = useState<any>(globalThis.hyphonPyodide || null);
    const [isPyodideReady, setIsPyodideReady] = useState(!!globalThis.hyphonPyodideReady);
    const [pyodideStatus, setPyodideStatus] = useState(
        globalThis.hyphonPyodideReady ? 'Python Engine Ready!' : 'Waiting for C++ Orchestrator...'
    );

    useEffect(() => {
        if (isPyodideReady) return;

        const handleReady = () => {
            setPyodide(globalThis.hyphonPyodide);
            setIsPyodideReady(true);
            setPyodideStatus('Python Engine Ready!');
            try { engineTelemetry.registerResolution('pyodide','pyodide','ready'); } catch (e) { /* noop */ }
        };

        // Listen for the event dispatched by our emscripten post-js
        window.addEventListener('hyphon-pyodide-ready', handleReady);

        // Cleanup
        return () => window.removeEventListener('hyphon-pyodide-ready', handleReady);
    }, [isPyodideReady]);

    useEffect(() => {
        if (isPyodideReady) {
            try { engineTelemetry.registerResolution('pyodide','pyodide','ready'); } catch (e) { /* noop */ }
        }
    }, [isPyodideReady]);

    return { pyodide, isPyodideReady, pyodideStatus };
};
