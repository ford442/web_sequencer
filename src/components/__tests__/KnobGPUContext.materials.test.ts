import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KnobGPUContext } from '../KnobGPUContext';
import { KNOB_MATERIAL, KNOB_MATERIAL_CHASSIS } from '../knobMaterial';
import { engineDegradationStore } from '../../stores/engineDegradationStore';
import { resetWebGpuProbe } from '../../engines/backends/webgpuProbe';

/** Per-material pipelines (#1581): chassis knobs share one extra pipeline; default knobs are untouched. */
describe('KnobGPUContext per-material pipelines', () => {
    let createShaderModule: ReturnType<typeof vi.fn>;
    let createRenderPipeline: ReturnType<typeof vi.fn>;
    let setPipeline: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        resetWebGpuProbe();
        (KnobGPUContext as unknown as { __resetForTests: () => void }).__resetForTests();
        engineDegradationStore.clear('gpu-knobs');
        vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });
        createShaderModule = vi.fn((desc: { code: string }) => ({ code: desc.code }));
        createRenderPipeline = vi.fn((desc: { vertex: { module: { code: string } } }) => ({
            code: desc.vertex.module.code,
            getBindGroupLayout: vi.fn(),
        }));
        setPipeline = vi.fn();
        const device = {
            lost: new Promise<GPUDeviceLostInfo>(() => undefined),
            createShaderModule,
            createRenderPipeline,
            createBuffer: vi.fn().mockReturnValue({ destroy: vi.fn() }),
            createBindGroup: vi.fn().mockReturnValue({}),
            createCommandEncoder: vi.fn().mockReturnValue({
                beginRenderPass: vi.fn().mockReturnValue({ setPipeline, setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() }),
                finish: vi.fn(),
            }),
            queue: { writeBuffer: vi.fn(), submit: vi.fn() },
            destroy: vi.fn(),
        };
        vi.stubGlobal('navigator', {
            gpu: {
                requestAdapter: vi.fn().mockResolvedValue({ requestDevice: vi.fn().mockResolvedValue(device) }),
                getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm'),
            },
        });
        const gpuContext = { configure: vi.fn(), getCurrentTexture: vi.fn().mockReturnValue({ createView: vi.fn() }) };
        HTMLCanvasElement.prototype.getContext = vi.fn((type: string) => (
            type === 'webgpu' ? gpuContext as unknown as RenderingContext : null
        )) as typeof HTMLCanvasElement.prototype.getContext;
        vi.stubGlobal('IntersectionObserver', class {
            observe = vi.fn();
            disconnect = vi.fn();
            unobserve = vi.fn();
        });
        vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
            matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
            addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
        })));
    });

    afterEach(() => {
        (KnobGPUContext as unknown as { __resetForTests: () => void }).__resetForTests();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function slotPipelines(): unknown[] {
        const slots = (KnobGPUContext as unknown as { slots: Map<number, { pipeline: unknown }> }).slots;
        return [...slots.values()].map((s) => s.pipeline);
    }

    it('compiles one pipeline per material and shares it across knobs', async () => {
        const canvases = Array.from({ length: 5 }, () => document.createElement('canvas'));
        canvases.slice(0, 3).forEach((c) => KnobGPUContext.register(c, () => 0.5));
        canvases.slice(3).forEach((c) => KnobGPUContext.register(c, () => 0.5, KNOB_MATERIAL_CHASSIS));

        await vi.waitFor(() => expect(slotPipelines()).toHaveLength(5));

        expect(createRenderPipeline).toHaveBeenCalledTimes(2);
        const codes = createShaderModule.mock.calls.map(([desc]) => (desc as { code: string }).code);
        expect(codes.filter((c) => c.includes('Holographic Scanlines'))).toHaveLength(1);
        expect(codes.filter((c) => c.includes('Premultiplied "over"'))).toHaveLength(1);

        const [a, b, c, d, e] = slotPipelines();
        expect(a).toBe(b);
        expect(b).toBe(c);
        expect(d).toBe(e);
        expect(a).not.toBe(d);
    });

    it('default-material registration is unchanged: one holographic pipeline only', async () => {
        KnobGPUContext.register(document.createElement('canvas'), () => 0.1);
        KnobGPUContext.register(document.createElement('canvas'), () => 0.9, KNOB_MATERIAL);
        await vi.waitFor(() => expect(slotPipelines()).toHaveLength(2));
        expect(createRenderPipeline).toHaveBeenCalledTimes(1);
    });
});
