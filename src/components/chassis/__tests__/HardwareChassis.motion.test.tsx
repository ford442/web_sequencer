import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('../../knobMotion', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../knobMotion')>()),
    getPrefersReducedMotion: () => motion.reduced,
}));

import { useChassisKnobMaterial } from '../chassisContext';
import { KNOB_MATERIAL_CHASSIS } from '../../knobMaterial';
import { CHASSIS_CONTENT_DELAY_MS, CHASSIS_MORPH_MS, HardwareChassis, type HardwareChassisProps } from '../HardwareChassis';

const strip = <div data-testid="strip">strip</div>;
const keys = <div data-testid="keys">keys</div>;

function Chassis(props: Partial<HardwareChassisProps>) {
    return (
        <HardwareChassis mode="osc" ledStrip={strip} keybed={keys} {...props}>
            {props.children ?? <input data-testid="primary-field" aria-label="primary" />}
        </HardwareChassis>
    );
}

const body = () => screen.getByRole('region', { name: /hardware chassis/i });
const panel = () => screen.getByTestId('chassis-stage').firstElementChild as HTMLElement;

interface AnimateCall {
    el: Element;
    keyframes: Keyframe[];
    options: KeyframeAnimationOptions;
    cancel: ReturnType<typeof vi.fn>;
}

let calls: AnimateCall[] = [];
const originalAnimate = HTMLElement.prototype.animate;

beforeEach(() => {
    motion.reduced = false;
    calls = [];
    HTMLElement.prototype.animate = function animate(this: Element, keyframes, options) {
        const cancel = vi.fn();
        calls.push({ el: this, keyframes: keyframes as Keyframe[], options: options as KeyframeAnimationOptions, cancel });
        return { cancel } as unknown as Animation;
    };
});

afterEach(() => {
    HTMLElement.prototype.animate = originalAnimate;
    vi.useRealTimers();
});

describe('HardwareChassis secondary panel (#1584)', () => {
    it('is closed until content is passed, and opening / closing never remounts the primary', () => {
        const { rerender } = render(<Chassis mode="pcf" />);
        expect(screen.queryByTestId('chassis-secondary')).toBeNull();
        expect(panel()).not.toHaveAttribute('data-secondary');
        const field = screen.getByTestId('primary-field');

        rerender(<Chassis mode="pcf" secondary={<div data-testid="routing">routing</div>} />);
        const secondary = screen.getByTestId('chassis-secondary');
        expect(secondary).toContainElement(screen.getByTestId('routing'));
        expect(screen.getByTestId('primary-field')).toBe(field);

        rerender(<Chassis mode="pcf" secondary={false} />);
        expect(screen.queryByTestId('chassis-secondary')).toBeNull();
        expect(screen.getByTestId('primary-field')).toBe(field);
    });

    it('takes placement and share from the mode, and props override them', () => {
        const { rerender } = render(<Chassis mode="pcf" secondary={<div />} />);
        expect(panel()).toHaveAttribute('data-secondary', 'side');
        expect(screen.getByTestId('chassis-secondary')).toHaveAttribute('data-placement', 'side');
        expect(panel().style.getPropertyValue('--chassis-secondary-size')).toBe('50%');

        // TTS opens its deck under the rack, sized to its content.
        rerender(<Chassis mode="tts" secondary={<div />} />);
        expect(panel()).toHaveAttribute('data-secondary', 'below');
        expect(panel().style.getPropertyValue('--chassis-secondary-size')).toBe('auto');

        // A mode without a secondary spec falls back to a 40% side panel.
        rerender(<Chassis mode="osc" secondary={<div />} />);
        expect(panel()).toHaveAttribute('data-secondary', 'side');
        expect(panel().style.getPropertyValue('--chassis-secondary-size')).toBe('40%');

        rerender(<Chassis mode="osc" secondary={<div />} secondaryPlacement="below" secondaryShare={0.25} />);
        expect(panel()).toHaveAttribute('data-secondary', 'below');
        expect(panel().style.getPropertyValue('--chassis-secondary-size')).toBe('25%');
    });

    it('gives a side secondary a taller stage to stack into on narrow screens', () => {
        const { rerender } = render(<Chassis mode="pcf" />);
        expect(body()).not.toHaveAttribute('data-secondary');
        expect(body().style.getPropertyValue('--chassis-stage-h-stacked')).toBe('');

        // PCF: 320 px stage, 50% side share → the primary keeps 320 px when stacked.
        rerender(<Chassis mode="pcf" secondary={<div />} />);
        expect(body()).toHaveAttribute('data-secondary', 'side');
        expect(body().style.getPropertyValue('--chassis-stage-h-stacked')).toBe('640px');

        // `below` already stacks; no extra height.
        rerender(<Chassis mode="tts" secondary={<div />} />);
        expect(body()).toHaveAttribute('data-secondary', 'below');
        expect(body().style.getPropertyValue('--chassis-stage-h-stacked')).toBe('');
    });

    it('hands the chassis knob material to the secondary too', () => {
        function Probe() {
            return <span data-testid="probe">{useChassisKnobMaterial()?.id ?? 'none'}</span>;
        }
        render(<Chassis mode="pcf" secondary={<Probe />} />);
        expect(screen.getByTestId('probe')).toHaveTextContent(KNOB_MATERIAL_CHASSIS.id!);
    });
});

describe('HardwareChassis morph sequencing (#1584)', () => {
    it('plays nothing on first mount', () => {
        render(<Chassis mode="osc" />);
        expect(calls).toHaveLength(0);
        expect(body()).not.toHaveAttribute('data-morphing');
    });

    it('a footprint change hides the content during the morph, then fades it in', () => {
        vi.useFakeTimers();
        const { rerender } = render(<Chassis mode="osc" />);
        rerender(<Chassis mode="smp" />);

        expect(calls).toHaveLength(1);
        const [reveal] = calls;
        expect(reveal.el).toBe(panel());
        expect(reveal.keyframes[0]).toMatchObject({ opacity: 0 });
        expect(reveal.options.delay).toBe(CHASSIS_CONTENT_DELAY_MS);
        expect(reveal.options.fill).toBe('backwards');
        expect(CHASSIS_CONTENT_DELAY_MS).toBeLessThan(CHASSIS_MORPH_MS);

        expect(body()).toHaveAttribute('data-morphing', 'true');
        expect(body().style.getPropertyValue('--chassis-morph-duration')).toBe(`${CHASSIS_MORPH_MS}ms`);
        vi.advanceTimersByTime(CHASSIS_MORPH_MS);
        expect(body()).not.toHaveAttribute('data-morphing');
    });

    it('a panel change inside one footprint plays the quick entry with no wait', () => {
        const { rerender } = render(<Chassis mode="osc" panelKey="partA" />);
        rerender(<Chassis mode="osc" panelKey="partB" />);
        expect(calls).toHaveLength(1);
        expect(calls[0].options.delay ?? 0).toBe(0);
        expect(body()).not.toHaveAttribute('data-morphing');
    });

    it('opening a secondary counts as a morph and slides the secondary in after the primary', () => {
        const { rerender } = render(<Chassis mode="pcf" />);
        rerender(<Chassis mode="pcf" secondary={<div />} />);
        expect(calls).toHaveLength(2);
        const [primary, secondary] = calls;
        expect(primary.el).toBe(panel());
        expect(secondary.el).toBe(screen.getByTestId('chassis-secondary'));
        expect(secondary.options.delay).toBeGreaterThan(primary.options.delay ?? 0);
        expect(body()).toHaveAttribute('data-morphing', 'true');
    });

    it('a change mid-morph cancels the running animation before starting the next', () => {
        const { rerender } = render(<Chassis mode="osc" />);
        rerender(<Chassis mode="smp" />);
        rerender(<Chassis mode="tts" />);
        expect(calls).toHaveLength(2);
        expect(calls[0].cancel).toHaveBeenCalled();
        expect(calls[1].cancel).not.toHaveBeenCalled();
    });

    it('reduced motion skips every animation and the morphing flag', () => {
        motion.reduced = true;
        const { rerender } = render(<Chassis mode="osc" />);
        rerender(<Chassis mode="vd" secondary={<div />} />);
        rerender(<Chassis mode="vd" panelKey="other" secondary={<div />} />);
        expect(calls).toHaveLength(0);
        expect(body()).not.toHaveAttribute('data-morphing');
    });
});

describe('HardwareChassis target-size hold (#1584)', () => {
    function hostWithWidth(width: number, padding = 16): HTMLDivElement {
        const host = document.createElement('div');
        host.style.paddingLeft = `${padding}px`;
        host.style.paddingRight = `${padding}px`;
        Object.defineProperty(host, 'clientWidth', { configurable: true, get: () => width });
        document.body.appendChild(host);
        return host;
    }

    it('lays the panel out at the width the stage is heading to', () => {
        // Parent content box 1400 - 32 = 1368 px; body padding 24 + 24.
        const host = hostWithWidth(1400);
        const { rerender } = render(<Chassis mode="osc" />, { container: host });
        body().style.paddingLeft = '24px';
        body().style.paddingRight = '24px';
        // Remeasures when the target width changes: VD widens the body to 1180.
        rerender(<Chassis mode="vd" />);
        expect(body().style.getPropertyValue('--chassis-stage-w')).toBe(`${1180 - 48}px`);
        rerender(<Chassis mode="osc" />);
        expect(body().style.getPropertyValue('--chassis-stage-w')).toBe(`${1000 - 48}px`);
        host.remove();
    });

    it('caps the target at the parent when the parent is narrower than the mode', () => {
        const host = hostWithWidth(900, 0);
        render(<Chassis mode="vd" />, { container: host });
        expect(body().style.getPropertyValue('--chassis-stage-w')).toBe('900px');
        host.remove();
    });

    it('leaves the width to CSS when there is no layout to measure', () => {
        render(<Chassis mode="vd" />);
        expect(body().style.getPropertyValue('--chassis-stage-w')).toBe('');
    });
});
