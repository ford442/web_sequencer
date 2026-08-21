import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { HardwareModule } from '../components/HardwareModule';
import type { KnobConfig } from '../components/HardwareModule';
import { buildKnob2DDrawCalls } from '../components/knobRender';
import { getKnobCanvasValue } from '../components/knobInteraction';
import { KNOB_MATERIAL } from '../components/knobMaterial';

// Mock WebGPU since it's not available in test environment
vi.stubGlobal('navigator', {
    ...global.navigator,
    gpu: undefined
});

describe('HardwareModule - 3D Holographic Mode', () => {
    const mockControls: KnobConfig[] = [
        { id: 'test1', label: 'Test 1', x: 0.3, y: 0.5, size: 0.08, value: 0.5 },
        { id: 'test2', label: 'Test 2', x: 0.7, y: 0.5, size: 0.08, value: 0.3 }
    ];

    const mockColorHex: [number, number, number] = [0.0, 0.7, 1.0]; // Cyan

    it('should render without crashing in 2D mode', () => {
        const onParamChange = vi.fn();
        
        const { container } = render(
            <HardwareModule
                title="Test Module"
                colorHex={mockColorHex}
                controls={mockControls}
                onParamChange={onParamChange}
                is3D={false}
            />
        );

        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('should render without crashing in 3D mode', () => {
        const onParamChange = vi.fn();
        
        const { container } = render(
            <HardwareModule
                title="Test Module 3D"
                colorHex={mockColorHex}
                controls={mockControls}
                onParamChange={onParamChange}
                is3D={true}
            />
        );

        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('should accept is3D prop as optional', () => {
        const onParamChange = vi.fn();
        
        // Should not throw error when is3D is not provided
        const { container } = render(
            <HardwareModule
                title="Test Module Default"
                colorHex={mockColorHex}
                controls={mockControls}
                onParamChange={onParamChange}
            />
        );

        expect(container.querySelector('canvas')).toBeTruthy();
    });

    it('should display control labels', () => {
        const onParamChange = vi.fn();
        
        const { getByText } = render(
            <HardwareModule
                title="Test Module"
                colorHex={mockColorHex}
                controls={mockControls}
                onParamChange={onParamChange}
                is3D={true}
            />
        );

        expect(getByText('Test 1')).toBeTruthy();
        expect(getByText('Test 2')).toBeTruthy();
    });

    it('should display module title', () => {
        const onParamChange = vi.fn();
        
        const { getByText } = render(
            <HardwareModule
                title="Holographic Synth"
                colorHex={mockColorHex}
                controls={mockControls}
                onParamChange={onParamChange}
                is3D={true}
            />
        );

        expect(getByText('HOLOGRAPHIC SYNTH')).toBeTruthy();
    });

    it('should render with children', () => {
        const onParamChange = vi.fn();
        
        const { getByText } = render(
            <HardwareModule
                title="Test Module"
                colorHex={mockColorHex}
                controls={mockControls}
                onParamChange={onParamChange}
                is3D={true}
            >
                <div>Custom Child Component</div>
            </HardwareModule>
        );

        expect(getByText('Custom Child Component')).toBeTruthy();
    });

    it('should support record toggle functionality', () => {
        const onParamChange = vi.fn();
        const onRecordToggle = vi.fn();
        
        const controlsWithRecording = mockControls.map(c => ({ ...c, isRecording: false }));
        
        const { container } = render(
            <HardwareModule
                title="Test Module"
                colorHex={mockColorHex}
                controls={controlsWithRecording}
                onParamChange={onParamChange}
                onRecordToggle={onRecordToggle}
                is3D={true}
            />
        );

        // Should render record buttons
        const recordButtons = container.querySelectorAll('button[title="Record Automation"]');
        expect(recordButtons.length).toBe(controlsWithRecording.length);
    });

    it('should render accessibility sliders', () => {
        const onParamChange = vi.fn();
        
        const { container } = render(
            <HardwareModule
                title="Test Module"
                colorHex={mockColorHex}
                controls={mockControls}
                onParamChange={onParamChange}
                is3D={true}
            />
        );

        // Should have ARIA sliders for accessibility
        const sliders = container.querySelectorAll('[role="slider"]');
        expect(sliders.length).toBe(mockControls.length);
    });

    it('shows AUTO badge with automated value when manual value differs', () => {
        const onParamChange = vi.fn();
        const automatedControls: KnobConfig[] = [
            {
                id: 'cutoff',
                label: 'Cutoff',
                x: 0.5,
                y: 0.5,
                size: 0.1,
                value: 0.2,
                isAutomated: true,
                automatedValue: 0.8,
            },
        ];

        const { getByText } = render(
            <HardwareModule
                title="Test Module"
                colorHex={mockColorHex}
                controls={automatedControls}
                onParamChange={onParamChange}
            />
        );

        expect(getByText('AUTO')).toBeTruthy();
        expect(getByText('80')).toBeTruthy();
    });

    it('2D arc end angle follows automated canvas value', () => {
        const ctrl = { value: 0.2, isAutomated: true, automatedValue: 0.8 };
        const renderValue = getKnobCanvasValue(ctrl);
        const drawCalls = buildKnob2DDrawCalls(KNOB_MATERIAL, renderValue, { w: 100, h: 100 });
        const valueArc = drawCalls.find(
            (cmd) =>
                cmd.op === 'arc' &&
                Math.abs(cmd.args[2] - 50 * KNOB_MATERIAL.geometry.arcRadius) < 1e-5
        );
        expect(valueArc?.op).toBe('arc');
        if (!valueArc || valueArc.op !== 'arc') return;
        const sweepSpan = valueArc.args[4] - valueArc.args[3];
        expect(sweepSpan).toBeCloseTo(0.8 * KNOB_MATERIAL.geometry.sweepTotal, 5);
    });

    it('keeps GPU canvases untransformed inside a centered slot', () => {
        const onParamChange = vi.fn();
        const { getByTestId } = render(
            <HardwareModule
                title="Test Module"
                colorHex={mockColorHex}
                controls={mockControls}
                onParamChange={onParamChange}
            />
        );
        const canvas = getByTestId('hardware-knob-canvas-test1') as HTMLCanvasElement;
        expect(canvas.style.transform === '' || canvas.style.transform === 'none').toBe(true);
        const slot = canvas.parentElement as HTMLElement;
        expect(slot.style.transform).toContain('translate(-50%, -50%)');
        expect(slot.style.left).toBe('30%');
        expect(slot.style.top).toBe('50%');
    });
});
