import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HardwareChassis } from '../HardwareChassis';
import { useChassisKnobMaterial } from '../chassisContext';
import { ChassisOnly } from '../ChassisOnly';
import { ChassisLedStrip } from '../ChassisLedStrip';
import { CHASSIS_MODE_ORDER } from '../chassisModes';
import { KNOB_MATERIAL_CHASSIS } from '../../knobMaterial';
import { HardwareModule, type KnobConfig } from '../../HardwareModule';

const strip = <div data-testid="strip">strip</div>;
const keys = <div data-testid="keys">keys</div>;

function MaterialProbe() {
    const material = useChassisKnobMaterial();
    return <span data-testid="probe">{material?.id ?? 'none'}</span>;
}

const KNOBS: KnobConfig[] = [
    { id: 'cutoff', label: 'CUTOFF', x: 0.2, y: 0.5, size: 0.1, value: 0.4 },
    { id: 'res', label: 'RES', x: 0.5, y: 0.5, size: 0.1, value: 0.6, isAutomated: true, automatedValue: 0.6 },
];

describe('HardwareChassis (#1584)', () => {
    it('is one white body with fixed top and bottom anchors around the stage', () => {
        render(
            <HardwareChassis mode="osc" ledStrip={strip} keybed={keys}>
                <div data-testid="panel">panel</div>
            </HardwareChassis>,
        );
        const body = screen.getByRole('region', { name: /hardware chassis/i });
        expect(body).toHaveAttribute('data-chassis', 'white');
        expect(body).toHaveAttribute('data-chassis-mode', 'osc');
        expect(body).toHaveClass('chassis-body');
        const order = [...body.querySelectorAll('[data-testid]')].map((el) => el.getAttribute('data-testid'));
        expect(order.indexOf('strip')).toBeLessThan(order.indexOf('panel'));
        expect(order.indexOf('panel')).toBeLessThan(order.indexOf('keys'));
    });

    it('morphs the stage height and body width per mode without remounting the anchors', () => {
        const { rerender } = render(
            <HardwareChassis mode="osc" ledStrip={strip} keybed={keys}><div /></HardwareChassis>,
        );
        const body = screen.getByRole('region', { name: /hardware chassis/i });
        const stripEl = screen.getByTestId('strip');
        expect(body.style.getPropertyValue('--chassis-stage-h')).toBe('380px');
        expect(body.style.getPropertyValue('--chassis-max-w')).toBe('1000px');

        rerender(<HardwareChassis mode="vd" ledStrip={strip} keybed={keys}><div /></HardwareChassis>);
        expect(body.style.getPropertyValue('--chassis-stage-h')).toBe('720px');
        expect(body.style.getPropertyValue('--chassis-max-w')).toBe('1180px');
        expect(screen.getByTestId('strip')).toBe(stripEl);

        rerender(<HardwareChassis mode="vd" compact ledStrip={strip}><div /></HardwareChassis>);
        expect(body.style.getPropertyValue('--chassis-stage-h')).toBe('600px');
    });

    it('keeps stage content mounted across a panel change (motion only, no remount)', () => {
        const { rerender } = render(
            <HardwareChassis mode="osc" panelKey="partA" ledStrip={strip}><input data-testid="field" /></HardwareChassis>,
        );
        const field = screen.getByTestId('field');
        rerender(<HardwareChassis mode="osc" panelKey="partB" ledStrip={strip}><input data-testid="field" /></HardwareChassis>);
        expect(screen.getByTestId('field')).toBe(field);
    });

    it('mode keys reflect the current mode and report clicks', () => {
        const onModeChange = vi.fn();
        render(
            <HardwareChassis mode="smp" modes={CHASSIS_MODE_ORDER} onModeChange={onModeChange} ledStrip={strip}>
                <div />
            </HardwareChassis>,
        );
        expect(screen.getByTestId('chassis-mode-smp')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('chassis-mode-osc')).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(screen.getByTestId('chassis-mode-pcf'));
        expect(onModeChange).toHaveBeenCalledWith('pcf');
    });

    it('omits the switcher without onModeChange and shows the mode in the LCD badge', () => {
        render(
            <HardwareChassis mode="tts" modes={CHASSIS_MODE_ORDER} badgeDetail="Bank 3" ledStrip={strip}><div /></HardwareChassis>,
        );
        expect(screen.queryByRole('group', { name: /chassis panel/i })).toBeNull();
        const badge = screen.getByTestId('chassis-mode-badge');
        expect(badge).toHaveTextContent('TTS');
        expect(badge).toHaveTextContent('Bank 3');
        expect(badge).toHaveAttribute('role', 'status');
    });

    it('hands KNOB_MATERIAL_CHASSIS to the stage only', () => {
        render(
            <>
                <MaterialProbe />
                <HardwareChassis mode="osc" ledStrip={strip}><MaterialProbe /></HardwareChassis>
            </>,
        );
        const [outside, inside] = screen.getAllByTestId('probe');
        expect(outside).toHaveTextContent('none');
        expect(inside).toHaveTextContent(KNOB_MATERIAL_CHASSIS.id!);
    });

    it('ChassisOnly renders nothing outside a chassis', () => {
        render(
            <>
                <ChassisOnly><span data-testid="only">x</span></ChassisOnly>
                <HardwareChassis mode="osc" ledStrip={strip}>
                    <ChassisOnly><span data-testid="only">y</span></ChassisOnly>
                </HardwareChassis>
            </>,
        );
        expect(screen.getAllByTestId('only')).toHaveLength(1);
        expect(screen.getByTestId('only')).toHaveTextContent('y');
    });

    it('HardwareModule picks up chassis knob LEDs on the stage and stays unchanged outside', () => {
        const { container, unmount } = render(
            <HardwareModule title="Synth" colorHex={[0, 1, 1]} controls={KNOBS} onParamChange={() => undefined} />,
        );
        expect(container.querySelectorAll('.hyphon-knob-led')).toHaveLength(0);
        unmount();

        const { container: inChassis } = render(
            <HardwareChassis mode="osc" ledStrip={strip}>
                <HardwareModule title="Synth" colorHex={[0, 1, 1]} controls={KNOBS} onParamChange={() => undefined} />
            </HardwareChassis>,
        );
        const leds = inChassis.querySelectorAll('.hyphon-knob-led');
        expect(leds).toHaveLength(2);
        expect(leds[0]).not.toHaveAttribute('data-active');
        expect(leds[1]).toHaveAttribute('data-active');
        leds.forEach((led) => expect(led).toHaveAttribute('aria-hidden', 'true'));
        // Knob sliders keep their accessible names.
        expect(screen.getByRole('slider', { name: 'CUTOFF' })).toBeInTheDocument();
    });
});

describe('ChassisLedStrip', () => {
    it('marks lit pads and the playhead with data attributes', () => {
        const steps = Array.from({ length: 32 }, (_, i) => i % 8 === 0);
        const { container } = render(<ChassisLedStrip steps={steps} playhead={3} />);
        const pads = container.querySelectorAll('.pad');
        expect(pads).toHaveLength(32);
        expect(container.querySelectorAll('.pad[data-on]')).toHaveLength(4);
        expect(container.querySelectorAll('.pad[data-playhead]')).toHaveLength(1);
        expect(pads[3]).toHaveAttribute('data-playhead');
        expect(screen.getByRole('img')).toHaveAccessibleName('32-step pattern, 4 steps on');
    });
});

describe('HardwareChassis oscillator theme (#1585)', () => {
    it('exposes the accent and theme id on the body', () => {
        const { container } = render(
            <HardwareChassis mode="osc" ledStrip={<div />} accent="#a78bfa" theme="prophecy">
                <div />
            </HardwareChassis>,
        );
        const body = container.querySelector('[data-chassis="white"]') as HTMLElement;
        expect(body.dataset.chassisTheme).toBe('prophecy');
        expect(body.style.getPropertyValue('--chassis-accent')).toBe('#a78bfa');
    });

    it('omits the theme when no accent is given', () => {
        const { container } = render(
            <HardwareChassis mode="drm" ledStrip={<div />}><div /></HardwareChassis>,
        );
        const body = container.querySelector('[data-chassis="white"]') as HTMLElement;
        expect(body.dataset.chassisTheme).toBeUndefined();
        expect(body.style.getPropertyValue('--chassis-accent')).toBe('');
    });
});
