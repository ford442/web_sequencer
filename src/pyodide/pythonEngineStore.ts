/**
 * Lifecycle of the Python table engine ("Spectral Puppet": numpy/scipy in the
 * vendored CPython, `public/pyodide/`).
 *
 * Python is a table generator that loads on demand — it is not on the playback
 * path, so nothing waits for it at boot. Something has to ask:
 *   - a `pyodide-*` waveform is selected (`useRequestPythonForWaveforms`),
 *   - an explicit Python render needs the runtime (`requestPythonEngine`),
 *   - the user presses the LOAD control on the start overlay.
 * Until then the status is `not-requested` and `src/pyodide/bootstrap.ts` (the
 * loader plus the Python source) is not even fetched: this module is the only
 * thing on the entry graph, and it reaches bootstrap through a dynamic
 * `import()`.
 *
 * A failed load (timeout, no `public/pyodide/`) is a degradation report, not a
 * disabled transport: `pyodide-*` waveforms fall back through the oscillator
 * BackendRegistry, and the user can retry from the degradation banner.
 */

import { useSyncExternalStore } from 'react';
import { engineTelemetry } from '../utils/engineTelemetry';
import { engineDegradationStore } from '../stores/engineDegradationStore';
import type { PyodideLike } from '../utils/pyodideBuffers';

export type PythonEngineStatus = 'not-requested' | 'loading' | 'ready' | 'failed';

export interface PythonEngineSnapshot {
    status: PythonEngineStatus;
    /** Why the load failed (`failed` only). */
    reason: string | null;
    /** What asked for the load (`loading`, `ready`, `failed`). */
    requestedBy: string | null;
    pyodide: PyodideLike | null;
}

export const PYTHON_ENGINE_TIMEOUT_MS = 180_000;
export const PYTHON_DEGRADATION_ID = 'python-table-engine';

const TIMEOUT_REASON = 'timed out — is public/pyodide/ vendored? (pnpm run vendor:pyodide)';

let snapshot: PythonEngineSnapshot = readGlobals();
let settle: ((pyodide: PyodideLike | null) => void) | null = null;
let pending: Promise<PyodideLike | null> | null = null;
let timeoutId: ReturnType<typeof setTimeout> | null = null;
let listening = false;
const listeners = new Set<() => void>();

function readGlobals(): PythonEngineSnapshot {
    const ready = !!globalThis.hyphonPyodideReady;
    return {
        status: ready ? 'ready' : 'not-requested',
        reason: null,
        requestedBy: null,
        pyodide: ready ? ((globalThis.hyphonPyodide as PyodideLike | undefined) ?? null) : null,
    };
}

function set(next: Partial<PythonEngineSnapshot>): void {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((l) => l());
}

function clearTimer(): void {
    if (timeoutId !== null) clearTimeout(timeoutId);
    timeoutId = null;
}

function onReady(): void {
    clearTimer();
    const pyodide = (globalThis.hyphonPyodide as PyodideLike | undefined) ?? null;
    set({ status: 'ready', reason: null, pyodide });
    try {
        engineTelemetry.registerResolution('pyodide', 'pyodide', 'ready');
    } catch {
        /* telemetry must never break audio */
    }
    // A late success (after a timeout was reported) clears the report.
    if (engineDegradationStore.getIssue(PYTHON_DEGRADATION_ID)) engineDegradationStore.resolve(PYTHON_DEGRADATION_ID);
    settle?.(pyodide);
    settle = null;
    pending = null;
}

function fail(reason: string, err?: unknown): void {
    clearTimer();
    const detail = err instanceof Error ? `${reason}: ${err.message}` : reason;
    console.warn(`[PythonEngine] ${detail}`);
    set({ status: 'failed', reason: detail, pyodide: null });
    engineDegradationStore.report({
        id: PYTHON_DEGRADATION_ID,
        subsystem: 'python-table-engine',
        category: 'wasm',
        message: 'Python table engine unavailable — pyodide-* waveforms use the native oscillators',
        reason: detail,
        status: 'active',
        activeBackend: 'native-oscillators',
        requestedBackend: 'pyodide',
        retryable: true,
    });
    settle?.(null);
    settle = null;
    pending = null;
}

function onError(ev: Event): void {
    const detail = (ev as CustomEvent<{ reason?: string; error?: string }>).detail;
    fail(detail?.error ?? detail?.reason ?? 'hyphon-pyodide-error event');
}

function listen(): void {
    if (listening || typeof window === 'undefined') return;
    listening = true;
    window.addEventListener('hyphon-pyodide-ready', onReady);
    window.addEventListener('hyphon-pyodide-error', onError);
    engineDegradationStore.registerRetryHandler(PYTHON_DEGRADATION_ID, async () => {
        if (!(await requestPythonEngine('retry'))) throw new Error(snapshot.reason ?? 'Python engine failed to load');
    });
}

/**
 * Start loading the Python engine (once). Resolves with the runtime, or null
 * when it fails — the failure is already reported by then. Safe to call from
 * every trigger: a load in flight or finished is reused.
 */
export function requestPythonEngine(requestedBy: string): Promise<PyodideLike | null> {
    if (snapshot.status === 'ready') return Promise.resolve(snapshot.pyodide);
    if (pending) return pending;
    listen();

    pending = new Promise<PyodideLike | null>((resolve) => {
        settle = resolve;
    });
    const result = pending;
    set({ status: 'loading', reason: null, requestedBy });
    timeoutId = setTimeout(() => fail(TIMEOUT_REASON), PYTHON_ENGINE_TIMEOUT_MS);

    // The loader and the Python source are their own lazy chunk. The ready /
    // error events settle the request; only a chunk that cannot load lands here.
    void import('./bootstrap')
        .then(({ initPyodideSystem }) => initPyodideSystem())
        .catch((err: unknown) => fail('bootstrap module failed to load', err));
    return result;
}

const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};
const getSnapshot = (): PythonEngineSnapshot => snapshot;

export function usePythonEngine(): PythonEngineSnapshot {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Human line for the status: what the overlay and the legacy `pyodideStatus` string show. */
export function pythonEngineLabel(s: PythonEngineSnapshot): string {
    switch (s.status) {
        case 'ready': return 'Python table engine loaded';
        case 'loading': return 'Loading Python table engine...';
        case 'failed': return `Python table engine failed: ${s.reason ?? 'unknown'}`;
        default: return 'Python table engine not requested';
    }
}

/** Test hook: back to a fresh page. */
export function resetPythonEngineForTests(): void {
    clearTimer();
    settle = null;
    pending = null;
    snapshot = readGlobals();
    engineDegradationStore.clear(PYTHON_DEGRADATION_ID);
    listeners.forEach((l) => l());
}
