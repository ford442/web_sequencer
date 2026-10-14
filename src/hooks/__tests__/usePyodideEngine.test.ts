import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePyodideEngine } from '../usePyodideEngine';

const initPyodideSystem = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../../pyodide/bootstrap', () => ({ initPyodideSystem }));

describe('usePyodideEngine init path', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    globalThis.hyphonPyodide = undefined;
    globalThis.hyphonPyodideReady = false;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts the bootstrap module itself (no hyphon_native main() any more)', async () => {
    vi.useRealTimers();
    initPyodideSystem.mockClear();
    renderHook(() => usePyodideEngine());
    await waitFor(() => expect(initPyodideSystem).toHaveBeenCalledTimes(1));
  });

  it('does not start the bootstrap when Pyodide is already up', async () => {
    vi.useRealTimers();
    initPyodideSystem.mockClear();
    globalThis.hyphonPyodideReady = true;
    renderHook(() => usePyodideEngine());
    await new Promise((r) => setTimeout(r, 0));
    expect(initPyodideSystem).not.toHaveBeenCalled();
  });

  it('logs classified fallback on bootstrap timeout', () => {
    const { result } = renderHook(() => usePyodideEngine());

    expect(result.current.isPyodideReady).toBe(false);

    act(() => {
      vi.advanceTimersByTime(180_001);
    });

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('[EngineFallback] pyodide'),
    );
    expect(result.current.pyodideStatus).toContain('timed out');
  });

  it('marks ready when hyphon-pyodide-ready fires', () => {
    const fakePyodide = { globals: { get: vi.fn() } };
    const { result } = renderHook(() => usePyodideEngine());

    act(() => {
      globalThis.hyphonPyodide = fakePyodide;
      globalThis.hyphonPyodideReady = true;
      window.dispatchEvent(new CustomEvent('hyphon-pyodide-ready'));
    });

    expect(result.current.isPyodideReady).toBe(true);
    expect(result.current.pyodide).toBe(fakePyodide);
  });
});
