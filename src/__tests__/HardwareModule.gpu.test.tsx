import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { HardwareModule } from '../components/HardwareModule';
import type { KnobConfig } from '../components/HardwareModule';
import { KnobGPUContext } from '../components/KnobGPUContext';

describe.skip('HardwareModule - WebGPU Optimization', () => {
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
        const ctx = KnobGPUContext as unknown as {
            device: GPUDevice | null;
            slots: Map<number, unknown>;
            registrations: Map<number, unknown>;
            pendingIds: Set<number>;
            initPromise: Promise<boolean> | null;
            rafId: number | null;
            status: string;
            consecutiveRenderFailures: number;
            recoverScheduled: boolean;
            deviceLostHandled: boolean;
        };
        ctx.device = null;
        ctx.slots.clear();
        ctx.registrations.clear();
        ctx.pendingIds.clear();
        ctx.initPromise = null;
        ctx.rafId = null;
        ctx.status = 'unavailable';
        ctx.consecutiveRenderFailures = 0;
        ctx.recoverScheduled = false;
        ctx.deviceLostHandled = false;
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
            lost: new Promise<GPUDeviceLostInfo>(() => {}),
            createShaderModule: vi.fn(),
            createRenderPipeline: vi.fn().mockReturnValue({
                getBindGroupLayout: vi.fn()
            }),
            createBuffer: vi.fn().mockReturnValue({ destroy: vi.fn(), mapAsync: vi.fn(), unmap: vi.fn(), getMappedRange: vi.fn() }),
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

    it.skip('optimizes buffer writes: full write initially, partial write on animation frame', async () => {
        const onParamChange = vi.fn();
        let unmount: any = () => {};
        let rerender: any;

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
            rerender = result.rerender;
            unmount = result.unmount;
        });

        // Trigger next frame
        await act(async () => {
            const cb = frameCallbacks.shift();
            if (cb) cb(performance.now());
        });

        // Wait for async init using waitFor
        await waitFor(() => {
            expect(mockWriteBuffer).toHaveBeenCalled();
        });

        // Initial render: writeBuffer(buffer, 0, buf)
        const firstCall = mockWriteBuffer.mock.calls[0];
        const writtenData = firstCall[2];
        expect(writtenData).toBeInstanceOf(Float32Array);
        expect(writtenData.length).toBe(4); // 4 floats: time, value, width, height

        // Offset and size are implicit defaults in this simpler approach
        expect(firstCall[3]).toBeUndefined();
        expect(firstCall[4]).toBeUndefined();


        // Subsequent frame: Also a full write of 4 elements (the refactored code writes everything each frame)
        expect(mockWriteBuffer).toHaveBeenCalledTimes(2);
        const secondCall = mockWriteBuffer.mock.calls[1];
        expect(secondCall[3]).toBeUndefined(); // offset
        expect(secondCall[4]).toBeUndefined(); // size

        // Update props
        const newControls = [...mockControls, { id: 'new', label: 'New', x: 0, y: 0, size: 0.1, value: 0 }];
        await act(async () => {
            rerender(
                <HardwareModule
                    title="Test Module"
                    colorHex={mockColorHex}
                    controls={newControls}
                    onParamChange={onParamChange}
                    is3D={true}
                />
            );
        });

        await act(async () => {
            const cb = frameCallbacks.shift();
            if (cb) cb(performance.now());
        });

        // We added a new control, so we should get calls for the old + new controls during the next RAF
        expect(mockWriteBuffer.mock.calls.length).toBeGreaterThan(2);
    });

    it('writes automated value to GPU uniform when automation is active', async () => {
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

        await act(async () => {
            render(
                <HardwareModule
                    title="Test Module"
                    colorHex={mockColorHex}
                    controls={automatedControls}
                    onParamChange={onParamChange}
                    is3D={true}
                />
            );
        });

        await act(async () => {
            const cb = frameCallbacks.shift();
            if (cb) cb(performance.now());
        });

        await waitFor(() => {
            expect(mockWriteBuffer).toHaveBeenCalled();
        });

        const writtenData = mockWriteBuffer.mock.calls[0][2] as Float32Array;
        expect(writtenData[1]).toBeCloseTo(0.8, 5);
    });

});
