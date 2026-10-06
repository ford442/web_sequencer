import '@testing-library/jest-dom';
import { act, render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    AppStateProvider, useAppStateContext, useAppStateSelector, useAppStateSlice, type AppState,
} from '@/contexts/AppStateContext';

vi.mock('@/services/AISongStorage', () => ({
    AISongStorage: {
        saveSong: vi.fn(),
        loadSong: vi.fn(),
    },
}));

/**
 * `useAppStateSelector` / `useAppStateSlice` contract: a consumer re-renders
 * when — and only when — the value it selected changes, and always sees the
 * current value when it does. `appRenderBudget.test.tsx` covers the same
 * property end to end on the real regions; this pins it at the hook level so
 * a regression points at the hook, not at a region.
 */

const KEYS = ['tempo', 'setTempo'] as const;

// Probes record what they saw into this holder (mutated, not reassigned, so
// the render functions stay free of outer-variable writes).
const seen = {
    state: null as AppState | null,
    tempo: 0,
    sliceTempo: 0,
    handlers: [] as Array<AppState['handleStepToggle']>,
};
const renders = { tempo: 0, slice: 0, pattern: 0, all: 0 };

function TempoProbe() {
    const tempo = useAppStateSelector((s) => s.tempo);
    seen.tempo = tempo;
    renders.tempo += 1;
    return <div data-testid="tempo">{tempo}</div>;
}

function SliceProbe() {
    const slice = useAppStateSlice(KEYS);
    seen.sliceTempo = slice.tempo;
    renders.slice += 1;
    return null;
}

function PatternProbe() {
    const pattern = useAppStateSelector((s) => s.pattern);
    renders.pattern += 1;
    return <div data-testid="pattern">{pattern.kick.steps.filter(Boolean).length}</div>;
}

function WholeStateProbe() {
    const state = useAppStateContext();
    seen.state = state;
    renders.all += 1;
    seen.handlers.push(state.handleStepToggle);
    return null;
}

function mount() {
    return render(
        <AppStateProvider>
            <TempoProbe />
            <SliceProbe />
            <PatternProbe />
            <WholeStateProbe />
        </AppStateProvider>,
    );
}

/** Indices of kick steps with no note, so toggling them always adds one. */
function emptyKickSteps(): number[] {
    return seen.state!.pattern.kick.steps.flatMap((step, i) => (step ? [] : [i]));
}

const clickEvent = { altKey: false, ctrlKey: false, metaKey: false, preventDefault: () => {} };

describe('app state selectors', () => {
    beforeEach(() => {
        seen.state = null;
        seen.handlers.length = 0;
        renders.tempo = renders.slice = renders.pattern = renders.all = 0;
    });

    it('does not re-render a selector consumer when an unrelated field changes', () => {
        mount();
        const before = { ...renders };

        act(() => { seen.state!.handleStepToggle('kick', emptyKickSteps()[0], clickEvent); });

        expect(renders.pattern).toBeGreaterThan(before.pattern);
        expect(renders.tempo).toBe(before.tempo);
        expect(renders.slice).toBe(before.slice);
        // The whole-state hook is the escape hatch: it follows every change.
        expect(renders.all).toBeGreaterThan(before.all);
    });

    it('re-renders with the new value when the selected field changes', () => {
        const { getByTestId } = mount();
        const initial = seen.tempo;
        const before = { ...renders };

        act(() => { seen.state!.setTempo(initial + 7); });

        expect(seen.tempo).toBe(initial + 7);
        expect(seen.sliceTempo).toBe(initial + 7);
        expect(getByTestId('tempo')).toHaveTextContent(String(initial + 7));
        expect(renders.tempo).toBe(before.tempo + 1);
        expect(renders.slice).toBe(before.slice + 1);
    });

    it('keeps handler identity stable across state changes', () => {
        mount();

        const [a, b] = emptyKickSteps();
        act(() => { seen.state!.handleStepToggle('kick', a, clickEvent); });
        act(() => { seen.state!.handleStepToggle('kick', b, clickEvent); });

        expect(seen.handlers.length).toBeGreaterThan(2);
        expect(new Set(seen.handlers).size).toBe(1);
    });

    it('routes a stable handler to the latest state, not the render it was captured in', () => {
        const { getByTestId } = mount();
        const staleToggle = seen.state!.handleStepToggle;
        const before = Number(getByTestId('pattern').textContent);

        // Two edits through the *same* captured reference: if it closed over
        // its first render's pattern, the second would overwrite the first.
        const [a, b] = emptyKickSteps();
        act(() => { staleToggle('kick', a, clickEvent); });
        act(() => { staleToggle('kick', b, clickEvent); });

        expect(Number(getByTestId('pattern').textContent)).toBe(before + 2);
    });

    it('throws a clear error outside the provider', () => {
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        expect(() => render(<TempoProbe />)).toThrow(/AppStateProvider/);
        spy.mockRestore();
    });
});
