import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAppState } from '../useAppState';

describe('useAppState step interactions', () => {
  it('selects an active step on first click instead of toggling it off', () => {
    const { result } = renderHook(() => useAppState());

    act(() => {
      result.current.setPattern((prev) => {
        const copy = { ...prev };
        copy.partA = { ...copy.partA, steps: [...copy.partA.steps] };
        copy.partA.steps[0] = { note: 'C4', velocity: 1, length: 1, slide: false };
        return copy;
      });
    });

    expect(result.current.pattern.partA.steps[0]).not.toBeNull();

    act(() => {
      result.current.handleStepToggle('partA', 0, {
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        preventDefault: vi.fn(),
      });
    });

    expect(result.current.pattern.partA.steps[0]).not.toBeNull();
    expect(result.current.selection).toEqual({ trackKey: 'partA', startStep: 0, endStep: 0 });
  });

  it('keeps draw-enter from painting neighboring steps', () => {
    const { result } = renderHook(() => useAppState());

    act(() => {
      result.current.handleStepToggle('partA', 2, {
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        preventDefault: vi.fn(),
      });
    });

    expect(result.current.pattern.partA.steps[2]).not.toBeNull();

    act(() => {
      result.current.handleDrawEnter('partA', 3);
    });

    expect(result.current.pattern.partA.steps[3]).toBeNull();
  });
});
