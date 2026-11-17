/**
 * #1589 surface hooks: the white-chassis CSS keys off `data-*` attributes and
 * classes on the real step / pad / key components. These pin those hooks so
 * a refactor cannot silently drop the material.
 */
import { render, fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { DrumPads } from '../../DrumPads';
import { LiveKeyboard } from '../../LiveKeyboard';
import { SvgStep } from '../../sequencer/SvgStep';
import { setStepPlayhead } from '../../sequencer/playhead';
import type { TrackKey } from '../../../types';

describe('setStepPlayhead', () => {
    it('toggles is-current and data-playhead together', () => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        setStepPlayhead(el, true);
        expect(el.classList.contains('is-current')).toBe(true);
        expect(el.hasAttribute('data-playhead')).toBe(true);
        setStepPlayhead(el, false);
        expect(el.classList.contains('is-current')).toBe(false);
        expect(el.hasAttribute('data-playhead')).toBe(false);
    });

    it('ignores a missing element', () => {
        expect(() => setStepPlayhead(null, true)).not.toThrow();
    });
});

describe('SvgStep', () => {
    const renderStep = (active: boolean) => {
        const refs = { current: [] as (SVGGElement | null)[] };
        const noop = () => {};
        return render(
            <svg>
                <SvgStep
                    stepIndex={0}
                    active={active}
                    refsArray={refs}
                    rowLabel="Kick"
                    rowKey={'kick' as TrackKey}
                    onToggle={noop}
                    onRightMouseDown={noop}
                    onEditLength={noop}
                />
            </svg>,
        );
    };

    it('sets data-on only when active', () => {
        expect(renderStep(true).getByTestId('step-kick-0')).toHaveAttribute('data-on');
    });

    it('omits data-on when inactive', () => {
        expect(renderStep(false).getByTestId('step-kick-0')).not.toHaveAttribute('data-on');
    });
});

describe('DrumPads', () => {
    it('marks the held pad with data-hit and keeps the handlers', () => {
        const onPlayDrum = vi.fn();
        render(<DrumPads onPlayDrum={onPlayDrum} />);
        const kick = screen.getByRole('button', { name: 'Play KICK' });
        expect(kick).toHaveClass('live-pad');
        expect(kick.style.getPropertyValue('--c')).not.toBe('');
        expect(kick).not.toHaveAttribute('data-hit');

        fireEvent.mouseDown(kick);
        expect(onPlayDrum).toHaveBeenCalledWith('kick', 1.0);
        expect(kick).toHaveAttribute('data-hit');

        fireEvent.mouseUp(kick);
        expect(kick).not.toHaveAttribute('data-hit');
    });
});

describe('LiveKeyboard key bed', () => {
    beforeEach(() => localStorage.clear());

    it('tags keys white / black and marks the pressed key with data-down', () => {
        const onPlayNote = vi.fn();
        const { container } = render(<LiveKeyboard onPlayNote={onPlayNote} />);
        expect(container.querySelectorAll('.piano-key[data-key="white"]')).toHaveLength(8);
        expect(container.querySelectorAll('.piano-key[data-key="black"]')).toHaveLength(5);

        const c = container.querySelector('[aria-label="Play C5"]') as Element;
        expect(c).not.toHaveAttribute('data-down');
        fireEvent.mouseDown(c, { button: 0 });
        expect(onPlayNote).toHaveBeenCalledWith('C5');
        expect(c).toHaveAttribute('data-down');
        fireEvent.mouseUp(c);
        expect(c).not.toHaveAttribute('data-down');
    });

    it('lights the LED of every key whose pitch class is in ledNotes', () => {
        const { container } = render(
            <LiveKeyboard onPlayNote={vi.fn()} ledNotes={new Set(['C', 'E', 'G'])} />,
        );
        // C5, E5, G5 and C6.
        expect(container.querySelectorAll('.key-led[data-on]')).toHaveLength(4);
        expect(container.querySelectorAll('.key-led')).toHaveLength(13);
    });
});
