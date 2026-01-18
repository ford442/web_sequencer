import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { HardwareModule } from '../components/HardwareModule';
import type { KnobConfig } from '../components/HardwareModule';

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
});
