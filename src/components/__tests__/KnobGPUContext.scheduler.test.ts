import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { KnobGPUContext } from '../KnobGPUContext';
import { KNOB_STATIC_TIME } from '../knobMaterial';
import { resolveKnobTimeUniform } from '../knobMotion';
import { engineDegradationStore } from '../../stores/engineDegradationStore';
import { resetWebGpuProbeForTests } from '../../engines/backends/webgpuProbe';

describe('KnobGPUContext idle-static scheduler', () => {
    let mockWriteBuffer: ReturnType<typeof vi.fn>;
    let mockSubmit: ReturnType<typeof vi.fn>;
    let mockDevice: {
        lost: Promise<GPUDeviceLostInfo>;
        createShaderModule: ReturnType<typeof vi.fn>;
        createRenderPipeline: ReturnType<typeof vi.fn>;
        createBuffer: ReturnType<typeof vi.fn>;
        createBindGroup: ReturnType<typeof vi.fn>;
        createCommandEncoder: ReturnType<typeof vi.fn>;
        queue: { writeBuffer: ReturnType<typeof vi.fn>; submit: ReturnType<typeof vi.fn> };
        destroy: ReturnType<typeof vi.fn>;
    };
    let frameCallbacks: FrameRequestCallback[];
    let lostResolve: ((info: GPUDeviceLostInfo) => void) | null;

    beforeEach(() => {
        resetWebGpuProbeForTests();
        (KnobGPUContext as unknown as { __resetForTests: () => void }).__resetForTests();
        engineDegradationStore.clear('gpu-knobs');
        frameCallbacks = [];
        lostResolve = null;
        vi.stubGlobal('requestAnimationFrame', vi.fn((cb: FrameRequestCallback) => {
            frameCallbacks.push(cb);
            return frameCallbacks.length;
        }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        vi.stubGlobal('performance', { now: () => 1000 });
        vi.stubGlobal('GPUBufferUsage', { UNIFORM: 1, COPY_DST: 2 });

        mockWriteBuffer = vi.fn();
        mockSubmit = vi.fn();
        mockDevice = {
            lost: new Promise<GPUDeviceLostInfo>((resolve) => {
                lostResolve = resolve;
            }),
            createShaderModule: vi.fn(),
            createRenderPipeline: vi.fn().mockReturnValue({
                getBindGroupLayout: vi.fn(),
            }),
            createBuffer: vi.fn().mockReturnValue({ destroy: vi.fn() }),
            createBindGroup: vi.fn().mockReturnValue({}),
            createCommandEncoder: vi.fn().mockReturnValue({
                beginRenderPass: vi.fn().mockReturnValue({
                    setPipeline: vi.fn(),
                    setBindGroup: vi.fn(),
                    draw: vi.fn(),
                    end: vi.fn(),
                }),
                finish: vi.fn(),
            }),
            queue: {
                writeBuffer: mockWriteBuffer,
                submit: mockSubmit,
            },
            destroy: vi.fn(),
        };

        const mockContext = {
            configure: vi.fn(),
            getCurrentTexture: vi.fn().mockReturnValue({
                createView: vi.fn(),
            }),
        };

        vi.stubGlobal('navigator', {
            gpu: {
                requestAdapter: vi.fn().mockResolvedValue({
                    requestDevice: vi.fn().mockResolvedValue(mockDevice),
                }),
                getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm'),
            },
        });

        HTMLCanvasElement.prototype.getContext = vi.fn((type: string) => {
            if (type === 'webgpu') return mockContext as unknown as RenderingContext;
            return null;
        }) as typeof HTMLCanvasElement.prototype.getContext;

        vi.stubGlobal(
            'IntersectionObserver',
            class {
                observe = vi.fn();
                disconnect = vi.fn();
                unobserve = vi.fn();
                constructor(_cb: IntersectionObserverCallback) {
                    /* slots default inViewport=true until first callback */
                }
            },
        );

        vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })));
    });

    afterEach(() => {
        (KnobGPUContext as unknown as { __resetForTests: () => void }).__resetForTests();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    async function registerKnobs(count: number) {
        const handles: NonNullable<ReturnType<typeof KnobGPUContext.register>>[] = [];
        for (let i = 0; i < count; i++) {
            const canvas = document.createElement('canvas');
            canvas.width = 64;
            canvas.height = 64;
            const handle = KnobGPUContext.register(canvas, () => i / Math.max(1, count));
            expect(handle).not.toBeNull();
            handles.push(handle!);
        }
        await vi.waitFor(() => {
            expect(KnobGPUContext.getStatus()).toBe('active');
            expect(KnobGPUContext.getRegistrySize()).toBe(count);
            expect(
                (KnobGPUContext as unknown as { slots: Map<number, unknown> }).slots.size,
            ).toBe(count);
        });
        await flushFrames(8);
        KnobGPUContext.resetDebugStats();
        mockSubmit.mockClear();
        mockWriteBuffer.mockClear();
        return handles;
    }

    async function flushFrames(n: number): Promise<void> {
        for (let i = 0; i < n; i++) {
            const cb = frameCallbacks.shift();
            if (!cb) break;
            cb(performance.now());
            await Promise.resolve();
        }
    }

    it('idle budget: 30 knobs settle to 0 submits and dormant rAF', async () => {
        await registerKnobs(30);
        await flushFrames(10);
        const stats = KnobGPUContext.getDebugStats();
        expect(stats.submitCount).toBe(0);
        expect(stats.isLoopRunning).toBe(false);
        expect(stats.dirtyCount).toBe(0);
    });

    it('drag budget: only the active knob animates; renderImmediate is one submit', async () => {
        const handles = await registerKnobs(8);
        const active = handles[3]!;

        KnobGPUContext.setAnimated(active, true);
        KnobGPUContext.resetDebugStats();
        mockSubmit.mockClear();
        mockWriteBuffer.mockClear();

        KnobGPUContext.renderImmediate(active);
        expect(mockSubmit).toHaveBeenCalledTimes(1);
        expect(KnobGPUContext.getDebugStats().submitCount).toBe(1);

        const written = mockWriteBuffer.mock.calls[0][2] as Float32Array;
        expect(written[0]).not.toBe(KNOB_STATIC_TIME);

        await flushFrames(3);
        const submitsAfter = KnobGPUContext.getDebugStats().submitCount;
        expect(submitsAfter).toBeGreaterThanOrEqual(1);
        expect(mockWriteBuffer.mock.calls.length).toBe(submitsAfter);

        KnobGPUContext.setAnimated(active, false);
        await flushFrames(5);
        expect(KnobGPUContext.getDebugStats().isLoopRunning).toBe(false);
    });

    it('markDirty does not notify useSyncExternalStore subscribers', async () => {
        const handles = await registerKnobs(1);
        const listener = vi.fn();
        const unsub = KnobGPUContext.subscribe(listener);
        listener.mockClear();

        const before = KnobGPUContext.getSnapshot().version;
        KnobGPUContext.markDirty(handles[0]);
        expect(listener).not.toHaveBeenCalled();
        expect(KnobGPUContext.getSnapshot().version).toBe(before);
        unsub();
    });

    it('registry size returns to 0 after unregister (StrictMode-safe cleanup)', async () => {
        const handles = await registerKnobs(4);
        expect(KnobGPUContext.getRegistrySize()).toBe(4);
        for (const h of handles) KnobGPUContext.unregister(h);
        expect(KnobGPUContext.getRegistrySize()).toBe(0);
        expect(KnobGPUContext.getDebugStats().isLoopRunning).toBe(false);
    });

    it('visibilitychange: pauses when hidden and marks all dirty on resume', async () => {
        await registerKnobs(2);
        await flushFrames(5);
        KnobGPUContext.resetDebugStats();
        mockSubmit.mockClear();

        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
        expect(KnobGPUContext.getDebugStats().isLoopRunning).toBe(false);

        Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
        document.dispatchEvent(new Event('visibilitychange'));
        expect(frameCallbacks.length).toBeGreaterThan(0);
        await flushFrames(5);
        expect(KnobGPUContext.getDebugStats().submitCount).toBeGreaterThan(0);
    });

    it('device loss schedules recovery', async () => {
        await registerKnobs(2);
        expect(lostResolve).toBeTypeOf('function');
        lostResolve!({ reason: 'unknown', message: 'simulated loss' } as GPUDeviceLostInfo);

        await vi.waitFor(() => {
            expect(KnobGPUContext.getStatus()).toBe('degraded');
        });
    });

    it('prefers-reduced-motion locks time uniform to static', () => {
        expect(resolveKnobTimeUniform(12.5, true, true)).toBe(KNOB_STATIC_TIME);
        expect(resolveKnobTimeUniform(12.5, false, false)).toBe(KNOB_STATIC_TIME);
        expect(resolveKnobTimeUniform(12.5, true, false)).toBe(12.5);
    });

    it('offscreen knobs are not rendered', async () => {
        const handles = await registerKnobs(2);
        const ctx = KnobGPUContext as unknown as { slots: Map<number, { inViewport: boolean; dirty: boolean }> };
        const id = handles[0]!.id;
        const slot = ctx.slots.get(id)!;
        slot.inViewport = false;
        slot.dirty = true;
        KnobGPUContext.resetDebugStats();
        mockSubmit.mockClear();
        frameCallbacks = [];
        KnobGPUContext.markDirty(id);
        await flushFrames(3);
        expect(KnobGPUContext.getDebugStats().submitCount).toBe(0);
    });
});
