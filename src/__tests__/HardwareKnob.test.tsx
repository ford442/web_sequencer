import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { HardwareKnob } from '../components/HardwareKnob';
import { buildKnob2DDrawCalls } from '../components/knobRender';
import { KNOB_MATERIAL } from '../components/knobMaterial';
import { getKnobCanvasValue } from '../components/knobInteraction';

function expectedRotation(value: number, min = 0, max = 100): number {
    return -135 + ((value - min) / (max - min)) * 270;
}

function getNeedleTransform(container: HTMLElement): string {
    const needle = container.querySelector('[data-testid="knob-needle"]') as HTMLElement;
    return needle?.style.transform ?? '';
}

describe('HardwareKnob', () => {
    it('classic mode supports keyboard and needle rotation', () => {
        const onChange = vi.fn();
        const { getByRole, container, rerender } = render(
            <HardwareKnob mode="classic" label="Test" value={10} onChange={onChange} min={0} max={100} step={1} />
        );
        const knob = getByRole('slider');
        fireEvent.keyDown(knob, { key: 'ArrowUp' });
        expect(onChange).toHaveBeenCalled();

        rerender(<HardwareKnob mode="classic" label="Test" value={75} onChange={onChange} min={0} max={100} step={1} />);
        expect(getNeedleTransform(container)).toBe(`rotate(${expectedRotation(75)}deg)`);
    });

    it('classic mode shows automation chrome', () => {
        const onChange = vi.fn();
        const { getByRole } = render(
            <HardwareKnob
                mode="classic"
                label="Cutoff"
                value={20}
                onChange={onChange}
                min={20}
                max={15000}
                step={1}
                isAutomated
                automatedValue={0.5}
            />
        );
        expect(getByRole('slider')).toHaveAttribute('aria-label', 'Cutoff (automated)');
    });

    it('vertical mode renders fill percentage', () => {
        const onChange = vi.fn();
        const { getByText } = render(
            <HardwareKnob
                mode="vertical"
                label="ATK"
                value={0.5}
                onChange={onChange}
                min={0}
                max={1}
                colorHex={[0, 0.8, 1]}
            />
        );
        expect(getByText('50%')).toBeTruthy();
    });

    it('numeric mode renders drag value readout', () => {
        const onChange = vi.fn();
        const { getByRole } = render(
            <HardwareKnob mode="numeric" label="BPM" value={120} onChange={onChange} min={40} max={300} step={1} />
        );
        expect(getByRole('slider')).toHaveAttribute('aria-valuenow', '120');
    });

    it('holographic canvas value follows automation in normalized space', () => {
        const renderValue = getKnobCanvasValue({ value: 0.2, isAutomated: true, automatedValue: 0.8 });
        const drawCalls = buildKnob2DDrawCalls(KNOB_MATERIAL, renderValue, { w: 100, h: 100 });
        const valueArc = drawCalls.find(
            (cmd) => cmd.op === 'arc' && Math.abs(cmd.args[2] - 50 * KNOB_MATERIAL.geometry.arcRadius) < 1e-5
        );
        expect(valueArc?.op).toBe('arc');
        if (!valueArc || valueArc.op !== 'arc') return;
        expect(valueArc.args[4] - valueArc.args[3]).toBeCloseTo(0.8 * KNOB_MATERIAL.geometry.sweepTotal, 5);
    });
});
