import '@testing-library/jest-dom';
import { Profiler, type ProfilerOnRenderCallback } from 'react';
import { act, render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import App from '@/App';
import { AppStateProvider, useAppStateSelector } from '@/contexts/AppStateContext';
import { CompactLayoutProvider } from '@/contexts/CompactLayoutContext';
import TransportHeader from '@/components/appParts/TransportHeader';
import RackNode from '@/components/appParts/RackNode';
import { SequencerGrid } from '@/components/appParts/SequencerNode';
import KeyboardNode from '@/components/appParts/KeyboardNode';
import { BottomBar } from '@/components/BottomBar';
import { liveProject } from '@/collab/liveProject';
import { startLiveProject, stopLiveProject } from '@/collab/liveProjectRuntime';

vi.mock('@/services/AISongStorage', () => ({
    AISongStorage: {
        saveSong: vi.fn(),
        loadSong: vi.fn(),
    },
}));

/**
 * Render budget for a knob drag during playback (#1597 P2 acceptance).
 *
 * A drag is a stream of `handleSynthChange` calls — one per pointer move —
 * while the transport runs, here with the project runtime attached (every
 * move is written into the doc). Binding the instrument params to the doc
 * must not add renders: the doc write happens in the store listener, outside
 * React, and only the rack (which draws the knob) and its provider commit.
 * The whole drag is one undo step.
 *
 * The numbers below were measured on the tree before the doc binding landed:
 * three Profiler commits per move and one RackNode render per move. They are
 * ceilings: lowering them is always safe; raising them is a regression.
 */

const MOVES = 30;
/** Profiler commits of the whole app tree during the drag (measured before P2: 90). */
const COMMIT_BUDGET = 90;
/** Renders of the rack, which draws the knob (measured before P2: 30). */
const RACK_RENDER_BUDGET = 30;

interface MemoComponent {
    type: (...args: unknown[]) => unknown;
}

function spyOnRender(component: unknown): { count: () => number; restore: () => void } {
    const memoComponent = component as MemoComponent;
    const originalType = memoComponent.type;
    let calls = 0;
    memoComponent.type = (...args: unknown[]) => {
        calls += 1;
        return originalType(...args);
    };
    return {
        count: () => calls,
        restore: () => {
            memoComponent.type = originalType;
        },
    };
}

interface Driver {
    drag: (value: number) => void;
    play: () => void;
}

function KnobDriver({ capture }: { capture: (driver: Driver) => void }) {
    const handleSynthChange = useAppStateSelector((s) => s.handleSynthChange);
    const setIsPlaying = useAppStateSelector((s) => s.setIsPlaying);
    capture({
        drag: (value) => handleSynthChange(true, 'filterCutoff', value),
        play: () => setIsPlaying(true),
    });
    return null;
}

describe('knob drag render budget', () => {
    it('a knob drag during playback commits no more than it did before the doc binding', () => {
        const regions = {
            TransportHeader: spyOnRender(TransportHeader),
            RackNode: spyOnRender(RackNode),
            SequencerGrid: spyOnRender(SequencerGrid),
            KeyboardNode: spyOnRender(KeyboardNode),
            BottomBar: spyOnRender(BottomBar),
        };
        let commits = 0;
        const onRender: ProfilerOnRenderCallback = () => {
            commits += 1;
        };
        try {
            startLiveProject();
            let driver: Driver = { drag: () => {}, play: () => {} };
            render(
                <Profiler id="app" onRender={onRender}>
                    <AppStateProvider>
                        <CompactLayoutProvider>
                            <App />
                            <KnobDriver capture={(d) => { driver = d; }} />
                        </CompactLayoutProvider>
                    </AppStateProvider>
                </Profiler>,
            );
            act(() => driver.play());

            commits = 0;
            const before = Object.fromEntries(Object.entries(regions).map(([name, r]) => [name, r.count()]));

            liveProject.beginGesture();
            for (let i = 1; i <= MOVES; i += 1) {
                act(() => driver.drag(i / (MOVES + 1)));
            }

            const renders = Object.fromEntries(
                Object.entries(regions).map(([name, r]) => [name, r.count() - before[name]]),
            );
            console.log(`[perf] knobDragRenderBudget: ${commits} commits, regions ${JSON.stringify(renders)}`);
            expect(commits).toBeLessThanOrEqual(COMMIT_BUDGET);
            expect(renders.RackNode).toBeLessThanOrEqual(RACK_RENDER_BUDGET);
            // Regions that do not draw the knob stay still.
            expect(renders.SequencerGrid).toBe(0);
            expect(renders.KeyboardNode).toBe(0);
            expect(renders.BottomBar).toBe(0);
            // Every move reached the doc, coalesced into one labelled step.
            expect(liveProject.getSnapshot().entries.map((e) => e.label)).toEqual([
                expect.stringMatching(/^Synth A: Cutoff \d+ → \d+$/),
            ]);
        } finally {
            Object.values(regions).forEach((r) => r.restore());
            stopLiveProject();
        }
    });
});
