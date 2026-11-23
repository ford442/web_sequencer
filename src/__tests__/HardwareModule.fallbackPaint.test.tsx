import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { HardwareModule } from '../components/HardwareModule';
import type { KnobConfig } from '../components/HardwareModule';
import { KnobGPUContext } from '../components/KnobGPUContext';
import { renderKnob2D } from '../components/knobRender';
import { resetWebGpuProbe } from '../engines/backends/webgpuProbe';

vi.mock('../components/knobRender', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../components/knobRender')>()),
    renderKnob2D: vi.fn(),
}));

const renderKnob2DMock = vi.mocked(renderKnob2D);
const COLOR: [number, number, number] = [0, 0.7, 1];

function controls(value: number): KnobConfig[] {
    return [{ id: 'cutoff', label: 'Cutoff', x: 0.3, y: 0.5, size: 0.08, value }];
}

function paintedValues(): number[] {
    return renderKnob2DMock.mock.calls.map((call) => call[1]);
}

/**
 * The rack paints a Canvas2D fallback when WebGPU is not driving a knob. The
 * bug: `KnobGPUContext.register()` hands back a handle whenever `navigator.gpu`
 * exists, even if the GPU never attaches (no adapter, attach failure), and the
 * rack treated any non-null handle as "the GPU owns this canvas" — so after the
 * first paint the knob never turned again while its readout kept updating.
 */
describe('HardwareModule - Canvas2D fallback paints value changes', () => {
    beforeEach(() => {
        resetWebGpuProbe();
        (KnobGPUContext as unknown as { __resetForTests: () => void }).__resetForTests();
        renderKnob2DMock.mockClear();
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('repaints the knob when the value changes after the GPU failed to attach', async () => {
        vi.stubGlobal('navigator', {
            gpu: {
                requestAdapter: vi.fn().mockResolvedValue(null),
                getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm'),
            },
        });

        const { rerender } = render(
            <HardwareModule title="T" colorHex={COLOR} controls={controls(0.2)} onParamChange={vi.fn()} />,
        );
        // GPU init fails -> the fallback must have painted the starting value.
        await waitFor(() => expect(paintedValues()).toContain(0.2));

        renderKnob2DMock.mockClear();
        rerender(<HardwareModule title="T" colorHex={COLOR} controls={controls(0.9)} onParamChange={vi.fn()} />);

        await waitFor(() => expect(paintedValues()).toContain(0.9));
    });

    it('repaints value changes when WebGPU is not available at all', async () => {
        vi.stubGlobal('navigator', {});

        const { rerender } = render(
            <HardwareModule title="T" colorHex={COLOR} controls={controls(0.2)} onParamChange={vi.fn()} />,
        );
        await waitFor(() => expect(paintedValues()).toContain(0.2));

        renderKnob2DMock.mockClear();
        rerender(<HardwareModule title="T" colorHex={COLOR} controls={controls(0.9)} onParamChange={vi.fn()} />);

        await waitFor(() => expect(paintedValues()).toContain(0.9));
    });
});
