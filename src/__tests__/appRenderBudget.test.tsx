import '@testing-library/jest-dom';
import { act, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from '@/App';
import { AppStateProvider, useAppStateSelector } from '@/contexts/AppStateContext';
import { CompactLayoutProvider } from '@/contexts/CompactLayoutContext';
import { NUM_STEPS } from '@/constants';
import TransportHeader from '@/components/appParts/TransportHeader';
import RackNode from '@/components/appParts/RackNode';
import { SequencerGrid } from '@/components/appParts/SequencerNode';
import KeyboardNode from '@/components/appParts/KeyboardNode';
import { BottomBar } from '@/components/BottomBar';
import ContextMenuNode from '@/components/appParts/ContextMenuNode';
import { ToastNode } from '@/components/appParts/AppOverlays';
import { LyricTrackNode, MobileTransportNode, SessionNode, SongModeNode } from '@/components/appParts/PanelNodes';

vi.mock('@/services/AISongStorage', () => ({
    AISongStorage: {
        saveSong: vi.fn(),
        loadSong: vi.fn(),
    },
}));

/**
 * Render budget for the app's UI regions across one full pass of 32
 * sequential step edits — the same `setPattern` update a user toggling every
 * step of a track (or the automation/step-recording path) performs.
 *
 * Real playback-driven step *highlighting* already bypasses React state
 * (`sequencerRef.current.setHighlight()` mutates the DOM directly — see
 * useAppState.tsx's onStep wiring), so it isn't what's measured here.
 *
 * Every region subscribes to exactly the fields it renders via
 * `useAppStateSlice` / `useAppStateSelector` (see AppStateContext.tsx and
 * stores/appStateStore.ts), so a pattern edit re-renders `SequencerGrid` —
 * the one region that draws the pattern — and nothing else. That is the
 * floor: one grid render per edit. Anything above it means a region has
 * started reading state it doesn't draw, or a hook upstream is handing out an
 * unstable value (a fresh array/closure each render) that invalidates a
 * memoised child.
 *
 * Instrumentation: each region is `React.memo(fn)`, an object of shape
 * `{ type: fn, compare, ... }`. Rather than replacing the component with a
 * stub (which would only measure whether the parent passes a new element —
 * a different question, since memo's prop bailout and each region's own
 * subscriptions are what actually decide whether it re-renders), this patches
 * `.type` in place so the real render function still runs — only the call
 * itself is also counted. This mutates the same singleton module object the
 * app imports, so it observes exactly what the app would trigger.
 *
 * See docs/PERFORMANCE_BUDGET.md.
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

/** The one region that legitimately re-renders on a pattern edit. */
const GRID_REGION = 'SequencerGrid';

const REGIONS: Array<{ name: string; component: unknown }> = [
    { name: 'TransportHeader', component: TransportHeader },
    { name: 'RackNode', component: RackNode },
    { name: GRID_REGION, component: SequencerGrid },
    { name: 'KeyboardNode', component: KeyboardNode },
    { name: 'BottomBar', component: BottomBar },
    { name: 'ContextMenuNode', component: ContextMenuNode },
    { name: 'ToastNode', component: ToastNode },
    { name: 'SongModeNode', component: SongModeNode },
    { name: 'SessionNode', component: SessionNode },
    { name: 'MobileTransportNode', component: MobileTransportNode },
    { name: 'LyricTrackNode', component: LyricTrackNode },
];

function StepEditDriver({ captureToggle }: { captureToggle: (toggle: (i: number) => void) => void }) {
    const handleStepToggle = useAppStateSelector((s) => s.handleStepToggle);
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

// Measured: SequencerGrid renders once per edit (32) and every other region
// renders 0 times. The budget is that floor plus a little slack for an
// incidental extra grid commit; the per-region assertion below is what pins
// the other regions at exactly zero. Lowering it is always safe; raising it
// means a region regressed — see docs/PERFORMANCE_BUDGET.md.
const RENDER_BUDGET = 34;

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
            const offenders = spies.filter((s) => s.name !== GRID_REGION && s.spy.mock.calls.length > 0);
            expect(offenders.map((s) => `${s.name}=${s.spy.mock.calls.length}`)).toEqual([]);
            expect(renders).toBeLessThanOrEqual(RENDER_BUDGET);
        } finally {
            spies.forEach((s) => s.restore());
        }
    });
});
