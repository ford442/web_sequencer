import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePyodideEngine } from '../usePyodideEngine';
import { useRequestPythonForWaveforms } from '../useRequestPythonForWaveforms';
import {
    PYTHON_DEGRADATION_ID,
    PYTHON_ENGINE_TIMEOUT_MS,
    requestPythonEngine,
    resetPythonEngineForTests,
} from '../../pyodide/pythonEngineStore';
import { engineDegradationStore } from '../../stores/engineDegradationStore';

const initPyodideSystem = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const bootstrapLoaded = vi.hoisted(() => vi.fn());
vi.mock('../../pyodide/bootstrap', () => {
    bootstrapLoaded();
    return { initPyodideSystem };
});

describe('Python table engine (on demand)', () => {
    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        globalThis.hyphonPyodide = undefined;
        globalThis.hyphonPyodideReady = false;
        initPyodideSystem.mockClear();
        resetPythonEngineForTests();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('does not start the bootstrap just because the app mounted', async () => {
        const { result } = renderHook(() => usePyodideEngine());
        await new Promise((r) => setTimeout(r, 0));
        expect(initPyodideSystem).not.toHaveBeenCalled();
        expect(result.current.isPyodideReady).toBe(false);
        expect(result.current.pyodideStatus).toContain('not requested');
    });

    it('starts it when something asks, once', async () => {
        void requestPythonEngine('test');
        void requestPythonEngine('test again');
        await waitFor(() => expect(initPyodideSystem).toHaveBeenCalledTimes(1));
    });

    it('starts it for a pyodide-* waveform, and only for one', async () => {
        const { rerender } = renderHook(({ w }) => useRequestPythonForWaveforms(w), {
            initialProps: { w: ['sawtooth', '303-saw'] as string[] },
        });
        await new Promise((r) => setTimeout(r, 0));
        expect(initPyodideSystem).not.toHaveBeenCalled();

        rerender({ w: ['sawtooth', 'pyodide-saw'] });
        await waitFor(() => expect(initPyodideSystem).toHaveBeenCalledTimes(1));
    });

    it('starts it for the Pyodide filter source (#1676), and only for that one', async () => {
        const { rerender } = renderHook(({ f }) => useRequestPythonForWaveforms(['sawtooth'], f), {
            initialProps: { f: ['native', 'webgpu', undefined] as Array<string | undefined> },
        });
        await new Promise((r) => setTimeout(r, 0));
        expect(initPyodideSystem).not.toHaveBeenCalled();

        rerender({ f: ['native', 'pyodide'] });
        await waitFor(() => expect(initPyodideSystem).toHaveBeenCalledTimes(1));
    });

    it('reports ready when hyphon-pyodide-ready fires, and resolves the request', async () => {
        const fakePyodide = { globals: { get: vi.fn() } };
        const { result } = renderHook(() => usePyodideEngine());
        const loaded = requestPythonEngine('test');

        act(() => {
            globalThis.hyphonPyodide = fakePyodide;
            globalThis.hyphonPyodideReady = true;
            window.dispatchEvent(new CustomEvent('hyphon-pyodide-ready'));
        });

        await expect(loaded).resolves.toBe(fakePyodide);
        expect(result.current.isPyodideReady).toBe(true);
        expect(result.current.pyodide).toBe(fakePyodide);
    });

    it('a timeout is a degradation report with a retry, not a blocked app', async () => {
        vi.useFakeTimers();
        const { result } = renderHook(() => usePyodideEngine());
        const loaded = requestPythonEngine('test');

        await act(async () => {
            await vi.advanceTimersByTimeAsync(PYTHON_ENGINE_TIMEOUT_MS + 1);
        });

        await expect(loaded).resolves.toBeNull();
        expect(result.current.isPyodideReady).toBe(false);
        expect(result.current.pyodideStatus).toContain('timed out');
        const issue = engineDegradationStore.getIssue(PYTHON_DEGRADATION_ID);
        expect(issue).toMatchObject({ status: 'active', retryable: true, activeBackend: 'native-oscillators' });
    });

    it('a bootstrap error event is a degradation report, and a retry can recover', async () => {
        const { result } = renderHook(() => usePyodideEngine());
        const first = requestPythonEngine('test');
        act(() => {
            window.dispatchEvent(new CustomEvent('hyphon-pyodide-error', {
                detail: { reason: 'Pyodide bootstrap failed', error: 'Pyodide runtime not found at /pyodide/pyodide.js' },
            }));
        });
        await expect(first).resolves.toBeNull();
        expect(result.current.pyodideStatus).toContain('failed');
        expect(engineDegradationStore.getIssue(PYTHON_DEGRADATION_ID)?.reason).toContain('not found');

        const fakePyodide = { globals: { get: vi.fn() } };
        const retried = engineDegradationStore.retry(PYTHON_DEGRADATION_ID);
        act(() => {
            globalThis.hyphonPyodide = fakePyodide;
            globalThis.hyphonPyodideReady = true;
            window.dispatchEvent(new CustomEvent('hyphon-pyodide-ready'));
        });
        await expect(retried).resolves.toBe(true);
        expect(result.current.isPyodideReady).toBe(true);
    });

    it('reports a bootstrap chunk that cannot load', async () => {
        initPyodideSystem.mockRejectedValueOnce(new Error('chunk 404'));
        const { result } = renderHook(() => usePyodideEngine());
        await expect(requestPythonEngine('test')).resolves.toBeNull();
        expect(result.current.pyodideStatus).toContain('chunk 404');
    });
});
