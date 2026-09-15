import '@testing-library/jest-dom';
import { act, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from '@/App';
import { AppStateProvider, useAppStateContext } from '@/contexts/AppStateContext';
import { CompactLayoutProvider } from '@/contexts/CompactLayoutContext';
import { NUM_STEPS } from '@/constants';
import TransportHeader from '@/components/appParts/TransportHeader';
import RackNode from '@/components/appParts/RackNode';
import SequencerNode from '@/components/appParts/SequencerNode';
import KeyboardNode from '@/components/appParts/KeyboardNode';
import { BottomBar } from '@/components/BottomBar';

vi.mock('@/services/AISongStorage', () => ({
    AISongStorage: {
        saveSong: vi.fn(),
        loadSong: vi.fn(),
    },
}));

/**
 * Render budget for the app's top-level UI regions across one full pass of
 * 32 sequential step edits — the same `setPattern` update a user toggling
 * every step of a track (or the automation/step-recording path) performs.
 *
 * Real playback-driven step *highlighting* already bypasses React state
 * (`sequencerRef.current.setHighlight()` mutates the DOM directly — see
 * useAppState.tsx's onStep wiring), so it isn't what's measured here; this
 * budget targets the mega-context re-render fan-out this test file's
 * sibling (uiModalsStore.renderIsolation.test.tsx) and useAppState.tsx's
 * module doc both describe: any `setPattern`-driven change re-renders every
 * region that reads `useAppStateContext()`, whether or not it uses
 * `pattern`.
 *
 * Instrumentation: each region (`TransportHeader`, `RackNode`,
 * `SequencerNode`, `KeyboardNode`, `BottomBar`) is exported as
 * `React.memo(fn)`, an object of shape `{ type: fn, compare, ... }`. Rather
 * than replacing the component with a stub (which would only measure
 * whether `App` re-renders and passes it a new element — a *different*
 * question, since `React.memo`'s prop-equality bailout and each region's own
 * `useAppStateContext()`/store subscriptions are what actually decide
 * whether it re-renders), this patches `.type` in place so the real render
 * function still runs, still subject to memo's bailout and each region's own
 * context/store subscriptions — only the call itself is also counted. This
 * mutates the same singleton module object `App` imports, so it observes
 * exactly what `App` would trigger.
 *
 * The budget recorded here (see docs/PERFORMANCE_BUDGET.md) is today's
 * *baseline*, not an already-met target — TransportHeader, RackNode,
 * SequencerNode and BottomBar still pull most of their fields from the
 * shared context and re-render on every one of the 32 edits; only
 * KeyboardNode (which takes props from App rather than reading
 * useAppStateContext() itself) is already at 0. The other four are expected
 * to shrink toward 0 only once the remaining migration phases (transport/mix,
 * sampler banks, pattern edit, instrument state, session/song) land. This
 * test exists so that number can only go down from here, not silently
 * regress upward.
 */

interface MemoComponent {
    type: (...args: unknown[]) => unknown;
}

function spyOnRender(component: unknown): { spy: ReturnType<typeof vi.fn>; restore: () => void } {
    const memoComponent = component as MemoComponent;
    const originalType = memoComponent.type;
    const spy = vi.fn();
    memoComponent.type = (...args: unknown[]) => {
        spy();
        return originalType(...args);
    };
    return {
        spy,
        restore: () => {
            memoComponent.type = originalType;
        },
    };
}

const REGIONS: Array<{ name: string; component: unknown }> = [
    { name: 'TransportHeader', component: TransportHeader },
    { name: 'RackNode', component: RackNode },
    { name: 'SequencerNode', component: SequencerNode },
    { name: 'KeyboardNode', component: KeyboardNode },
    { name: 'BottomBar', component: BottomBar },
];

function StepEditDriver({ captureToggle }: { captureToggle: (toggle: (i: number) => void) => void }) {
    const { handleStepToggle } = useAppStateContext();
    captureToggle((i: number) => {
        handleStepToggle('kick', i % NUM_STEPS, {
            altKey: false,
            ctrlKey: false,
            metaKey: false,
            preventDefault: () => {},
        });
    });
    return null;
}

// Current measured baseline is 128: TransportHeader, RackNode, SequencerNode
// and BottomBar each re-render on all 32 edits (4 × 32 = 128); KeyboardNode
// renders 0 times because it takes its props from App instead of reading
// useAppStateContext() itself, and none of those props change for a step
// edit — a preview of what the other regions look like once they've made
// the same move. Budget adds modest headroom above that measured baseline
// so incidental fluctuations don't flake the gate — see
// docs/PERFORMANCE_BUDGET.md.
const RENDER_BUDGET = 145;

describe('App top-level render budget', () => {
    it('stays within the documented budget across a full 32-step edit pass', () => {
        const spies = REGIONS.map((region) => ({ name: region.name, ...spyOnRender(region.component) }));

        try {
            let toggleStep: (i: number) => void = () => {};

            render(
                <AppStateProvider>
                    <CompactLayoutProvider>
                        <App />
                        <StepEditDriver captureToggle={(fn) => { toggleStep = fn; }} />
                    </CompactLayoutProvider>
                </AppStateProvider>,
            );

            // Only budget the pass itself, not the initial mount.
            spies.forEach((s) => s.spy.mockClear());

            // Each step toggle is its own act() — a real step edit (a click, a
            // MIDI event, a recorded step) is its own event-loop turn, not
            // batched together with the other 31 the way one shared act() would.
            for (let i = 0; i < NUM_STEPS; i += 1) {
                act(() => {
                    toggleStep(i);
                });
            }

            const renders = spies.reduce((sum, s) => sum + s.spy.mock.calls.length, 0);
            const breakdown = spies.map((s) => `${s.name}=${s.spy.mock.calls.length}`).join(', ');
            console.log(`[perf] appRenderBudget.32StepPass: ${renders} renders across ${REGIONS.length} regions (budget ${RENDER_BUDGET}) — ${breakdown}`);
            expect(renders).toBeLessThanOrEqual(RENDER_BUDGET);
        } finally {
            spies.forEach((s) => s.restore());
        }
    });
});
