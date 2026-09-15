import '@testing-library/jest-dom';
import { act, fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppStateProvider, useAppStateContext } from '@/contexts/AppStateContext';
import { uiModalsStore, useUIModalsStore } from '@/stores/uiModalsStore';

vi.mock('../services/AISongStorage', () => ({
    AISongStorage: {
        saveSong: vi.fn(),
        loadSong: vi.fn(),
    },
}));

/**
 * Guards the foundation the mega-context migration (see the "Split
 * useAppState's surface" plan) depends on: a component that reads a slice
 * of app state from an external store — instead of destructuring it off
 * `useAppStateContext()` — must not re-render when something unrelated
 * changes elsewhere in `useAppState()`'s single returned object.
 *
 * `is3DMode` was the first field moved off the mega-context onto
 * `uiModalsStore` (see src/stores/uiModalsStore.ts). This test edits the
 * sequencer pattern — the same state a step toggle mutates — and confirms
 * a store-only consumer is untouched, while a component still reading off
 * the shared context re-renders as before.
 *
 * TransportHeader/RackNode/BottomBar still pull most of their remaining
 * fields from the shared context, so they are not yet isolated from a step
 * toggle end-to-end — that requires the rest of the migration described in
 * useAppState.tsx's module doc (transport/mix, sampler banks, pattern edit,
 * instrument state, session/song). This test locks in the one slice that
 * *is* fully migrated today so it can't silently regress.
 */

const is3DModeRenderSpy = vi.fn();
function Is3DModeProbe() {
    const is3DMode = useUIModalsStore((s) => s.is3DMode);
    is3DModeRenderSpy();
    return <div data-testid="probe">{String(is3DMode)}</div>;
}

const contextConsumerRenderSpy = vi.fn();
function PatternEditTrigger() {
    const { setPattern } = useAppStateContext();
    contextConsumerRenderSpy();
    return (
        <button
            type="button"
            onClick={() => setPattern((prev) => ({ ...prev }))}
        >
            edit pattern
        </button>
    );
}

describe('uiModalsStore render isolation', () => {
    beforeEach(() => {
        uiModalsStore.reset();
        is3DModeRenderSpy.mockClear();
        contextConsumerRenderSpy.mockClear();
    });

    it('does not re-render a store-only consumer when an unrelated pattern edit happens', () => {
        const { getByText } = render(
            <AppStateProvider>
                <Is3DModeProbe />
                <PatternEditTrigger />
            </AppStateProvider>,
        );

        expect(is3DModeRenderSpy).toHaveBeenCalledTimes(1);
        const contextRendersBeforeEdit = contextConsumerRenderSpy.mock.calls.length;

        act(() => {
            fireEvent.click(getByText('edit pattern'));
        });

        // The context consumer re-renders: it pulled setPattern off the
        // same object that changed, so the whole context value is new.
        expect(contextConsumerRenderSpy.mock.calls.length).toBeGreaterThan(contextRendersBeforeEdit);

        // The store-only probe never touched AppStateContext, so the same
        // pattern edit does not re-render it.
        expect(is3DModeRenderSpy).toHaveBeenCalledTimes(1);
    });

    it('re-renders the store-only consumer when its own slice actually changes', () => {
        render(<Is3DModeProbe />);
        expect(is3DModeRenderSpy).toHaveBeenCalledTimes(1);

        act(() => {
            uiModalsStore.setIs3DMode(true);
        });

        expect(is3DModeRenderSpy).toHaveBeenCalledTimes(2);
    });
});
