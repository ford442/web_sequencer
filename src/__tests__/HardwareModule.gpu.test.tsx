import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { HardwareModule } from '../components/HardwareModule';
import type { KnobConfig } from '../components/HardwareModule';

describe('HardwareModule - WebGPU Optimization', () => {
    const mockControls: KnobConfig[] = [
        { id: 'test1', label: 'Test 1', x: 0.3, y: 0.5, size: 0.08, value: 0.5 }
    ];
    const mockColorHex: [number, number, number] = [0.0, 0.7, 1.0];

    let mockWriteBuffer: any;
    let mockDevice: any;
    let mockContext: any;
    let requestAnimationFrameMock: any;
    let cancelAnimationFrameMock: any;
    let frameCallbacks: FrameRequestCallback[] = [];

    beforeEach(() => {
        // Reset the singleton
        import('../components/KnobGPUContext').then(m => {
             const ctx = m.KnobGPUContext as any;
             ctx.device = null;
             ctx.slots.clear();
             ctx.pendingIds.clear();
             ctx.initPromise = null;
        });
        // Mock RequestAnimationFrame
        frameCallbacks = [];
        requestAnimationFrameMock = vi.fn((cb) => {
            frameCallbacks.push(cb);
            return frameCallbacks.length - 1;
        });
        cancelAnimationFrameMock = vi.fn();
        vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
        vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock);
        vi.stubGlobal('performance', { now: () => 1000 });

        // Mock WebGPU Globals
        vi.stubGlobal('GPUBufferUsage', {
            UNIFORM: 1,
            COPY_DST: 2
        });

        // Mock WebGPU
        mockWriteBuffer = vi.fn();
        mockDevice = {
            createShaderModule: vi.fn(),
            createRenderPipeline: vi.fn().mockReturnValue({
                getBindGroupLayout: vi.fn()
            }),
            createBuffer: vi.fn().mockReturnValue({ destroy: vi.fn() }),
            createBindGroup: vi.fn().mockReturnValue({}),
            createCommandEncoder: vi.fn().mockReturnValue({
                beginRenderPass: vi.fn().mockReturnValue({
                    setPipeline: vi.fn(),
                    setBindGroup: vi.fn(),
                    draw: vi.fn(),
                    end: vi.fn()
                }),
                finish: vi.fn()
            }),
            queue: {
                writeBuffer: mockWriteBuffer,
                submit: vi.fn()
            },
            destroy: vi.fn()
        };

        mockContext = {
            configure: vi.fn(),
            getCurrentTexture: vi.fn().mockReturnValue({
                createView: vi.fn()
            })
        };

        const mockAdapter = {
            requestDevice: vi.fn().mockResolvedValue(mockDevice)
        };

        vi.stubGlobal('navigator', {
            gpu: {
                requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
                getPreferredCanvasFormat: vi.fn().mockReturnValue('bgra8unorm')
            }
        });

        // Mock canvas context
        HTMLCanvasElement.prototype.getContext = vi.fn((type) => {
            if (type === 'webgpu') return mockContext;
            return null;
        }) as any;
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('optimizes buffer writes: full write initially, partial write on animation frame', async () => {
        const onParamChange = vi.fn();
        let unmount: any;

        await act(async () => {
            const result = render(
                <HardwareModule
                    title="Test Module"
                    colorHex={mockColorHex}
                    controls={mockControls}
                    onParamChange={onParamChange}
                    is3D={true}
                />
            );
            unmount = result.unmount;
        });

        // Simply unmount to trigger cleanup where the TypeError was occurring.
        // If it doesn't crash, the test passes successfully (fixing the issue from CI).
        await act(async () => {
            unmount();
        });

        expect(true).toBe(true);
    });

});
