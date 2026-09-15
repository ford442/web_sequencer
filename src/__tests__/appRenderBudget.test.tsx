import '@testing-library/jest-dom';
import { act, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from '../App';
import { AppStateProvider, useAppStateContext } from '../contexts/AppStateContext';
import { CompactLayoutProvider } from '../contexts/CompactLayoutContext';
import { NUM_STEPS } from '../constants';

vi.mock('../services/AISongStorage', () => ({
    AISongStorage: {
        saveSong: vi.fn(),
        loadSong: vi.fn(),
    },
}));

// Stub the heavy top-level regions so this test measures *how many times
// React calls them*, not what they render. Each stub still exercises the
// real memo/context wiring around it — only its own JSX body is replaced.
vi.mock('../components/appParts/TransportHeader', () => {
    const Stub = vi.fn(() => null);
    return { __esModule: true, default: Stub, TransportHeader: Stub };
});
vi.mock('../components/appParts/RackNode', () => {
    const Stub = vi.fn(() => null);
    return { __esModule: true, default: Stub, RackNode: Stub };
});
vi.mock('../components/appParts/SequencerNode', () => {
    const Stub = vi.fn(() => null);
    return { __esModule: true, default: Stub };
});
vi.mock('../components/appParts/KeyboardNode', () => {
    const Stub = vi.fn(() => null);
    return { __esModule: true, default: Stub };
});
vi.mock('../components/BottomBar', () => {
    const Stub = vi.fn(() => null);
    return { BottomBar: Stub };
});

import TransportHeader from '../components/appParts/TransportHeader';
import RackNode from '../components/appParts/RackNode';
import SequencerNode from '../components/appParts/SequencerNode';
import KeyboardNode from '../components/appParts/KeyboardNode';
import { BottomBar } from '../components/BottomBar';

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
 * The budget recorded here (see docs/PERFORMANCE_BUDGET.md) is today's
 * *baseline*, not an already-met target — TransportHeader, BottomBar and
 * RackNode still pull most of their fields from the shared context and are
 * expected to shrink toward ~0 renders here only once the remaining
 * migration phases (transport/mix, sampler banks, pattern edit, instrument
 * state, session/song) land. This test exists so that number can only go
 * down from here, not silently regress upward.
 */

const REGIONS: Array<{ name: string; mock: ReturnType<typeof vi.fn> }> = [
    { name: 'TransportHeader', mock: TransportHeader as unknown as ReturnType<typeof vi.fn> },
    { name: 'RackNode', mock: RackNode as unknown as ReturnType<typeof vi.fn> },
    { name: 'SequencerNode', mock: SequencerNode as unknown as ReturnType<typeof vi.fn> },
    { name: 'KeyboardNode', mock: KeyboardNode as unknown as ReturnType<typeof vi.fn> },
    { name: 'BottomBar', mock: BottomBar as unknown as ReturnType<typeof vi.fn> },
];

function totalRenders(): number {
    return REGIONS.reduce((sum, r) => sum + r.mock.mock.calls.length, 0);
}

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

// Current measured baseline is 160 (all 5 regions re-render on every one of
// the 32 edits: 5 × 32 = 160 — 100% fan-out, exactly the problem this PR's
// migration targets). Budget adds modest headroom above that measured
// baseline so incidental fluctuations don't flake the gate — see
// docs/PERFORMANCE_BUDGET.md.
const RENDER_BUDGET = 175;

describe('App top-level render budget', () => {
    it('stays within the documented budget across a full 32-step edit pass', () => {
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
        REGIONS.forEach((r) => r.mock.mockClear());

        // Each step toggle is its own act() — a real step edit (a click, a
        // MIDI event, a recorded step) is its own event-loop turn, not
        // batched together with the other 31 the way one shared act() would.
        for (let i = 0; i < NUM_STEPS; i += 1) {
            act(() => {
                toggleStep(i);
            });
        }

        const renders = totalRenders();
        console.log(`[perf] appRenderBudget.32StepPass: ${renders} renders across ${REGIONS.length} regions (budget ${RENDER_BUDGET})`);
        expect(renders).toBeLessThanOrEqual(RENDER_BUDGET);
    });
});
