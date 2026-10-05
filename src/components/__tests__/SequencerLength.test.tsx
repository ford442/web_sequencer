import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SequencerRow } from '../sequencer/SequencerRow';
import { MainSequencer, type MainSequencerHandle } from '../MainSequencer';
import { GridIndicators } from '../GridIndicators';
import { TrackLoopLengthChip, cycleTrackLength } from '../sequencer/TrackLoopLengthChip';
import { sequencerCssWidth, sequencerViewBoxWidth } from '../sequencer/stepHitGeometry';
import { transportMixStore } from '../../stores/transportMixStore';
import { EMPTY_PATTERN, getInitialTrackStorage } from '../../constants/appDefaults';
import type { Note, Pattern, TrackKey } from '../../types';
import { createRef } from 'react';

const noop = () => {};

const renderRow = (props: Partial<React.ComponentProps<typeof SequencerRow>> = {}) =>
    render(
        <svg>
            <SequencerRow
                rowKey="kick"
                label="Kick"
                rowIndex={0}
                steps={Array<Note | null>(32).fill(null)}
                isSelected={false}
                activeSlot={0}
                trackSlots={[]}
                onToggle={noop}
                onRightMouseDown={noop}
                onEditLength={noop}
                onSelectRow={noop}
                onSelectSlot={noop}
                {...props}
            />
        </svg>,
    );

const stepTestIds = (container: HTMLElement, rowKey: TrackKey) =>
    Array.from(container.querySelectorAll(`[data-testid^="step-${rowKey}-"]`)).map((el) => el.getAttribute('data-testid'));

describe('sequencer grid follows the pattern length', () => {
    beforeEach(() => {
        transportMixStore.reset();
    });

    it('renders 32 step cells by default', () => {
        const { container } = renderRow();
        expect(stepTestIds(container, 'kick')).toHaveLength(32);
    });

    it('renders exactly 16 cells for a 16-step pattern, even with longer stored data', () => {
        const { container } = renderRow({ columns: 16 });
        const ids = stepTestIds(container, 'kick');
        expect(ids).toHaveLength(16);
        expect(ids[0]).toBe('step-kick-0');
        expect(ids[15]).toBe('step-kick-15');
        expect(container.querySelector('[data-testid="step-kick-16"]')).toBeNull();
    });

    it('renders 64 cells when the steps array is shorter (no stored data past 32)', () => {
        const { container } = renderRow({ columns: 64 });
        expect(stepTestIds(container, 'kick')).toHaveLength(64);
    });

    it('dims steps past the track loop length but keeps them editable', () => {
        const onToggle = vi.fn();
        const { container } = renderRow({ columns: 16, loopLength: 12, onToggle });
        const inLoop = container.querySelector('[data-testid="step-kick-11"]')!;
        const outOfLoop = container.querySelector('[data-testid="step-kick-12"]')!;
        expect(inLoop.getAttribute('data-out-of-loop')).toBeNull();
        expect(outOfLoop.getAttribute('data-out-of-loop')).toBe('true');
        expect(outOfLoop.getAttribute('aria-label')).toContain('outside track loop');
        fireEvent.keyDown(outOfLoop, { key: 'Enter' });
        expect(onToggle).toHaveBeenCalledWith('kick', 12, expect.anything());
    });

    it('highlights the track step when a per-track resolver is passed', async () => {
        vi.useFakeTimers({ toFake: ['requestAnimationFrame'] });
        try {
            const ref = createRef<import('../sequencer/SequencerRow').SequencerRowHandle>();
            const { container } = render(
                <svg>
                    <SequencerRow
                        ref={ref}
                        rowKey="closedHat" label="CH" rowIndex={0}
                        steps={Array<Note | null>(16).fill(null)} isSelected={false} activeSlot={0} trackSlots={[]}
                        onToggle={noop} onRightMouseDown={noop} onEditLength={noop} onSelectRow={noop} onSelectSlot={noop}
                        columns={16} loopLength={12}
                    />
                </svg>,
            );
            act(() => {
                ref.current!.setHighlight(13, (key) => (key === 'closedHat' ? 1 : 13));
                vi.advanceTimersToNextFrame();
            });
            expect(container.querySelector('[data-testid="step-closedHat-1"]')!.classList.contains('is-current')).toBe(true);
            expect(container.querySelector('[data-testid="step-closedHat-13"]')!.classList.contains('is-current')).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('GridIndicators', () => {
    it('marks bars every 12 steps in 3/4', () => {
        const { container } = render(<svg><GridIndicators columns={24} stepsPerBeat={4} stepsPerBar={12} /></svg>);
        const ticks = Array.from(container.querySelectorAll('rect'));
        expect(ticks).toHaveLength(6); // beats at 0,4,8,12,16,20
        const barTicks = ticks.filter((r) => r.getAttribute('fill') === '#06b6d4');
        expect(barTicks).toHaveLength(2); // bars at 0 and 12
    });
});

describe('sequencer SVG geometry', () => {
    it('keeps the stock 32-step layout pixel-identical', () => {
        expect(sequencerViewBoxWidth(32)).toBe(1050);
        expect(sequencerCssWidth(32)).toBe('calc(220px + 830px * var(--zoom-level))');
    });

    it('widens for 64 steps and narrows for 8', () => {
        expect(sequencerViewBoxWidth(64)).toBeGreaterThan(1050);
        expect(sequencerViewBoxWidth(8)).toBeLessThan(1050);
    });
});

describe('MainSequencer reads the song meter', () => {
    beforeEach(() => {
        transportMixStore.reset();
    });

    const renderMain = () => {
        const pattern: Pattern = EMPTY_PATTERN;
        const ref = createRef<MainSequencerHandle>();
        const utils = render(
            <MainSequencer
                ref={ref}
                pattern={pattern}
                activeSamplerBank={0}
                selectedTrack="kick"
                activeTrackSlots={{ partA: 0, partB: 0, bass2: 0, kick: 0, snare: 0, closedHat: 0, openHat: 0, sampler: 0 }}
                trackStorage={getInitialTrackStorage(pattern)}
                selection={null}
                onToggle={noop}
                onRightMouseDown={noop}
                onEditLength={noop}
                onSelectRow={noop}
                onSelectSlot={noop}
                onSelectionStart={noop}
                onSelectionEnter={noop}
            />,
        );
        return { ...utils, ref };
    };

    it('renders stepCount columns per row', () => {
        act(() => transportMixStore.setStepCount(16));
        const { container } = renderMain();
        expect(stepTestIds(container, 'kick')).toHaveLength(16);
        expect(container.querySelector('[data-testid="step-kick-16"]')).toBeNull();
        expect(container.querySelector('svg')!.getAttribute('viewBox')).toBe(`0 0 ${sequencerViewBoxWidth(16)} 680`);
    });

    it('widens the grid to the longest track loop and dims the shorter rows', () => {
        act(() => {
            transportMixStore.setStepCount(16);
            transportMixStore.setTrackLength('partB', 24);
        });
        const { container } = renderMain();
        expect(stepTestIds(container, 'kick')).toHaveLength(24);
        expect(container.querySelector('[data-testid="step-kick-16"]')!.getAttribute('data-out-of-loop')).toBe('true');
        expect(container.querySelector('[data-testid="step-partB-23"]')!.getAttribute('data-out-of-loop')).toBeNull();
    });

    it('re-renders when the length changes', () => {
        const { container } = renderMain();
        expect(stepTestIds(container, 'kick')).toHaveLength(32);
        act(() => transportMixStore.setStepCount(12));
        expect(stepTestIds(container, 'kick')).toHaveLength(12);
    });
});

describe('TrackLoopLengthChip', () => {
    beforeEach(() => {
        transportMixStore.reset();
    });

    const renderChip = () =>
        render(
            <svg>
                <TrackLoopLengthChip trackKey="closedHat" label="CH" />
            </svg>,
        );

    it('starts following the pattern length', () => {
        renderChip();
        expect(screen.getByRole('button', { name: /CH loop length: follows pattern length/ })).toBeTruthy();
    });

    it('cycles forward on click and back on Shift-click', () => {
        renderChip();
        const chip = screen.getByTestId('track-len-closedHat');
        fireEvent.pointerDown(chip);
        expect(transportMixStore.getSnapshot().trackLengths.closedHat).toBe(8);
        fireEvent.pointerDown(chip);
        expect(transportMixStore.getSnapshot().trackLengths.closedHat).toBe(12);
        expect(chip.getAttribute('aria-label')).toContain('12 steps');
        fireEvent.pointerDown(chip, { shiftKey: true });
        expect(transportMixStore.getSnapshot().trackLengths.closedHat).toBe(8);
        fireEvent.pointerDown(chip, { shiftKey: true });
        expect(transportMixStore.getSnapshot().trackLengths.closedHat).toBeUndefined();
    });

    it('wraps from follow back to the longest preset', () => {
        expect(cycleTrackLength(null, -1, [4, 4])).toBe(64);
        expect(cycleTrackLength(64, 1, [4, 4])).toBeNull();
    });

    it('offers whole-bar lengths for odd meters', () => {
        expect(cycleTrackLength(12, 1, [7, 8])).toBe(14);
    });

    it('steps from a loaded length that is not a preset', () => {
        expect(cycleTrackLength(10, 1, [4, 4])).toBe(12);
        expect(cycleTrackLength(10, -1, [4, 4])).toBe(8);
    });
});
