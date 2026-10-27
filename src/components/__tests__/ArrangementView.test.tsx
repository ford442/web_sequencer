import '@testing-library/jest-dom';
import React, { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ArrangementView, type ArrangementViewProps } from '../ArrangementView';
import { createArrangement, placeClip } from '@/arrangement/model';
import { arrangementPlayhead } from '@/arrangement/playhead';
import type { Arrangement } from '@/types';
import type { TrackKey } from '@/constants/appDefaults';

const SLOTS = { partA: 0, partB: 0, bass2: 0, kick: 2, snare: 0, closedHat: 0, openHat: 0, sampler: 0 } as Record<TrackKey, number>;
const METER = { stepCount: 16, timeSignature: [4, 4] as [number, number], trackLengths: {} };

/** Holds the arrangement like useAppState does; `onEdit` applies the updater. */
function Harness({ initial, onRender }: { initial: Arrangement; onRender?: () => void }) {
    const [arrangement, setArrangement] = useState(initial);
    const props: ArrangementViewProps = {
        arrangement,
        meter: METER,
        activeTrackSlots: SLOTS,
        isSongModeActive: false,
        onSetIsSongModeActive: vi.fn(),
        onEdit: (updater) => setArrangement((prev) => updater(prev)),
        onUndo: vi.fn(),
        onRedo: vi.fn(),
        canUndo: false,
        canRedo: false,
        onClose: vi.fn(),
    };
    onRender?.();
    return <ArrangementView {...props} />;
}

const oneKick = placeClip(createArrangement(64), { id: 'clip-1', track: 'kick', patternSlot: 0, startStep: 0, lengthSteps: 16, loop: true });

describe('ArrangementView', () => {
    afterEach(() => arrangementPlayhead.publish(-1));

    it('adds a clip of the track’s current slot after its last clip', () => {
        render(<Harness initial={oneKick} />);
        fireEvent.click(screen.getByRole('button', { name: 'Add KICK clip' }));
        const added = screen.getByRole('button', { name: /KICK clip, pattern 3, at 2\.1\.1, 1 bar/ });
        expect(added).toHaveAttribute('aria-pressed', 'true');
    });

    it('moves, resizes, toggles loop and deletes with the keyboard', () => {
        render(<Harness initial={oneKick} />);
        const clip = () => screen.getByRole('button', { name: /^KICK clip/ });
        fireEvent.keyDown(clip(), { key: 'ArrowRight' });
        expect(clip()).toHaveAccessibleName(/at 1\.2\.1/);
        fireEvent.keyDown(clip(), { key: 'ArrowLeft', shiftKey: true });
        expect(clip()).toHaveAccessibleName(/12 steps/);
        fireEvent.keyDown(clip(), { key: 'l' });
        expect(clip()).toHaveAccessibleName(/one-shot/);
        fireEvent.keyDown(clip(), { key: 'Delete' });
        expect(screen.queryByRole('button', { name: /^KICK clip/ })).toBeNull();
    });

    it('trims a clip by dragging its right edge, as one edit', () => {
        const edits = vi.fn();
        function Spy() {
            const [arr, setArr] = useState(oneKick);
            return (
                <ArrangementView
                    arrangement={arr}
                    meter={METER}
                    activeTrackSlots={SLOTS}
                    isSongModeActive={false}
                    onSetIsSongModeActive={vi.fn()}
                    onEdit={(u) => { edits(); setArr((p) => u(p)); }}
                    onUndo={vi.fn()} onRedo={vi.fn()} canUndo={false} canRedo={false} onClose={vi.fn()}
                />
            );
        }
        render(<Spy />);
        const clip = screen.getByRole('button', { name: /^KICK clip/ });
        // Bar zoom: 192 px per 16-step bar = 12 px/step. The clip is 192 px wide.
        clip.getBoundingClientRect = () => ({ left: 0, width: 192, top: 0, height: 28, right: 192, bottom: 28, x: 0, y: 0, toJSON: () => ({}) });
        fireEvent.pointerDown(clip, { button: 0, clientX: 190, pointerId: 1 });
        fireEvent.pointerMove(clip, { clientX: 142, pointerId: 1 });
        fireEvent.pointerMove(clip, { clientX: 94, pointerId: 1 });
        expect(edits).not.toHaveBeenCalled();
        fireEvent.pointerUp(clip, { clientX: 94, pointerId: 1 });
        expect(edits).toHaveBeenCalledTimes(1);
        // -96 px = -8 steps, snapped to beats (4).
        expect(screen.getByRole('button', { name: /^KICK clip/ })).toHaveAccessibleName(/8 steps/);
    });

    it('moves the playhead from the worklet step without re-rendering', () => {
        const renders = vi.fn();
        render(<Harness initial={oneKick} onRender={renders} />);
        renders.mockClear();
        const head = screen.getByTestId('arrangement-playhead');
        expect(head).toHaveStyle({ display: 'none' });
        act(() => arrangementPlayhead.publish(8));
        expect(head).toHaveStyle({ display: 'block' });
        expect(head.style.transform).toBe('translateX(188px)');
        expect(renders).not.toHaveBeenCalled();
    });

    it('edits the focused clip\'s own lanes in clip-local steps, one edit per breakpoint (#1494)', () => {
        const lead = placeClip(createArrangement(64), { id: 'clip-1', track: 'partA', patternSlot: 0, startStep: 16, lengthSteps: 16, loop: true });
        const edits: Arrangement[] = [];
        function Spy() {
            const [arr, setArr] = useState(lead);
            return (
                <ArrangementView
                    arrangement={arr}
                    meter={METER}
                    activeTrackSlots={SLOTS}
                    isSongModeActive={false}
                    onSetIsSongModeActive={vi.fn()}
                    onEdit={(u) => setArr((p) => { const next = u(p); edits.push(next); return next; })}
                    onUndo={vi.fn()}
                    onRedo={vi.fn()}
                    canUndo={false}
                    canRedo={false}
                    onClose={vi.fn()}
                />
            );
        }
        render(<Spy />);
        fireEvent.focus(screen.getByRole('button', { name: /^LEAD clip, pattern 1, at 2\.1\.1/ }));
        const panel = screen.getByRole('group', { name: 'Clip automation' });
        fireEvent.click(within(panel).getByRole('button', { name: '+ LANE' }));
        const editor = within(panel).getByRole('img', { name: /Curve editor for Cutoff/ });
        // jsdom has no layout: give the SVG a box so a click maps to a step.
        editor.getBoundingClientRect = () => ({ left: 0, top: 0, right: 560, bottom: 110, width: 560, height: 110, x: 0, y: 0, toJSON: () => ({}) });
        const before = edits.length;
        fireEvent.click(editor, { clientX: 8 + (560 - 16) * 0.5, clientY: 12 });
        expect(edits.length).toBe(before + 1);
        const clip = edits[edits.length - 1].clips.find((c) => c.id === 'clip-1')!;
        expect(clip.lanes).toHaveLength(1);
        expect(clip.lanes![0]).toMatchObject({ target: 'synthA', parameter: 'filterCutoff' });
        // Half way across a 16-step clip: clip-local step 8, not song step 24.
        expect(clip.lanes![0].points).toEqual([{ step: 8, value: 1 }]);
        expect(screen.getByRole('button', { name: /^LEAD clip, .*, automated$/ })).toBeInTheDocument();
    });
});
