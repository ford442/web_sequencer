/**
 * The piano roll on the shared WebGPU device (#1345): one instanced-quad
 * pipeline, scene uploads only on change, and a forced device loss
 * (`restartWebGpuDevice`, the e2e `loseWebGpuDevice` hook) rebuilds the
 * renderer on the restored device without remounting.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '@/types';
import { resetWebGpuProbe, restartWebGpuDevice } from '@/engines/backends/webgpuProbe';
import { defaultNoteFxChain } from '@/sequencer/noteFx/types';
import { PianoRollView, type PianoRollViewProps } from '../PianoRollView';
import { ROLL_QUAD_WGSL } from '../render/rollRenderers';

function makeDevice(label: string) {
    let resolveLost!: (info: GPUDeviceLostInfo) => void;
    const passes: Array<{ draws: Array<[number, number]> }> = [];
    const device = {
        label,
        lost: new Promise<GPUDeviceLostInfo>((r) => {
            resolveLost = r;
        }),
        destroy: vi.fn(() => resolveLost({ reason: 'destroyed', message: 'destroyed' } as GPUDeviceLostInfo)),
        createShaderModule: vi.fn(() => ({})),
        createBindGroupLayout: vi.fn(() => ({})),
        createPipelineLayout: vi.fn(() => ({})),
        createRenderPipeline: vi.fn(() => ({})),
        createBindGroup: vi.fn(() => ({})),
        createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
        createCommandEncoder: vi.fn(() => ({
            beginRenderPass: vi.fn(() => {
                const pass = { draws: [] as Array<[number, number]> };
                passes.push(pass);
                return {
                    setPipeline: vi.fn(),
                    setBindGroup: vi.fn(),
                    setVertexBuffer: vi.fn(),
                    draw: vi.fn((v: number, i: number) => pass.draws.push([v, i])),
                    end: vi.fn(),
                };
            }),
            finish: vi.fn(() => ({})),
        })),
        queue: { writeBuffer: vi.fn(), submit: vi.fn() },
        passes,
    };
    return device;
}

const steps = (): (Note | null)[] => {
    const s = Array<Note | null>(16).fill(null);
    s[0] = { note: 'C4', velocity: 1, length: 1, slide: false, chord: ['E4', 'G4'] };
    return s;
};

const props = (): PianoRollViewProps => ({
    target: { track: 'partA', bank: 0 },
    trackLabel: 'Lead',
    trackLabels: { partA: 'Lead', partB: 'Bass', bass2: 'Bass2', sampler: 'SMP' },
    color: '#06b6d4',
    steps: steps(),
    ghostSources: [],
    columns: 16,
    loopLength: 16,
    stepsPerBeat: 4,
    stepsPerBar: 16,
    scale: null,
    clipboard: null,
    onCommit: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onSelectTarget: vi.fn(),
    onClose: vi.fn(),
    fxChain: defaultNoteFxChain(),
    fxPreview: [],
    onFxChange: vi.fn(),
    onFreezeFx: vi.fn(),
    onAutomateFx: vi.fn(),
});

describe('piano roll on WebGPU', () => {
    let devices: ReturnType<typeof makeDevice>[];
    const originalGetContext = HTMLCanvasElement.prototype.getContext;
    const originalBox = {
        clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
        clientHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight'),
    };
    const box = (prop: 'clientWidth' | 'clientHeight', value: number | null) => {
        if (value !== null) {
            Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => value });
        } else if (originalBox[prop]) {
            Object.defineProperty(HTMLElement.prototype, prop, originalBox[prop]);
        } else {
            delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop];
        }
    };

    beforeEach(() => {
        // happy-dom does no layout; give the scroller a real viewport.
        box('clientWidth', 800);
        box('clientHeight', 400);
        resetWebGpuProbe();
        devices = [makeDevice('first'), makeDevice('second')];
        let next = 0;
        vi.stubGlobal('navigator', {
            ...navigator,
            gpu: {
                requestAdapter: vi.fn().mockResolvedValue({
                    requestDevice: vi.fn(async () => devices[Math.min(next++, devices.length - 1)]),
                }),
                getPreferredCanvasFormat: () => 'bgra8unorm',
            },
        });
        vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });
        vi.stubGlobal('GPUBufferUsage', { UNIFORM: 64, COPY_DST: 8, VERTEX: 32 });
        const context = { configure: vi.fn(), unconfigure: vi.fn(), getCurrentTexture: () => ({ createView: () => ({}) }) };
        HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement, type: string) {
            return type === 'webgpu' ? context : null;
        }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    });

    afterEach(() => {
        box('clientWidth', null);
        box('clientHeight', null);
        HTMLCanvasElement.prototype.getContext = originalGetContext;
        resetWebGpuProbe();
        vi.unstubAllGlobals();
    });

    it('draws the scene as instances of one quad pipeline', async () => {
        render(<PianoRollView {...props()} />);
        await waitFor(() => expect(screen.getByTestId('piano-roll')).toHaveAttribute('data-backend', 'webgpu'));
        const [first] = devices;
        expect(first.createRenderPipeline).toHaveBeenCalledTimes(1);
        expect(first.createShaderModule).toHaveBeenCalledWith(expect.objectContaining({ code: ROLL_QUAD_WGSL }));
        await waitFor(() => expect(first.queue.submit).toHaveBeenCalled());
        const draw = first.passes[0].draws[0];
        expect(draw[0]).toBe(6);
        // Background, rows, lines, keys, lane + the three chord voices: one draw.
        expect(draw[1]).toBeGreaterThan(3);
    });

    it('rebuilds on the restored device after a forced loss, without a reload', async () => {
        render(<PianoRollView {...props()} />);
        await waitFor(() => expect(devices[0].queue.submit).toHaveBeenCalled());

        await restartWebGpuDevice('test: forced device loss');
        const [, second] = devices;
        await waitFor(() => expect(second.createRenderPipeline).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(second.queue.submit).toHaveBeenCalled());
        expect(screen.getByTestId('piano-roll')).toHaveAttribute('data-backend', 'webgpu');
    });
});
