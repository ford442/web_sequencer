import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePyodideEngine } from '../usePyodideEngine';

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

  it('logs classified fallback on bootstrap timeout', () => {
    const { result } = renderHook(() => usePyodideEngine());

    expect(result.current.isPyodideReady).toBe(false);

    act(() => {
      vi.advanceTimersByTime(60_001);
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
