/**
 * KnobOverlay's slider reports the value the listener actually hears.
 *
 * Since #1522, an automated knob's `aria-valuenow` is the *lane* value
 * (normalised 0..1 → 0..100), not the knob's own setting. 0 is a legitimate
 * reading: the RBS E2E fixture's cutoff lane starts every bar at 0, which is why
 * `tests/rbs-automation.spec.ts` asserts "integer in 0..100 and moving", not "> 0".
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { KnobOverlay, type KnobOverlayProps } from '../KnobOverlay';

function renderKnob(props: Partial<KnobOverlayProps>) {
    const base: KnobOverlayProps = {
        id: 'filterCutoff',
        label: 'CUTOFF',
        x: 0.5,
        y: 0.5,
        size: 0.1,
        value: 0.7,
        colorHex: [0, 200, 255],
        index: 0,
        onParamChange: () => {},
        onRegisterRef: () => {},
    };
    return render(<KnobOverlay {...base} {...props} />);
}

describe('KnobOverlay aria-valuenow', () => {
    it("reports the knob's own value when not automated", () => {
        renderKnob({ value: 0.7 });
        const slider = screen.getByRole('slider', { name: 'CUTOFF' });
        expect(slider.getAttribute('aria-valuenow')).toBe('70');
    });

    it('reports the automated lane value, including a lane at 0', () => {
        renderKnob({ value: 0.7, isAutomated: true, automatedValue: 0 });
        const slider = screen.getByRole('slider', { name: 'CUTOFF (automated)' });
        expect(slider.getAttribute('aria-valuenow')).toBe('0');
        expect(slider.getAttribute('aria-valuetext')).toBe('0 (automated)');
    });

    it('rounds a normalised lane value to 0..100 (the fixture ramp step 10 = 0.054)', () => {
        renderKnob({ value: 0.7, isAutomated: true, automatedValue: 0.05404285734393829 });
        expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('5');
    });

    it('falls back to the knob value while automated without a value yet', () => {
        renderKnob({ value: 0.25, isAutomated: true });
        expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('25');
    });
});
